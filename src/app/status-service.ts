import type { ApprovalStore } from "../approvals/store.js";
import type { AppEnv } from "../config/env.js";
import type { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { Logger } from "../logging/logger.js";
import type { TaskStatus, WorkerSession } from "../runtime/contracts.js";
import type { TaskStore } from "../runtime/task-store.js";
import type { PathAccessPolicy } from "../tools/workspace.js";

interface StatusServiceOptions {
  env: AppEnv;
  pathAccessPolicy: PathAccessPolicy;
  approvalStore: ApprovalStore;
  errorStore: RuntimeErrorStore;
  taskStore?: TaskStore;
  workerSession?: Pick<WorkerSession, "label" | "mode" | "hostProfileRoot" | "browserProfileDir">;
  logger: Logger;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export interface BotIdentity {
  id: number;
  username: string;
}

export interface StatusSnapshot {
  bot?: BotIdentity;
  ollamaReachable: boolean;
  chatModelAvailable: boolean;
  fastModelAvailable: boolean;
  visionModelAvailable: boolean;
  error?: string;
  databasePath: string;
  workspaceRoot: string;
  allowedRoots: string[];
  ollamaHost: string;
  ollamaModel: string;
  ollamaFastModel: string;
  ollamaVisionModel: string;
  fastRoutingEnabled: boolean;
  pendingApprovalCount: number;
  workerLabel: string;
  workerMode: "local" | "vm";
  workerHostProfileRoot?: string;
  browserProfileDir?: string;
  taskCounts: Record<TaskStatus, number>;
  latestLocalErrorAt?: string;
  latestLocalErrorScope?: string;
}

export class StatusService {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private bot?: BotIdentity;

  constructor(private readonly options: StatusServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(250, options.requestTimeoutMs ?? 2_000);
  }

  setBotInfo(bot: BotIdentity): void {
    this.bot = bot;
  }

  async getStatus(chatId: string): Promise<StatusSnapshot> {
    const latestLocalError = this.options.errorStore.getLast(chatId);

    const baseStatus: StatusSnapshot = {
      ...(this.bot ? { bot: this.bot } : {}),
      ollamaReachable: false,
      chatModelAvailable: false,
      fastModelAvailable: false,
      visionModelAvailable: false,
      databasePath: this.options.env.databasePath,
      workspaceRoot: this.options.pathAccessPolicy.defaultRoot,
      allowedRoots: this.options.pathAccessPolicy.allowedRoots,
      ollamaHost: this.options.env.ollamaHost,
      ollamaModel: this.options.env.ollamaModel,
      ollamaFastModel: this.options.env.ollamaFastModel,
      ollamaVisionModel: this.options.env.ollamaVisionModel,
      fastRoutingEnabled: this.options.env.ollamaFastModel !== this.options.env.ollamaModel,
      pendingApprovalCount: this.options.approvalStore.countPending(chatId),
      workerLabel: this.options.workerSession?.label ?? this.options.env.workerLabel,
      workerMode: this.options.workerSession?.mode ?? this.options.env.workerMode,
      ...(this.options.workerSession?.hostProfileRoot
        ? { workerHostProfileRoot: this.options.workerSession.hostProfileRoot }
        : {}),
      ...(this.options.workerSession?.browserProfileDir
        ? { browserProfileDir: this.options.workerSession.browserProfileDir }
        : {}),
      taskCounts: this.options.taskStore?.countByStatus(chatId) ?? {
        queued: 0,
        running: 0,
        waiting_approval: 0,
        completed: 0,
        failed: 0,
        canceled: 0
      },
      ...(latestLocalError
        ? {
            latestLocalErrorAt: latestLocalError.createdAt,
            latestLocalErrorScope: latestLocalError.scope
          }
        : {})
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.requestTimeoutMs);

      try {
        const response = await this.fetchImpl(this.buildUrl("/api/tags"), {
          signal: controller.signal
        });
        if (!response.ok) {
          return {
            ...baseStatus,
            error: `Ollama returned ${response.status} ${response.statusText}`
          };
        }

        const payload = (await response.json()) as OllamaTagsResponse;
        const modelNames = new Set(
          (payload.models ?? []).flatMap((model) => (model.name ? [model.name] : []))
        );

        return {
          ...baseStatus,
          ollamaReachable: true,
          chatModelAvailable: modelNames.has(this.options.env.ollamaModel),
          fastModelAvailable: modelNames.has(this.options.env.ollamaFastModel),
          visionModelAvailable: modelNames.has(this.options.env.ollamaVisionModel)
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.logger.warn("status.ollama.unreachable", {
        error: errorMessage
      });

      return {
        ...baseStatus,
        error: errorMessage
      };
    }
  }

  private buildUrl(pathname: string): string {
    const base = this.options.env.ollamaHost.replace(/\/+$/, "");
    return `${base}${pathname}`;
  }
}
