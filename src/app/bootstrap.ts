import type { Bot } from "grammy";
import { AgentLoop } from "../agent/loop.js";
import { ChatTaskQueue } from "../agent/queue.js";
import type { AppEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../logging/logger.js";
import { OllamaClient } from "../llm/ollama-client.js";
import { createBot } from "../telegram/bot.js";
import { createDefaultToolRegistry } from "../tools/registry.js";

export interface AppServices {
  env: AppEnv;
  bot: Bot;
  agentLoop: AgentLoop;
  ollamaClient: OllamaClient;
}

export async function buildApp(env: AppEnv = loadEnv()): Promise<AppServices> {
  if (env.timeZone) {
    process.env.TZ = env.timeZone;
  }

  const logger = createLogger(env.logLevel);
  const toolRegistry = createDefaultToolRegistry();
  const ollamaClient = new OllamaClient({
    host: env.ollamaHost,
    model: env.ollamaModel,
    logger
  });

  await ollamaClient.checkHealth();

  const agentLoop = new AgentLoop({
    llmClient: ollamaClient,
    toolRegistry,
    maxIterations: env.agentMaxIterations,
    logger
  });

  const queue = new ChatTaskQueue();
  const bot = createBot({
    botToken: env.telegramBotToken,
    allowedUserId: env.telegramAllowedUserId,
    agentLoop,
    queue,
    logger
  });

  return {
    env,
    bot,
    agentLoop,
    ollamaClient
  };
}

export async function startApp(app: AppServices): Promise<void> {
  await app.bot.start({
    drop_pending_updates: true,
    onStart(botInfo) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          event: "telegram.bot.started",
          meta: {
            botId: String(botInfo.id),
            botUsername: botInfo.username ?? "",
            ollamaModel: app.env.ollamaModel
          }
        })
      );
    }
  });
}

export async function bootstrap(): Promise<void> {
  const app = await buildApp();
  await startApp(app);
}
