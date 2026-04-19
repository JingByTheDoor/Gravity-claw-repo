import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRunResponse } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import { createLogger } from "../src/logging/logger.js";
import { MemoryStore } from "../src/memory/store.js";

function createTempDatabasePath(): string {
  return path.join(os.tmpdir(), `gravity-claw-test-${Date.now()}-${Math.random()}.db`);
}

const databasePaths: string[] = [];

afterEach(() => {
  for (const databasePath of databasePaths.splice(0)) {
    try {
      fs.rmSync(databasePath, { force: true });
    } catch {
      // ignore cleanup failure in tests
    }
  }
});

describe("MemoryStore", () => {
  it("persists facts and recent conversation context", () => {
    const databasePath = createTempDatabasePath();
    databasePaths.push(databasePath);
    const store = new MemoryStore(databasePath, createLogger("error"));

    store.rememberFact("chat-1", "timezone", "America/Vancouver");
    store.saveConversationTurn("chat-1", "hello", "hi there");

    const promptContext = store.getPromptContext("chat-1", 20);
    expect(promptContext.coreFacts).toEqual([{ key: "timezone", value: "America/Vancouver" }]);
    expect(promptContext.recentMessages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" }
    ]);

    store.close();
  });

  it("recalls prior messages through FTS search", () => {
    const databasePath = createTempDatabasePath();
    databasePaths.push(databasePath);
    const store = new MemoryStore(databasePath, createLogger("error"));

    store.saveConversationTurn("chat-1", "My favorite fruit is mango", "I'll remember that.");

    const result = store.recallMemory("chat-1", "mango", 5);
    expect(result.messageMatches[0]?.content).toMatch(/mango/i);

    store.close();
  });

  it("compacts older conversation into a rolling summary", async () => {
    const databasePath = createTempDatabasePath();
    databasePaths.push(databasePath);
    const store = new MemoryStore(databasePath, createLogger("error"));

    for (let index = 0; index < 16; index += 1) {
      store.saveConversationTurn("chat-1", `user ${index}`, `assistant ${index}`);
    }

    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "- User likes local-first tools\n- Ongoing project: Gravity Claw"
        }
      }))
    };

    await store.compactConversation("chat-1", llmClient);

    const promptContext = store.getPromptContext("chat-1", 50);
    expect(promptContext.latestSummary).toMatch(/Gravity Claw/);
    expect(promptContext.recentMessages.length).toBeLessThanOrEqual(20);

    store.close();
  });

  it("resets conversation history without deleting durable facts", () => {
    const databasePath = createTempDatabasePath();
    databasePaths.push(databasePath);
    const store = new MemoryStore(databasePath, createLogger("error"));

    store.rememberFact("chat-1", "timezone", "America/Vancouver");
    store.saveConversationTurn("chat-1", "hello", "hi there");

    store.resetConversation("chat-1");

    const promptContext = store.getPromptContext("chat-1", 20);
    expect(promptContext.coreFacts).toEqual([{ key: "timezone", value: "America/Vancouver" }]);
    expect(promptContext.recentMessages).toEqual([]);

    store.close();
  });
});
