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
  });
});
