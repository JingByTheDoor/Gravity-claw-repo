import type { Bot } from "grammy";
import { AgentLoop } from "../agent/loop.js";
import { ChatTaskQueue } from "../agent/queue.js";
import { ApprovalStore } from "../approvals/store.js";
import type { AppEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../logging/logger.js";
import { OllamaClient } from "../llm/ollama-client.js";
import { MemoryStore } from "../memory/store.js";
import { createBot } from "../telegram/bot.js";
import { AppLauncher } from "../tools/app-launcher.js";
import { DesktopController } from "../tools/desktop-controller.js";
import { createDefaultToolRegistry } from "../tools/registry.js";
import { ShellRunner } from "../tools/shell-runner.js";
import { VisionClient } from "../tools/vision-client.js";
import { createPathAccessPolicy } from "../tools/workspace.js";

export interface AppServices {
  env: AppEnv;
  bot: Bot;
  agentLoop: AgentLoop;
  ollamaClient: OllamaClient;
  memoryStore: MemoryStore;
  approvalStore: ApprovalStore;
  shellRunner: ShellRunner;
  appLauncher: AppLauncher;
  desktopController: DesktopController;
  visionClient: VisionClient;
}

export async function buildApp(env: AppEnv = loadEnv()): Promise<AppServices> {
  if (env.timeZone) {
    process.env.TZ = env.timeZone;
  }

  const logger = createLogger(env.logLevel);
  const workspaceRoot = env.workspaceRoot ?? process.cwd();
  const pathAccessPolicy = createPathAccessPolicy(workspaceRoot, env.toolAllowedRoots);
  const memoryStore = new MemoryStore(env.databasePath, logger);
  const approvalStore = new ApprovalStore();
  const shellRunner = new ShellRunner();
  const appLauncher = new AppLauncher({ logger });
  const desktopController = new DesktopController({ logger, appLauncher });
  const visionClient = new VisionClient({
    host: env.ollamaHost,
    model: env.ollamaModel,
    logger
  });
  const toolRegistry = createDefaultToolRegistry({
    memoryStore,
    pathAccessPolicy,
    approvalStore,
    shellRunner,
    appLauncher,
    desktopController,
    visionClient,
    logger
  });
  const ollamaClient = new OllamaClient({
    host: env.ollamaHost,
    model: env.ollamaModel,
    logger
  });

  await ollamaClient.checkHealth();

  const agentLoop = new AgentLoop({
    llmClient: ollamaClient,
    toolRegistry,
    memoryStore,
    maxIterations: env.agentMaxIterations,
    logger
  });

  const queue = new ChatTaskQueue();
  const bot = createBot({
    botToken: env.telegramBotToken,
    allowedUserId: env.telegramAllowedUserId,
    agentLoop,
    memoryStore,
    approvalStore,
    shellRunner,
    pathAccessPolicy,
    queue,
    logger
  });

  return {
    env,
    bot,
    agentLoop,
    ollamaClient,
    memoryStore,
    approvalStore,
    shellRunner,
    appLauncher,
    desktopController,
    visionClient
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
            ollamaModel: app.env.ollamaModel,
            databasePath: app.env.databasePath,
            workspaceRoot: app.env.workspaceRoot ?? process.cwd(),
            toolAllowedRoots: app.env.toolAllowedRoots
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
