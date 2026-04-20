import { CANCELED_MESSAGE } from "../agent/loop.js";
import type { AgentAttachment, AgentLoop, AgentRunResult } from "../agent/loop.js";
import { ChatTaskQueue } from "../agent/queue.js";
import type { AgentRunOptions } from "../agent/progress.js";
import type { PendingApproval } from "../approvals/store.js";
import { ApprovalStore } from "../approvals/store.js";
import { validateShellCommandTargets } from "../tools/shell-command-policy.js";
import type { PathAccessPolicy } from "../tools/workspace.js";
import type { Logger } from "../logging/logger.js";
import type {
  ArtifactStore,
  NotificationSink,
  RunEvent,
  Task
} from "./contracts.js";
import { TaskStore } from "./task-store.js";

export interface TaskExecutionResult {
  task: Task;
  replyText: string;
  attachments: AgentAttachment[];
}

interface TaskRuntimeOptions {
  agentLoop: AgentLoop;
  taskStore: TaskStore;
  artifactStore: ArtifactStore;
  approvalStore: ApprovalStore;
  queue: ChatTaskQueue;
  pathAccessPolicy: PathAccessPolicy;
  shellRunner: {
    executeApproval(approval: PendingApproval): Promise<{
      ok: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>;
  };
  logger: Logger;
}

function createEvent(
  task: Task,
  type: RunEvent["type"],
  message: string,
  extra: Omit<RunEvent, "taskId" | "chatId" | "type" | "message" | "createdAt"> = {}
): Omit<RunEvent, "createdAt"> {
  return {
    taskId: task.id,
    chatId: task.chatId,
    type,
    message,
    ...extra
  };
}

function toApprovalRequest(approval: PendingApproval): NonNullable<RunEvent["approval"]> {
  return {
    id: approval.id,
    kind: approval.kind,
    chatId: approval.chatId,
    ...(approval.taskId ? { taskId: approval.taskId } : {}),
    title: approval.title,
    details: approval.details,
    createdAt: approval.createdAt
  };
}

function buildShellContinuationInput(task: Task, approval: PendingApproval, result: {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  return [
    "Continue the previously paused task.",
    "",
    `Original user request:`,
    task.userInput,
    "",
    "The approved shell command has already been executed. Use its result and continue the task without rerunning the same command unless you truly need a new command.",
    `Command: ${approval.command ?? ""}`,
    `cwd: ${approval.cwd ?? ""}`,
    `exitCode: ${String(result.exitCode ?? "null")}`,
    result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
    result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>"
  ].join("\n");
}

function buildExternalContinuationInput(task: Task, approval: PendingApproval): string {
  return [
    "Continue the previously paused task.",
    "",
    `Original user request:`,
    task.userInput,
    "",
    "The user approved the external action below. Complete it now and do not ask for the same approval again unless the scope materially changes.",
    `Action: ${approval.title}`,
    `Details: ${approval.details}`
  ].join("\n");
}

export class TaskRuntime {
  constructor(private readonly options: TaskRuntimeOptions) {}

  requestCancel(chatId: string): boolean {
    return this.options.queue.requestCancel(chatId);
  }

  recoverInterruptedTasks(): Task[] {
    return this.options.taskStore.recoverInterruptedTasks();
  }

  async submitTask(
    chatId: string,
    userInput: string,
    sink?: NotificationSink,
    parentTaskId?: string
  ): Promise<TaskExecutionResult> {
    const task = this.options.taskStore.createTask(chatId, userInput, parentTaskId);
    this.options.taskStore.appendEvent(createEvent(task, "task_created", "Task queued.", {
      status: task.status
    }));
    return this.runExistingTask(task, sink);
  }

  async approvePending(
    chatId: string,
    approvalId: string | undefined,
    sink?: NotificationSink
  ): Promise<TaskExecutionResult> {
    const approval = this.options.approvalStore.consume(chatId, approvalId);
    if (!approval) {
      return {
        task: this.options.taskStore.createTask(chatId, "Approval lookup failed"),
        replyText: "No pending approval found for this chat.",
        attachments: []
      };
    }

    if (approval.kind === "shell_command") {
      return this.approveShellCommand(approval, sink);
    }

    return this.approveExternalAction(approval, sink);
  }

  denyPending(chatId: string, approvalId?: string): PendingApproval | undefined {
    const approval = this.options.approvalStore.deny(chatId, approvalId);
    if (!approval?.taskId) {
      return approval;
    }

    const task = this.options.taskStore.getTask(approval.taskId);
    if (!task) {
      return approval;
    }

    const canceled = this.options.taskStore.markCanceled(
      task.id,
      `Denied approval ${approval.id}.`
    );
    this.options.taskStore.appendEvent(
      createEvent(canceled, "task_canceled", `Denied approval ${approval.id}.`, {
        status: canceled.status,
        approval: toApprovalRequest(approval)
      })
    );
    return approval;
  }

  private async approveShellCommand(
    approval: PendingApproval,
    sink?: NotificationSink
  ): Promise<TaskExecutionResult> {
    const task = approval.taskId ? this.options.taskStore.getTask(approval.taskId) : undefined;
    const command = approval.command;
    const cwd = approval.cwd;
    const validation =
      command && cwd
        ? validateShellCommandTargets(
            command,
            cwd,
            this.options.pathAccessPolicy
          )
        : { ok: false, error: "Approved shell command is missing command metadata." };

    if (!validation.ok) {
      const errorMessage = validation.error ?? "Approved shell command is missing command metadata.";
      const replyText = `Blocked command ${approval.id}: ${errorMessage}`;
      if (task) {
        const failedTask = this.options.taskStore.markFailed(task.id, errorMessage, replyText);
        this.options.taskStore.appendEvent(
          createEvent(failedTask, "task_failed", replyText, {
            status: failedTask.status
          })
        );
      }

      return {
        task: task ?? this.options.taskStore.createTask(approval.chatId, "Blocked shell approval"),
        replyText,
        attachments: []
      };
    }

    const result = await this.options.shellRunner.executeApproval(approval);
    if (!task) {
      return {
        task: this.options.taskStore.createTask(approval.chatId, "Shell approval without task"),
        replyText: [
          `Approved command ${approval.id}.`,
          `exitCode: ${String(result.exitCode ?? "null")}`,
          result.stdout ? `stdout:\n${result.stdout}` : undefined,
          result.stderr ? `stderr:\n${result.stderr}` : undefined
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
        attachments: []
      };
    }

    const completedTask = this.options.taskStore.markCompleted(
      task.id,
      `Approved shell command ${approval.id}; continuing in a follow-up task.`
    );
    this.options.taskStore.appendEvent(
      createEvent(completedTask, "approval_resolved", `Approved shell command ${approval.id}.`, {
        status: completedTask.status,
        approval: toApprovalRequest(approval),
        data: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        }
      })
    );

    return this.submitTask(
      approval.chatId,
      buildShellContinuationInput(task, approval, result),
      sink,
      task.id
    );
  }

  private async approveExternalAction(
    approval: PendingApproval,
    sink?: NotificationSink
  ): Promise<TaskExecutionResult> {
    const task = approval.taskId ? this.options.taskStore.getTask(approval.taskId) : undefined;
    if (!task) {
      return {
        task: this.options.taskStore.createTask(approval.chatId, "External approval without task"),
        replyText: `Approved external action ${approval.id}.`,
        attachments: []
      };
    }

    const completedTask = this.options.taskStore.markCompleted(
      task.id,
      `Approved external action ${approval.id}; continuing in a follow-up task.`
    );
    this.options.taskStore.appendEvent(
      createEvent(completedTask, "approval_resolved", `Approved external action ${approval.id}.`, {
        status: completedTask.status,
        approval: toApprovalRequest(approval)
      })
    );

    return this.submitTask(
      approval.chatId,
      buildExternalContinuationInput(task, approval),
      sink,
      task.id
    );
  }

  private async runExistingTask(
    initialTask: Task,
    sink?: NotificationSink
  ): Promise<TaskExecutionResult> {
    const task = this.options.taskStore.getTask(initialTask.id) ?? initialTask;
    const progressMessages = new Set<string>();

    return this.options.queue.run(task.chatId, async () => {
      const runningTask = this.options.taskStore.markRunning(task.id);
      this.options.taskStore.appendEvent(
        createEvent(runningTask, "task_running", "Task is running.", {
          status: runningTask.status
        })
      );

      this.options.queue.beginActiveRun(task.chatId);
      let agentResult!: AgentRunResult;
      try {
        const runOptions: AgentRunOptions = {
          taskId: runningTask.id,
          onProgress: async (message) => {
            const trimmedMessage = message.trim();
            if (trimmedMessage.length === 0 || progressMessages.has(trimmedMessage)) {
              return;
            }

            progressMessages.add(trimmedMessage);
            const progressEvent = this.options.taskStore.appendEvent(
              createEvent(runningTask, "progress", trimmedMessage, {
                status: "running"
              })
            );
            await sink?.notify(progressEvent);
          },
          consumeSteeringMessages: () => this.options.queue.consumeSteeringMessages(task.chatId),
          shouldCancel: () => this.options.queue.shouldCancel(task.chatId)
        };

        agentResult = await this.options.agentLoop.run(task.chatId, task.userInput, runOptions);
      } finally {
        this.options.queue.endActiveRun(task.chatId);
      }

      const artifacts = this.recordArtifacts(runningTask, agentResult.attachments);
      const finalTask = this.finishTask(runningTask, agentResult);

      const finalEvent = this.options.taskStore.appendEvent(
        createEvent(
          finalTask,
          finalTask.status === "completed"
            ? "task_completed"
            : finalTask.status === "waiting_approval"
              ? "approval_requested"
              : finalTask.status === "canceled"
                ? "task_canceled"
                : "task_failed",
          agentResult.replyText,
          {
            status: finalTask.status,
            ...(agentResult.pendingApproval ? { approval: agentResult.pendingApproval } : {}),
            ...(artifacts.length > 0 ? { data: { artifacts } } : {})
          }
        )
      );
      await sink?.notify(finalEvent);

      for (const artifact of artifacts) {
        const artifactEvent = this.options.taskStore.appendEvent(
          createEvent(finalTask, "artifact_recorded", artifact.label ?? artifact.path, {
            status: finalTask.status,
            artifact
          })
        );
        await sink?.notify(artifactEvent);
      }

      return {
        task: finalTask,
        replyText: agentResult.replyText,
        attachments: agentResult.attachments
      };
    });
  }

  private recordArtifacts(task: Task, attachments: AgentAttachment[]) {
    return attachments.map((attachment) => {
      const label = attachment.path.split(/[\\/]/).at(-1);
      return this.options.artifactStore.recordArtifact(
        task.id,
        label
          ? {
              kind: attachment.kind === "image" ? "image" : "file",
              path: attachment.path,
              label
            }
          : {
              kind: attachment.kind === "image" ? "image" : "file",
              path: attachment.path
            }
      );
    });
  }

  private finishTask(task: Task, result: AgentRunResult): Task {
    switch (result.state) {
      case "waiting_approval":
        return this.options.taskStore.markWaitingApproval(task.id, result.replyText);
      case "canceled":
        return this.options.taskStore.markCanceled(task.id, result.replyText);
      case "failed":
        return this.options.taskStore.markFailed(task.id, result.replyText, result.replyText);
      case "completed":
      default:
        if (result.replyText === CANCELED_MESSAGE) {
          return this.options.taskStore.markCanceled(task.id, result.replyText);
        }
        return this.options.taskStore.markCompleted(task.id, result.replyText);
    }
  }
}
