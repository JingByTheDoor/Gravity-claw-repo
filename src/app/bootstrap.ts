import type { Bot } from "grammy";
import { AgentLoop } from "../agent/loop.js";
import { ChatTaskQueue } from "../agent/queue.js";
import { ApprovalStore } from "../approvals/store.js";
import type { AppEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import { createLogger } from "../logging/logger.js";
import { OllamaClient } from "../llm/ollama-client.js";
import { FastFirstTaskRouter } from "../llm/task-router.js";
import { MemoryStore } from "../memory/store.js";
import { createBot } from "../telegram/bot.js";
import { StatusService } from "./status-service.js";
import { AppLauncher } from "../tools/app-launcher.js";
import { BrowserController } from "../tools/browser-controller.js";
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
  errorStore: RuntimeErrorStore;
  shellRunner: ShellRunner;
  appLauncher: AppLauncher;
  browserController: BrowserController;
  desktopController: DesktopController;
  visionClient: VisionClient;
  statusService: StatusService;
}

export async function buildApp(env: AppEnv = loadEnv()): Promise<AppServices> {
  if (env.timeZone) {
    process.env.TZ = env.timeZone;
  }

  const logger = createLogger(env.logLevel);
  const workspaceRoot = env.workspaceRoot ?? process.cwd();
  const pathAccessPolicy = createPathAccessPolicy(workspaceRoot, env.toolAllowedRoots);
  const memoryStore = new MemoryStore(env.databasePath, logger);
  const approvalStore = new ApprovalStore(env.databasePath);
  const errorStore = new RuntimeErrorStore(env.databasePath);
  const shellRunner = new ShellRunner();
  const appLauncher = new AppLauncher({ logger });
  const browserController = new BrowserController({ logger });
  const desktopController = new DesktopController({ logger, appLauncher });
  const visionClient = new VisionClient({
    host: env.ollamaHost,
    model: env.ollamaVisionModel,
    logger
  });
  const statusService = new StatusService({
    env,
    pathAccessPolicy,
    approvalStore,
    errorStore,
    logger
  });
  const toolRegistry = createDefaultToolRegistry({
    memoryStore,
    pathAccessPolicy,
    approvalStore,
    shellRunner,
    appLauncher,
    browserController,
    desktopController,
    visionClient,
    logger
  });
  const ollamaClient = new OllamaClient({
    host: env.ollamaHost,
    model: env.ollamaModel,
    logger
  });
  const fastOllamaClient = new OllamaClient({
    host: env.ollamaHost,
    model: env.ollamaFastModel,
    logger
  });

  await Promise.all([
    ollamaClient.checkHealth(),
    ...(env.ollamaVisionModel !== env.ollamaModel
      ? [visionClient.checkHealth()]
      : []),
    ...(env.ollamaFastModel !== env.ollamaModel ? [fastOllamaClient.checkHealth()] : [])
  ]);

  const taskRouter =
    env.ollamaFastModel !== env.ollamaModel
      ? new FastFirstTaskRouter({
          fastClient: fastOllamaClient,
          primaryClient: ollamaClient,
          fastModel: env.ollamaFastModel,
          primaryModel: env.ollamaModel,
          logger
        })
      : undefined;

  const agentLoop = new AgentLoop({
    llmClient: ollamaClient,
    ...(taskRouter ? { taskRouter } : {}),
    toolRegistry,
    memoryStore,
    maxIterations: env.agentMaxIterations,
    logger,
    errorStore
  });

  const queue = new ChatTaskQueue();
  const bot = createBot({
    botToken: env.telegramBotToken,
    allowedUserId: env.telegramAllowedUserId,
    allowedChatIds: env.telegramAllowedChatIds,
    agentLoop,
    memoryStore,
    approvalStore,
    errorStore,
    shellRunner,
    pathAccessPolicy,
    queue,
    logger,
    statusService
  });

  return {
    env,
    bot,
    agentLoop,
    ollamaClient,
    memoryStore,
    approvalStore,
    errorStore,
    shellRunner,
    appLauncher,
    browserController,
    desktopController,
    visionClient,
    statusService
  };
}

export async function startApp(app: AppServices): Promise<void> {
  await app.bot.start({
    onStart(botInfo) {
      app.statusService.setBotInfo({
        id: botInfo.id,
        username: botInfo.username ?? ""
      });
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          event: "telegram.bot.started",
          meta: {
            botId: String(botInfo.id),
            botUsername: botInfo.username ?? "",
            ollamaModel: app.env.ollamaModel,
            ollamaFastModel: app.env.ollamaFastModel,
            ollamaVisionModel: app.env.ollamaVisionModel,
            fastRoutingEnabled: app.env.ollamaFastModel !== app.env.ollamaModel,
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
