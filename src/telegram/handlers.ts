import fs from "node:fs/promises";
import { InputFile } from "grammy";
import type { AgentRunResult } from "../agent/loop.js";
import type { AgentRunOptions } from "../agent/progress.js";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { ApprovalStore, PendingApproval } from "../approvals/store.js";
import type { StatusService, StatusSnapshot } from "../app/status-service.js";
import type { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryStoreLike } from "../memory/store.js";
import type { ShellRunner } from "../tools/shell-runner.js";
import { describeAccessiblePath, type PathAccessPolicy } from "../tools/workspace.js";
import { isAuthorizedUser } from "./auth.js";

export const TEXT_ONLY_MESSAGE = "Level 1 supports text messages only.";
export const NEW_CHAT_MESSAGE =
  "Started a new chat. I kept your durable memory facts and cleared recent conversation history.";
export const LIVE_STEERING_MESSAGE =
  "Noted. I'll treat this as guidance for the task that's already running.";
export const HELP_MESSAGE = [
  "Gravity Claw commands:",
  "/new - clear recent conversation history but keep durable memory",
  "/status - show local bot, model, and workspace status",
  "/approvals - list pending shell approvals for this chat",
  "/approve <id> - approve a pending shell command",
  "/deny <id> - deny a pending shell command",
  "/last_error - show the latest stored local error",
  "/cancel - request cancellation for the current task",
  "",
  "Example prompts:",
  "- open Telegram and focus it",
  "- take a screenshot of the active window",
  "- click the Save button on screen",
  "- read notes/todo.txt",
  "- replace TODO with DONE in notes/todo.txt",
  "- copy this summary to the clipboard"
].join("\n");
export const CANCEL_REQUESTED_MESSAGE =
  "Cancellation requested. I'll stop after the current local step finishes.";
export const NO_ACTIVE_TASK_TO_CANCEL_MESSAGE = "No active task is running in this chat.";

