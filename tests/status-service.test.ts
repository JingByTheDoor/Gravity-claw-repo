import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusService } from "../src/app/status-service.js";
import { ApprovalStore } from "../src/approvals/store.js";
import type { AppEnv } from "../src/config/env.js";
import { RuntimeErrorStore } from "../src/errors/runtime-error-store.js";
import { createLogger } from "../src/logging/logger.js";
import { createPathAccessPolicy } from "../src/tools/workspace.js";

const databasePaths: string[] = [];

function createTempDatabasePath(): string {
  const filePath = path.join(os.tmpdir(), `gravity-claw-status-${Date.now()}-${Math.random()}.db`);
  databasePaths.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const databasePath of databasePaths.splice(0)) {
    fs.rmSync(databasePath, { force: true });
  }
});

function createEnv(databasePath: string): AppEnv {
  return {
    telegramBotToken: "token",
    telegramAllowedUserId: "123",
    telegramAllowedChatIds: [],
    ollamaHost: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    ollamaFastModel: "qwen2.5:1.5b",
    ollamaVisionModel: "gemma4:latest",
    workerLabel: "Gravity Claw Worker",
    workerMode: "local",
    browserHeadless: true,
    emailNotificationsEnabled: false,
    agentMaxIterations: 4,
    databasePath,
    workspaceRoot: process.cwd(),
    toolAllowedRoots: [],
    logLevel: "info"
  };
}

describe("StatusService", () => {
  it("reports model availability, approvals, and the last error", async () => {
    const databasePath = createTempDatabasePath();
    const approvalStore = new ApprovalStore(databasePath);
    const errorStore = new RuntimeErrorStore(databasePath);
    approvalStore.createShellApproval("chat-1", "npm install", process.cwd());
    errorStore.record("chat-1", "agent.run", "failure");

    const service = new StatusService({
      env: createEnv(databasePath),
      pathAccessPolicy: createPathAccessPolicy(process.cwd()),
      approvalStore,
      errorStore,
      logger: createLogger("error"),
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({
          models: [{ name: "qwen2.5:3b" }, { name: "qwen2.5:1.5b" }, { name: "gemma4:latest" }]
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        })
      ) as typeof fetch
    });
    service.setBotInfo({
      id: 42,
      username: "gravity_claw_bot"
    });

    const result = await service.getStatus("chat-1");

    expect(result.bot?.id).toBe(42);
    expect(result.ollamaReachable).toBe(true);
    expect(result.chatModelAvailable).toBe(true);
    expect(result.fastModelAvailable).toBe(true);
    expect(result.visionModelAvailable).toBe(true);
    expect(result.pendingApprovalCount).toBe(1);
    expect(result.latestLocalErrorScope).toBe("agent.run");

    approvalStore.close();
    errorStore.close();
  });
});
