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
      logger: createLogger("error")
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
      logger: createLogger("error")
    });

    await expect(client.checkHealth()).rejects.toThrow(/not available locally/i);
  });
});
