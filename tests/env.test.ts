import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

describe("parseEnv", () => {
  it("fails when required Telegram values are missing", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment configuration/);
  });

  it("parses valid configuration with defaults", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_ID: "123456"
    });

    expect(env.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(env.ollamaModel).toBe("qwen2.5:3b");
    expect(env.agentMaxIterations).toBe(4);
    expect(env.databasePath).toBe("gravity-claw.db");
    expect(env.logLevel).toBe("info");
  });
});
