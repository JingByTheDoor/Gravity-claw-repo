import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

describe("environment parsing", () => {
  it("parses multiple trusted tool roots", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "123",
      TOOL_ALLOWED_ROOTS: "C:\\Users\\User\\Desktop;C:\\Users\\User\\Documents"
    });

    expect(env.toolAllowedRoots).toEqual([
      "C:\\Users\\User\\Desktop",
      "C:\\Users\\User\\Documents"
    ]);
  });

  it("defaults to no extra trusted tool roots", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "123"
    });

    expect(env.toolAllowedRoots).toEqual([]);
    expect(env.ollamaFastModel).toBe(env.ollamaModel);
    expect(env.ollamaVisionModel).toBe(env.ollamaModel);
  });

  it("parses an explicit fast routing model", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "123",
      OLLAMA_MODEL: "qwen2.5:7b",
      OLLAMA_FAST_MODEL: "qwen2.5:1.5b"
    });

    expect(env.ollamaModel).toBe("qwen2.5:7b");
    expect(env.ollamaFastModel).toBe("qwen2.5:1.5b");
  });

  it("parses an explicit vision model override", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "123",
      OLLAMA_MODEL: "qwen2.5:7b",
      OLLAMA_VISION_MODEL: "gemma3:12b"
    });

    expect(env.ollamaModel).toBe("qwen2.5:7b");
    expect(env.ollamaVisionModel).toBe("gemma3:12b");
  });
});
