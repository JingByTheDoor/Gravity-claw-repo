import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import type { OllamaSamplingConfig } from "../src/llm/gemma.js";
import { OllamaClient } from "../src/llm/ollama-client.js";

const sampling: OllamaSamplingConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64
};

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
      sampling,
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
      sampling,
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
      sampling,
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
      logger: createLogger("error"),
      sampling
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

  it("uses configured sampling options and strips leading Gemma thought blocks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: {
            content: "<|channel>thought\nhidden reasoning<channel|>Final answer"
          }
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
      model: "gemma4:latest",
      logger: createLogger("error"),
      sampling
    });

    const response = await client.runStep({
      messages: [{ role: "user", content: "hello" }],
      tools: []
    });

    expect(response.message.content).toBe("Final answer");

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      options?: Record<string, unknown>;
    };
    expect(body.options).toEqual({
      temperature: 1,
      top_p: 0.95,
      top_k: 64
    });
  });
});
