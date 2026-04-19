import { Bot } from "grammy";
import type { AgentLoop } from "../agent/loop.js";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { ApprovalStore } from "../approvals/store.js";
import type { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryStoreLike } from "../memory/store.js";
import type { ShellRunner } from "../tools/shell-runner.js";
import type { PathAccessPolicy } from "../tools/workspace.js";
import {
  createApproveCommandHandler,
  createDenyCommandHandler,
  createLastErrorCommandHandler,
  createMessageHandler,
  createNewCommandHandler
} from "./handlers.js";

interface CreateBotOptions {
  botToken: string;
  allowedUserId: string;
  agentLoop: AgentLoop;
  memoryStore: MemoryStoreLike;
  approvalStore: ApprovalStore;
  errorStore: RuntimeErrorStore;
  shellRunner: ShellRunner;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createBot(options: CreateBotOptions): Bot {
  const bot = new Bot(options.botToken);
  const newCommandHandler = createNewCommandHandler({
    allowedUserId: options.allowedUserId,
    memoryStore: options.memoryStore,
    queue: options.queue,
    logger: options.logger
  });
  const approveCommandHandler = createApproveCommandHandler({
    allowedUserId: options.allowedUserId,
    approvalStore: options.approvalStore,
    shellRunner: options.shellRunner,
    pathAccessPolicy: options.pathAccessPolicy,
    queue: options.queue,
    logger: options.logger
  });
  const denyCommandHandler = createDenyCommandHandler({
    allowedUserId: options.allowedUserId,
    approvalStore: options.approvalStore,
    shellRunner: options.shellRunner,
    pathAccessPolicy: options.pathAccessPolicy,
    queue: options.queue,
    logger: options.logger
  });
  const messageHandler = createMessageHandler({
    allowedUserId: options.allowedUserId,
    agentLoop: options.agentLoop,
    queue: options.queue,
    logger: options.logger
  });
  const lastErrorCommandHandler = createLastErrorCommandHandler({
    allowedUserId: options.allowedUserId,
    errorStore: options.errorStore,
    queue: options.queue,
    logger: options.logger
  });

  bot.command("new", newCommandHandler);
  bot.command("last_error", lastErrorCommandHandler);
  bot.command("approve", async (context) => approveCommandHandler(context, context.match));
  bot.command("deny", async (context) => denyCommandHandler(context, context.match));
  bot.on("message", messageHandler);
  bot.catch((error) => {
    options.logger.error("telegram.bot.error", {
      error: error.error instanceof Error ? error.error.message : String(error.error)
    });
  });

  return bot;
}
