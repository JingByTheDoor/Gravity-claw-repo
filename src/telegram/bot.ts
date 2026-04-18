import { Bot } from "grammy";
import type { AgentLoop } from "../agent/loop.js";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { Logger } from "../logging/logger.js";
import { createMessageHandler } from "./handlers.js";

interface CreateBotOptions {
  botToken: string;
  allowedUserId: string;
  agentLoop: AgentLoop;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createBot(options: CreateBotOptions): Bot {
  const bot = new Bot(options.botToken);
  const messageHandler = createMessageHandler({
    allowedUserId: options.allowedUserId,
    agentLoop: options.agentLoop,
    queue: options.queue,
    logger: options.logger
  });

  bot.on("message", messageHandler);
  bot.catch((error) => {
    options.logger.error("telegram.bot.error", {
      error: error.error instanceof Error ? error.error.message : String(error.error)
    });
  });

  return bot;
}
