import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import type { LLMRunResponse } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import { FallbackLLMClient } from "../src/llm/fallback-client.js";

describe("FallbackLLMClient", () => {
  it("returns the primary response when the primary model succeeds", async () => {
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "primary"
        }
      }))
    };
    const fallbackClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "fallback"
        }
      }))
    };

    const client = new FallbackLLMClient({
      primaryClient,
      primaryModel: "primary-model",
      fallbackClient,
      fallbackModel: "fallback-model",
      logger: createLogger("error")
    });

    await expect(
      client.runStep({
        messages: [{ role: "user", content: "hello" }],
        tools: []
      })
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: "primary"
      }
    });

    expect(primaryClient.runStep).toHaveBeenCalledTimes(1);
    expect(fallbackClient.runStep).not.toHaveBeenCalled();
  });

  it("falls back when the primary model has a retryable Ollama chat failure", async () => {
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async () => {
        throw new Error(
          'Ollama chat request failed for model "gemma4:e2b" at http://127.0.0.1:11434/api/chat: fetch failed'
        );
      })
    };
    const fallbackClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "fallback reply"
        }
      }))
    };

    const client = new FallbackLLMClient({
      primaryClient,
      primaryModel: "gemma4:e2b",
      fallbackClient,
      fallbackModel: "qwen2.5:3b",
      logger: createLogger("error")
    });

    await expect(
      client.runStep({
        messages: [{ role: "user", content: "hello" }],
        tools: []
      })
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: "fallback reply"
      }
    });

    expect(primaryClient.runStep).toHaveBeenCalledTimes(1);
    expect(fallbackClient.runStep).toHaveBeenCalledTimes(1);
  });

  it("keeps the original error when there is no distinct fallback model", async () => {
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async () => {
        throw new Error(
          'Ollama chat request failed for model "gemma4:e2b" at http://127.0.0.1:11434/api/chat: fetch failed'
        );
      })
    };

    const client = new FallbackLLMClient({
      primaryClient,
      primaryModel: "gemma4:e2b",
      fallbackModel: "gemma4:e2b",
      logger: createLogger("error")
    });

    await expect(
      client.runStep({
        messages: [{ role: "user", content: "hello" }],
        tools: []
      })
    ).rejects.toThrow(/fetch failed/);
  });
});
