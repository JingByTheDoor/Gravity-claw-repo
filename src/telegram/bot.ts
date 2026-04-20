import { Bot } from "grammy";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { StatusService } from "../app/status-service.js";
import type { ApprovalStore } from "../approvals/store.js";
import type { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryStoreLike } from "../memory/store.js";
import type { NotificationSink } from "../runtime/contracts.js";
import type { TaskRuntime } from "../runtime/task-runtime.js";
import type { PathAccessPolicy } from "../tools/workspace.js";
import {
  createApprovalsCommandHandler,
  createApproveCommandHandler,
  createCancelCommandHandler,
  createDenyCommandHandler,
  createHelpCommandHandler,
  createLastErrorCommandHandler,
  createMessageHandler,
  createNewCommandHandler,
  createStatusCommandHandler
} from "./handlers.js";

interface CreateBotOptions {
  botToken: string;
  allowedUserId: string;
  allowedChatIds: string[];
  taskRuntime: TaskRuntime;
  memoryStore: MemoryStoreLike;
  approvalStore: ApprovalStore;
  errorStore: RuntimeErrorStore;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
  statusService: StatusService;
  notificationSink?: NotificationSink;
}

export function createBot(options: CreateBotOptions): Bot {
  const bot = new Bot(options.botToken);
  const newCommandHandler = createNewCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    memoryStore: options.memoryStore,
    queue: options.queue,
    logger: options.logger
  });
  const approveCommandHandler = createApproveCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    approvalStore: options.approvalStore,
    taskRuntime: options.taskRuntime,
    logger: options.logger,
    ...(options.notificationSink
      ? { secondaryNotificationSink: options.notificationSink }
      : {})
  });
  const helpCommandHandler = createHelpCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    queue: options.queue,
    logger: options.logger
  });
  const statusCommandHandler = createStatusCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    statusService: options.statusService,
    queue: options.queue,
    logger: options.logger
  });
  const approvalsCommandHandler = createApprovalsCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    approvalStore: options.approvalStore,
    pathAccessPolicy: options.pathAccessPolicy,
    queue: options.queue,
    logger: options.logger
  });
  const cancelCommandHandler = createCancelCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    taskRuntime: options.taskRuntime,
    logger: options.logger
  });
  const denyCommandHandler = createDenyCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    approvalStore: options.approvalStore,
    taskRuntime: options.taskRuntime,
    logger: options.logger,
    ...(options.notificationSink
      ? { secondaryNotificationSink: options.notificationSink }
      : {})
  });
  const messageHandler = createMessageHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    taskRuntime: options.taskRuntime,
    queue: options.queue,
    logger: options.logger,
    ...(options.notificationSink
      ? { secondaryNotificationSink: options.notificationSink }
      : {})
  });
  const lastErrorCommandHandler = createLastErrorCommandHandler({
    allowedUserId: options.allowedUserId,
    allowedChatIds: options.allowedChatIds,
    errorStore: options.errorStore,
    queue: options.queue,
    logger: options.logger
  });

  bot.command("help", helpCommandHandler);
  bot.command("new", newCommandHandler);
  bot.command("status", statusCommandHandler);
  bot.command("approvals", approvalsCommandHandler);
  bot.command("last_error", lastErrorCommandHandler);
  bot.command("approve", async (context) => approveCommandHandler(context, context.match));
  bot.command("deny", async (context) => denyCommandHandler(context, context.match));
  bot.command("cancel", cancelCommandHandler);
  bot.on("message", messageHandler);
  bot.catch((error) => {
    options.logger.error("telegram.bot.error", {
      error: error.error instanceof Error ? error.error.message : String(error.error)
    });
  });

  return bot;
}
