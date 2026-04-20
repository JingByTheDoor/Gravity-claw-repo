import path from "node:path";
import { createTransport } from "nodemailer";
import type { Bot } from "grammy";
import { AgentLoop } from "../agent/loop.js";
import { ChatTaskQueue } from "../agent/queue.js";
import { ApprovalStore } from "../approvals/store.js";
import type { AppEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import { createLogger } from "../logging/logger.js";
import { OllamaModelProvider } from "../llm/provider.js";
import { FastFirstTaskRouter } from "../llm/task-router.js";
import { MemoryStore } from "../memory/store.js";
import { DefaultApprovalPolicy } from "../runtime/approval-policy.js";
import { SqliteArtifactStore } from "../runtime/artifact-store.js";
import { EmailNotificationSink } from "../runtime/notification-sink.js";
import { TaskRuntime } from "../runtime/task-runtime.js";
import { TaskStore } from "../runtime/task-store.js";
import { LocalWorkerSession } from "../runtime/worker-session.js";
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
  modelProvider: OllamaModelProvider;
  memoryStore: MemoryStore;
  approvalStore: ApprovalStore;
  errorStore: RuntimeErrorStore;
  taskStore: TaskStore;
  taskRuntime: TaskRuntime;
  shellRunner: ShellRunner;
  appLauncher: AppLauncher;
  browserController: BrowserController;
  desktopController: DesktopController;
  visionClient: VisionClient;
  workerSession: LocalWorkerSession;
  statusService: StatusService;
}

export async function buildApp(env: AppEnv = loadEnv()): Promise<AppServices> {
  if (env.timeZone) {
    process.env.TZ = env.timeZone;
  }

  const logger = createLogger(env.logLevel);
  const workspaceRoot = env.workspaceRoot ?? process.cwd();
  const allowedRoots = env.workerHostProfileRoot
    ? [...env.toolAllowedRoots, env.workerHostProfileRoot]
    : env.toolAllowedRoots;
  const pathAccessPolicy = createPathAccessPolicy(workspaceRoot, allowedRoots);
  const memoryStore = new MemoryStore(env.databasePath, logger);
  const approvalStore = new ApprovalStore(env.databasePath);
  const errorStore = new RuntimeErrorStore(env.databasePath);
  const taskStore = new TaskStore(env.databasePath);
  const artifactStore = new SqliteArtifactStore(taskStore);
  const shellRunner = new ShellRunner();
  const appLauncher = new AppLauncher({ logger });
  const browserProfileDir =
    env.browserUserDataDir ??
    path.resolve(workspaceRoot, "artifacts", "browser-profiles");
  const browserController = new BrowserController({
    logger,
    userDataDirRoot: browserProfileDir,
    headless: env.browserHeadless
  });
  const desktopController = new DesktopController({ logger, appLauncher });
  const modelProvider = new OllamaModelProvider({
    host: env.ollamaHost,
    logger
  });
  const visionClient = modelProvider.createVisionClient(env.ollamaVisionModel);
  const approvalPolicy = new DefaultApprovalPolicy();
  const toolRegistry = createDefaultToolRegistry({
    memoryStore,
    pathAccessPolicy,
    approvalStore,
    shellRunner,
    appLauncher,
    browserController,
    desktopController,
    visionClient,
    approvalPolicy,
    logger
  });
  const workerSession = new LocalWorkerSession({
    label: env.workerLabel,
    mode: env.workerMode,
    ...(env.workerHostProfileRoot ? { hostProfileRoot: env.workerHostProfileRoot } : {}),
    browserProfileDir,
    pathAccessPolicy,
    toolRegistry,
    browserController,
    desktopController,
    shellRunner,
    logger
  });
  const statusService = new StatusService({
    env,
    pathAccessPolicy,
    approvalStore,
    errorStore,
    taskStore,
    workerSession,
    logger
  });
  const ollamaClient = modelProvider.createChatClient(env.ollamaModel);
  const fastOllamaClient = modelProvider.createChatClient(env.ollamaFastModel);

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
  const taskRuntime = new TaskRuntime({
    agentLoop,
    taskStore,
    artifactStore,
    approvalStore,
    queue,
    pathAccessPolicy,
    shellRunner,
    logger
  });

  let emailNotificationSink: EmailNotificationSink | undefined;
  if (env.emailNotificationsEnabled && env.smtpHost) {
    const transportOptions: {
      host: string;
      port: number;
      secure: boolean;
      auth?: {
        user: string;
        pass: string;
      };
    } = {
      host: env.smtpHost,
      port: env.smtpPort ?? 587,
      secure: env.smtpSecure ?? false
    };

    if (env.smtpUser) {
      transportOptions.auth = {
        user: env.smtpUser,
        pass: env.smtpPassword ?? ""
      };
    }

    emailNotificationSink = new EmailNotificationSink({
      enabled: env.emailNotificationsEnabled,
      ...(env.emailNotificationFrom ? { from: env.emailNotificationFrom } : {}),
      ...(env.emailNotificationTo ? { to: env.emailNotificationTo } : {}),
      subjectPrefix: env.workerLabel,
      transport: createTransport(transportOptions),
      logger
    });
  }

  const bot = createBot({
    botToken: env.telegramBotToken,
    allowedUserId: env.telegramAllowedUserId,
    allowedChatIds: env.telegramAllowedChatIds,
    taskRuntime,
    memoryStore,
    approvalStore,
    errorStore,
    pathAccessPolicy,
    queue,
    logger,
    statusService,
    ...(emailNotificationSink ? { notificationSink: emailNotificationSink } : {})
  });

  const recoveredTasks = taskRuntime.recoverInterruptedTasks();
  if (recoveredTasks.length > 0) {
    logger.warn("runtime.tasks.recovered", {
      count: recoveredTasks.length
    });
  }

  return {
    env,
    bot,
    agentLoop,
    modelProvider,
    memoryStore,
    approvalStore,
    errorStore,
    taskStore,
    taskRuntime,
    shellRunner,
    appLauncher,
    browserController,
    desktopController,
    visionClient,
    workerSession,
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
            toolAllowedRoots: app.env.toolAllowedRoots,
            workerLabel: app.env.workerLabel,
            workerMode: app.env.workerMode,
            workerHostProfileRoot: app.env.workerHostProfileRoot ?? null,
            browserProfileDir: app.workerSession.browserProfileDir ?? null
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