function isHelpCommand(text: string): boolean {
  return /^\/help(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isNewCommand(text: string): boolean {
  return /^\/new(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isStatusCommand(text: string): boolean {
  return /^\/status(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isApprovalsCommand(text: string): boolean {
  return /^\/approvals(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isApproveCommand(text: string): boolean {
  return /^\/approve(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isDenyCommand(text: string): boolean {
  return /^\/deny(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isCancelCommand(text: string): boolean {
  return /^\/cancel(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isLastErrorCommand(text: string): boolean {
  return /^\/last_error(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function parseCommandArgument(text: string): string | undefined {
  const [, argument] = text.trim().split(/\s+/, 2);
  return argument?.trim() || undefined;
}

interface MessageContext {
  from?: { id: number };
  chat?: { id: number | string | bigint };
  message?: {
    message_id?: number;
    text?: string;
  };
  api: {
    sendChatAction(chatId: number | string | bigint, action: "typing"): Promise<unknown>;
    sendPhoto?(
      chatId: number | string | bigint,
      photo: unknown,
      other?: { caption?: string }
    ): Promise<unknown>;
  };
  reply(text: string): Promise<unknown>;
}

interface CommandContext {
  from?: { id: number } | undefined;
  chat?: { id: number | string | bigint } | undefined;
  reply(text: string): Promise<unknown>;
}

function truncateText(value: string, maxLength = 80): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 1, 1))}...`;
}

function formatApprovalLine(
  approval: PendingApproval,
  pathAccessPolicy: PathAccessPolicy
): string {
  return [
    `- ${approval.id}`,
    `  cwd: ${describeAccessiblePath(pathAccessPolicy, approval.cwd)}`,
    `  time: ${approval.createdAt}`,
    `  command: ${truncateText(approval.command, 100)}`
  ].join("\n");
}

function formatStatusReply(snapshot: StatusSnapshot): string {
  const lines = [
    `Bot: ${snapshot.bot ? `@${snapshot.bot.username || "unknown"} (${snapshot.bot.id})` : "starting up"}`,
    `Ollama host: ${snapshot.ollamaHost}`,
    `Ollama reachable: ${snapshot.ollamaReachable ? "yes" : "no"}`,
    `Chat model: ${snapshot.ollamaModel} (${snapshot.chatModelAvailable ? "available" : "missing"})`,
    `Fast model: ${snapshot.ollamaFastModel} (${snapshot.fastModelAvailable ? "available" : "missing"})`,
    `Vision model: ${snapshot.ollamaVisionModel} (${snapshot.visionModelAvailable ? "available" : "missing"})`,
    `Fast routing: ${snapshot.fastRoutingEnabled ? "enabled" : "disabled"}`,
    `Database path: ${snapshot.databasePath}`,
    `Workspace root: ${snapshot.workspaceRoot}`,
    `Allowed roots: ${snapshot.allowedRoots.join(", ")}`,
    `Pending approvals in this chat: ${snapshot.pendingApprovalCount}`
  ];

  if (snapshot.latestLocalErrorAt && snapshot.latestLocalErrorScope) {
    lines.push(`Last local error: ${snapshot.latestLocalErrorAt} (${snapshot.latestLocalErrorScope})`);
  } else {
    lines.push("Last local error: none stored for this chat");
  }

  if (snapshot.error) {
    lines.push(`Status warning: ${snapshot.error}`);
  }

  return lines.join("\n");
}

interface MessageHandlerDependencies {
  allowedUserId: string;
  agentLoop: {
    run(chatId: string, userInput: string, options?: AgentRunOptions): Promise<AgentRunResult>;
  };
  queue: ChatTaskQueue;
  logger: Logger;
}

async function sendImageAttachments(
  context: MessageContext,
  chatId: number | string | bigint,
  result: AgentRunResult,
  logger: Logger,
  internalChatId: string
): Promise<void> {
  if (!context.api.sendPhoto || result.attachments.length === 0) {
    return;
  }

  for (const attachment of result.attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    try {
      await fs.stat(attachment.path);
      await context.api.sendPhoto(chatId, new InputFile(attachment.path));
    } catch (error) {
      logger.warn("telegram.message.attachment_failed", {
        chatId: internalChatId,
        attachmentPath: attachment.path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function createMessageHandler(dependencies: MessageHandlerDependencies) {
  return async (context: MessageContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat || !context.message) {
      return;
    }

    const chatId = String(context.chat.id);
    const chat = context.chat;

    if (
      typeof context.message?.text === "string" &&
      context.message.text.trim().length > 0 &&
      !isNewCommand(context.message.text) &&
      !isHelpCommand(context.message.text) &&
      !isStatusCommand(context.message.text) &&
      !isApprovalsCommand(context.message.text) &&
      !isLastErrorCommand(context.message.text) &&
      !isApproveCommand(context.message.text) &&
      !isDenyCommand(context.message.text) &&
      !isCancelCommand(context.message.text) &&
      dependencies.queue.captureSteeringMessage(chatId, context.message.text)
    ) {
      dependencies.logger.info("telegram.message.steering_received", {
        chatId,
        userId: String(context.from?.id)
      });
      await context.reply(LIVE_STEERING_MESSAGE);
      return;
    }

    await dependencies.queue.run(chatId, async () => {
      if (typeof context.message?.text !== "string" || context.message.text.trim().length === 0) {
        await context.reply(TEXT_ONLY_MESSAGE);
        return;
      }

      if (
        isNewCommand(context.message.text) ||
        isHelpCommand(context.message.text) ||
        isStatusCommand(context.message.text) ||
        isApprovalsCommand(context.message.text) ||
        isLastErrorCommand(context.message.text) ||
        isApproveCommand(context.message.text) ||
        isDenyCommand(context.message.text) ||
        isCancelCommand(context.message.text)
      ) {
        return;
      }

      dependencies.logger.info("telegram.message.received", {
        chatId,
        userId: String(context.from?.id)
      });

      await context.api.sendChatAction(chat.id, "typing");
      let lastProgressMessage: string | undefined;
      const progressOptions: AgentRunOptions = {
        onProgress: async (message) => {
          const trimmedMessage = message.trim();
          if (trimmedMessage.length === 0 || trimmedMessage === lastProgressMessage) {
            return;
          }

          lastProgressMessage = trimmedMessage;

          try {
            await context.reply(trimmedMessage);
          } catch (error) {
            dependencies.logger.warn("telegram.message.progress_failed", {
              chatId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        },
        consumeSteeringMessages: () => dependencies.queue.consumeSteeringMessages(chatId),
        shouldCancel: () => dependencies.queue.shouldCancel(chatId)
      };
      dependencies.queue.beginActiveRun(chatId);
      let agentResult!: AgentRunResult;
      try {
        agentResult = await dependencies.agentLoop.run(chatId, context.message.text, progressOptions);
      } finally {
        dependencies.queue.endActiveRun(chatId);
      }
      await context.api.sendChatAction(chat.id, "typing");
      await context.reply(agentResult.replyText);
      await sendImageAttachments(context, chat.id, agentResult, dependencies.logger, chatId);

      dependencies.logger.info("telegram.message.replied", {
        chatId,
        userId: String(context.from?.id)
      });
    });
  };
}

interface NewCommandDependencies {
  allowedUserId: string;
  memoryStore: MemoryStoreLike;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createNewCommandHandler(dependencies: NewCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.memoryStore.resetConversation(chatId);
      dependencies.logger.info("telegram.command.new", {
        chatId,
        userId: String(context.from?.id)
      });
      await context.reply(NEW_CHAT_MESSAGE);
    });
  };
}

interface ApprovalCommandDependencies {
  allowedUserId: string;
  approvalStore: ApprovalStore;
  shellRunner: ShellRunner;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface LastErrorCommandDependencies {
  allowedUserId: string;
  errorStore: RuntimeErrorStore;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface ApprovalsCommandDependencies {
  allowedUserId: string;
  approvalStore: ApprovalStore;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface StatusCommandDependencies {
  allowedUserId: string;
  statusService: StatusService;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface CancelCommandDependencies {
  allowedUserId: string;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createHelpCommandHandler(dependencies: {
  allowedUserId: string;
  queue: ChatTaskQueue;
  logger: Logger;
}) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.logger.info("telegram.command.help", {
        chatId,
        userId: String(context.from?.id)
      });
      await context.reply(HELP_MESSAGE);
    });
  };
}

export function createApproveCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const approvalId = rawArgument ? parseCommandArgument(`/approve ${rawArgument}`) : undefined;
      const approval = dependencies.approvalStore.consume(chatId, approvalId);

      if (!approval) {
        await context.reply("No pending approval found for this chat.");
        return;
      }

      dependencies.logger.info("telegram.command.approve", {
        chatId,
        approvalId: approval.id
      });

      const result = await dependencies.shellRunner.executeApproval(approval);
      const cwd = describeAccessiblePath(dependencies.pathAccessPolicy, approval.cwd);
      const replyLines = [
        `Approved command ${approval.id}.`,
        `cwd: ${cwd}`,
        `exitCode: ${String(result.exitCode ?? "null")}`
      ];

      if (result.stdout) {
        replyLines.push(`stdout:\n${result.stdout}`);
      }

      if (result.stderr) {
        replyLines.push(`stderr:\n${result.stderr}`);
      }

      await context.reply(replyLines.join("\n"));
    });
  };
}

export function createDenyCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const approvalId = rawArgument ? parseCommandArgument(`/deny ${rawArgument}`) : undefined;
      const approval = dependencies.approvalStore.deny(chatId, approvalId);

      if (!approval) {
        await context.reply("No pending approval found for this chat.");
        return;
      }

      dependencies.logger.info("telegram.command.deny", {
        chatId,
        approvalId: approval.id
      });

      await context.reply(`Denied command ${approval.id}.`);
    });
  };
}

export function createApprovalsCommandHandler(dependencies: ApprovalsCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const approvals = dependencies.approvalStore.listPending(chatId);
      dependencies.logger.info("telegram.command.approvals", {
        chatId,
        count: approvals.length
      });

      if (approvals.length === 0) {
        await context.reply("No pending approvals for this chat.");
        return;
      }

      const lines = [
        `Pending approvals for this chat: ${approvals.length}`,
        approvals.map((approval) => formatApprovalLine(approval, dependencies.pathAccessPolicy)).join("\n")
      ];

      await context.reply(lines.join("\n"));
    });
  };
}

export function createLastErrorCommandHandler(dependencies: LastErrorCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const errorEntry = dependencies.errorStore.getLast(chatId);
      if (!errorEntry) {
        await context.reply("No local error is stored for this chat.");
        return;
      }

      dependencies.logger.info("telegram.command.last_error", {
        chatId,
        scope: errorEntry.scope
      });

      await context.reply(
        `Last local error:\nscope: ${errorEntry.scope}\ntime: ${errorEntry.createdAt}\nmessage: ${errorEntry.message}`
      );
    });
  };
}

export function createStatusCommandHandler(dependencies: StatusCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.logger.info("telegram.command.status", {
        chatId,
        userId: String(context.from?.id)
      });

      const status = await dependencies.statusService.getStatus(chatId);
      await context.reply(formatStatusReply(status));
    });
  };
}

export function createCancelCommandHandler(dependencies: CancelCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    const canceled = dependencies.queue.requestCancel(chatId);

    dependencies.logger.info("telegram.command.cancel", {
      chatId,
      canceled
    });

    await context.reply(canceled ? CANCEL_REQUESTED_MESSAGE : NO_ACTIVE_TASK_TO_CANCEL_MESSAGE);
  };
}
