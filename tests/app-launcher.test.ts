import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { AppLauncher } from "../src/tools/app-launcher.js";

describe("AppLauncher", () => {
  it("launches an exact installed app match", async () => {
    const launchAppId = vi.fn(async () => undefined);
    const launcher = new AppLauncher({
      logger: createLogger("error"),
      platform: "win32",
      listStartApps: async () => [
        { name: "Figma", appId: "figma.app" },
        { name: "Telegram", appId: "telegram.app" }
      ],
      launchAppId
    });

    const result = await launcher.launch("figma");

    expect(result.ok).toBe(true);
    expect(result.matchedName).toBe("Figma");
    expect(launchAppId).toHaveBeenCalledWith("figma.app");
  });

  it("matches friendly names with spacing differences", async () => {
    const launcher = new AppLauncher({
      logger: createLogger("error"),
      platform: "win32",
      listStartApps: async () => [{ name: "ChatGPT", appId: "chatgpt.app" }],
      launchAppId: async () => undefined
    });

    const result = await launcher.resolve("chat gpt");

    expect(result.ok).toBe(true);
    expect(result.app?.name).toBe("ChatGPT");
  });

  it("returns a safe not-found result when no app matches", async () => {
    const launcher = new AppLauncher({
      logger: createLogger("error"),
      platform: "win32",
      listStartApps: async () => [{ name: "Figma", appId: "figma.app" }],
      launchAppId: async () => undefined
    });

    const result = await launcher.launch("Photoshop");

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No installed app matched "Photoshop"');
  });

  it("returns an ambiguous result when multiple apps are similarly close", async () => {
    const launcher = new AppLauncher({
      logger: createLogger("error"),
      platform: "win32",
      listStartApps: async () => [
        { name: "Telegram", appId: "telegram.app" },
        { name: "Telegram Desktop", appId: "telegram-desktop.app" }
      ],
      launchAppId: async () => undefined
    });

    const result = await launcher.resolve("tele");

    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toEqual(["Telegram", "Telegram Desktop"]);
  });
});
