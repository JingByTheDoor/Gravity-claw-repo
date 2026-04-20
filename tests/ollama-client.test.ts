import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { OllamaClient } from "../src/llm/ollama-client.js";

describe("OllamaClient.checkHealth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails cleanly when Ollama is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const client = new OllamaClient({
      host: "http://127.0.0.1:11434",
      model: "qwen2.5:3b",
      logger: createLogger("error"),
      healthCheckMaxAttempts: 1,
      healthCheckRetryDelayMs: 0
    });

    await expect(client.checkHealth()).rejects.toThrow(/unreachable/i);
  });

  it("fails cleanly when the configured model is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [{ name: "other-model:latest" }]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    const client = new OllamaClient({
      host: "http://127.0.0.1:11434",
      model: "qwen2.5:3b",
      logger: createLogger("error"),
      healthCheckMaxAttempts: 1,
      healthCheckRetryDelayMs: 0
    });

    await expect(client.checkHealth()).rejects.toThrow(/not available locally/i);
  });

  it("retries reachability failures until Ollama responds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [{ name: "qwen2.5:3b" }]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      );

    const client = new OllamaClient({
      host: "http://127.0.0.1:11434",
      model: "qwen2.5:3b",
      logger: createLogger("error"),
      healthCheckMaxAttempts: 3,
      healthCheckRetryDelayMs: 0
    });

    await expect(client.checkHealth()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("OllamaClient.runStep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps fetch failures with host and model context", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fetch failed"));

    const client = new OllamaClient({
      host: "http://127.0.0.1:11434",
      model: "gemma4:latest",
      logger: createLogger("error")
    });

    await expect(
      client.runStep({
        messages: [{ role: "user", content: "hello" }],
        tools: []
      })
    ).rejects.toThrow(
      'Ollama chat request failed for model "gemma4:latest" at http://127.0.0.1:11434/api/chat: fetch failed'
    );
  });
});
