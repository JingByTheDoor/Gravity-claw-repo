import fs from "node:fs/promises";
import { InputFile } from "grammy";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { ApprovalStore, PendingApproval } from "../approvals/store.js";
import type { StatusService, StatusSnapshot } from "../app/status-service.js";
import type { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryStoreLike } from "../memory/store.js";
import type { NotificationSink } from "../runtime/contracts.js";
import {
  CompositeNotificationSink,
  TelegramContextNotificationSink,
  type TelegramNotificationTarget
} from "../runtime/notification-sink.js";
import type { TaskRuntime } from "../runtime/task-runtime.js";
import { describeAccessiblePath, type PathAccessPolicy } from "../tools/workspace.js";
import { isAuthorizedContext } from "./auth.js";

export const TEXT_ONLY_MESSAGE = "Level 1 supports text messages only.";
export const NEW_CHAT_MESSAGE =
  "Started a new chat. I kept your durable memory facts and cleared recent conversation history.";
export const LIVE_STEERING_MESSAGE =
  "Noted. I'll treat this as guidance for the task that's already running.";
export const HELP_MESSAGE = [
  "Gravity Claw commands:",
  "/new - clear recent conversation history but keep durable memory",
  "/status - show local bot, model, and workspace status",
  "/approvals - list pending approvals for this chat",
  "/approve <id> - approve the latest pending action or a specific approval ID",
  "/deny <id> - deny the latest pending action or a specific approval ID",
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

interface TelegramApiLike {
  sendChatAction?(chatId: number | string | bigint, action: "typing"): Promise<unknown>;
  sendPhoto?(
    chatId: number | string | bigint,
    photo: unknown,
    other?: { caption?: string }
  ): Promise<unknown>;
}

interface MessageContext {
  from?: { id: number };
  chat?: { id: number | string | bigint; type?: string };
  message?: {
    message_id?: number;
    text?: string;
  };
  api: TelegramApiLike;
  reply(text: string): Promise<unknown>;
}

interface CommandContext {
  from?: { id: number } | undefined;
  chat?: { id: number | string | bigint; type?: string } | undefined;
  api?: TelegramApiLike;
  reply(text: string): Promise<unknown>;
}

function truncateText(value: string, maxLength = 80): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 1, 1))}...`;
}

function formatApprovalLine(
  approval: PendingApproval,
  pathAccessPolicy: PathAccessPolicy
): string {
  const lines = [
    `- ${approval.id}`,
    `  time: ${approval.createdAt}`,
    `  kind: ${approval.kind}`,
    `  title: ${truncateText(approval.title, 100)}`
  ];

  if (approval.cwd) {
    lines.push(`  cwd: ${describeAccessiblePath(pathAccessPolicy, approval.cwd)}`);
  }

  if (approval.command) {
    lines.push(`  command: ${truncateText(approval.command, 100)}`);
  } else {
    lines.push(`  details: ${truncateText(approval.details, 100)}`);
  }

  return lines.join("\n");
}

function formatStatusReply(snapshot: StatusSnapshot): string {
  const lines = [
    `Bot: ${snapshot.bot ? `@${snapshot.bot.username || "unknown"} (${snapshot.bot.id})` : "starting up"}`,
    `Worker: ${snapshot.workerLabel} (${snapshot.workerMode})`,
    `Ollama host: ${snapshot.ollamaHost}`,
    `Ollama reachable: ${snapshot.ollamaReachable ? "yes" : "no"}`,
    `Chat model: ${snapshot.ollamaModel} (${snapshot.chatModelAvailable ? "available" : "missing"})`,
    `Fast model: ${snapshot.ollamaFastModel} (${snapshot.fastModelAvailable ? "available" : "missing"})`,
    `Vision model: ${snapshot.ollamaVisionModel} (${snapshot.visionModelAvailable ? "available" : "missing"})`,
    `Fast routing: ${snapshot.fastRoutingEnabled ? "enabled" : "disabled"}`,
    `Database path: ${snapshot.databasePath}`,
    `Workspace root: ${snapshot.workspaceRoot}`,
    `Allowed roots: ${snapshot.allowedRoots.join(", ")}`,
    ...(snapshot.workerHostProfileRoot
      ? [`Host profile root: ${snapshot.workerHostProfileRoot}`]
      : []),
    ...(snapshot.browserProfileDir
      ? [`Browser profile root: ${snapshot.browserProfileDir}`]
      : []),
    `Pending approvals in this chat: ${snapshot.pendingApprovalCount}`,
    `Tasks: queued ${snapshot.taskCounts.queued}, running ${snapshot.taskCounts.running}, waiting approval ${snapshot.taskCounts.waiting_approval}, completed ${snapshot.taskCounts.completed}, failed ${snapshot.taskCounts.failed}, canceled ${snapshot.taskCounts.canceled}`
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

function createTelegramSink(
  context: Pick<CommandContext, "chat" | "api" | "reply">,
  logger: Logger,
  internalChatId: string
): NotificationSink {
  const target: TelegramNotificationTarget = {
    sendText: async (text: string) => {
      await context.reply(text);
    },
    ...(context.api?.sendPhoto
      ? {
          sendImage: async (attachmentPath: string, caption?: string) => {
            try {
              await fs.stat(attachmentPath);
              await context.api?.sendPhoto?.(
                context.chat?.id ?? internalChatId,
                new InputFile(attachmentPath),
                caption ? { caption } : undefined
              );
            } catch (error) {
              logger.warn("telegram.message.attachment_failed", {
                chatId: internalChatId,
                attachmentPath,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        }
      : {})
  };

  return new TelegramContextNotificationSink(target, logger);
}

function composeNotificationSink(
  telegramSink: NotificationSink,
  secondaryNotificationSink?: NotificationSink
): NotificationSink {
  if (!secondaryNotificationSink) {
    return telegramSink;
  }

  return new CompositeNotificationSink([telegramSink, secondaryNotificationSink]);
}

interface MessageHandlerDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  taskRuntime: TaskRuntime;
  queue: ChatTaskQueue;
  logger: Logger;
  secondaryNotificationSink?: NotificationSink;
}

export function createMessageHandler(dependencies: MessageHandlerDependencies) {
  return async (context: MessageContext): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      ) ||
      !context.message
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const chat = context.chat;

    if (
      typeof context.message.text === "string" &&
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
        userId: String(context.from.id)
      });
      await context.reply(LIVE_STEERING_MESSAGE);
      return;
    }

    if (typeof context.message.text !== "string" || context.message.text.trim().length === 0) {
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
      userId: String(context.from.id)
    });

    await context.api.sendChatAction?.(chat.id, "typing");
    const sink = composeNotificationSink(
      createTelegramSink(context, dependencies.logger, chatId),
      dependencies.secondaryNotificationSink
    );
    await dependencies.taskRuntime.submitTask(chatId, context.message.text, sink);

    dependencies.logger.info("telegram.message.replied", {
      chatId,
      userId: String(context.from.id)
    });
  };
}

interface NewCommandDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  memoryStore: MemoryStoreLike;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createNewCommandHandler(dependencies: NewCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
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
  allowedChatIds: string[];
  approvalStore: ApprovalStore;
  taskRuntime: TaskRuntime;
  logger: Logger;
  secondaryNotificationSink?: NotificationSink;
}

interface LastErrorCommandDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  errorStore: RuntimeErrorStore;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface ApprovalsCommandDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  approvalStore: ApprovalStore;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface StatusCommandDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  statusService: StatusService;
  queue: ChatTaskQueue;
  logger: Logger;
}

interface CancelCommandDependencies {
  allowedUserId: string;
  allowedChatIds: string[];
  taskRuntime: TaskRuntime;
  logger: Logger;
}

export function createHelpCommandHandler(dependencies: {
  allowedUserId: string;
  allowedChatIds: string[];
  queue: ChatTaskQueue;
  logger: Logger;
}) {
  return async (context: CommandContext): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const userId = String(context.from.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.logger.info("telegram.command.help", {
        chatId,
        userId
      });
      await context.reply(HELP_MESSAGE);
    });
  };
}

export function createApproveCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const approvalId = rawArgument ? parseCommandArgument(`/approve ${rawArgument}`) : undefined;
    const approval = dependencies.approvalStore.peek(chatId, approvalId);

    if (!approval) {
      await context.reply("No pending approval found for this chat.");
      return;
    }

    dependencies.logger.info("telegram.command.approve", {
      chatId,
      approvalId: approval.id
    });

    const sink = composeNotificationSink(
      createTelegramSink(context, dependencies.logger, chatId),
      dependencies.secondaryNotificationSink
    );
    const result = await dependencies.taskRuntime.approvePending(chatId, approvalId, sink);

    if (!approval.taskId) {
      await context.reply(result.replyText);
    }
  };
}

export function createDenyCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const approvalId = rawArgument ? parseCommandArgument(`/deny ${rawArgument}`) : undefined;
    const approval = dependencies.taskRuntime.denyPending(chatId, approvalId);

    if (!approval) {
      await context.reply("No pending approval found for this chat.");
      return;
    }

    dependencies.logger.info("telegram.command.deny", {
      chatId,
      approvalId: approval.id
    });

    await context.reply(
      `Denied ${approval.kind === "external_action" ? "action" : "command"} ${approval.id}.`
    );
  };
}

export function createApprovalsCommandHandler(dependencies: ApprovalsCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
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
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
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
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const userId = String(context.from.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.logger.info("telegram.command.status", {
        chatId,
        userId
      });

      const status = await dependencies.statusService.getStatus(chatId);
      await context.reply(formatStatusReply(status));
    });
  };
}

export function createCancelCommandHandler(dependencies: CancelCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (
      !context.from ||
      !context.chat ||
      !isAuthorizedContext(
        context.from.id,
        dependencies.allowedUserId,
        context.chat,
        dependencies.allowedChatIds
      )
    ) {
      return;
    }

    const chatId = String(context.chat.id);
    const canceled = dependencies.taskRuntime.requestCancel(chatId);

    dependencies.logger.info("telegram.command.cancel", {
      chatId,
      canceled
    });

    await context.reply(canceled ? CANCEL_REQUESTED_MESSAGE : NO_ACTIVE_TASK_TO_CANCEL_MESSAGE);
  };
}
