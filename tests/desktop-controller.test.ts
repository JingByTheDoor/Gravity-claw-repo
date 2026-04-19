import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { AppLauncher } from "../src/tools/app-launcher.js";
import { DesktopController } from "../src/tools/desktop-controller.js";

describe("DesktopController", () => {
  it("lists running and installed apps with query filtering", async () => {
    const runPowerShell = vi.fn(async () =>
      JSON.stringify([
        {
          ProcessName: "Figma",
          Id: 101,
          MainWindowTitle: "Figma Design",
          MainWindowHandle: 123
        },
        {
          ProcessName: "Telegram",
          Id: 102,
          MainWindowTitle: "Telegram",
          MainWindowHandle: 456
        }
      ])
    );
    const appLauncher = {
      listInstalledApps: vi.fn(async () => [
        { name: "Figma", appId: "figma.app" },
        { name: "ChatGPT", appId: "chatgpt.app" }
      ])
    } as unknown as AppLauncher;

    const controller = new DesktopController({
      logger: createLogger("error"),
      appLauncher,
      platform: "win32",
      runPowerShell
    });

    const result = await controller.listApps({
      query: "figma",
      includeInstalled: true,
      limit: 5
    });

    expect(result.ok).toBe(true);
    expect(result.running).toHaveLength(1);
    expect(result.running[0]?.processName).toBe("Figma");
    expect(result.installed).toEqual([{ name: "Figma", appId: "figma.app" }]);
    expect(result.installedTotal).toBe(2);
  });

  it("focuses the best matching running app", async () => {
    const runPowerShell = vi
      .fn<(_: string) => Promise<string>>()
      .mockResolvedValueOnce(
        JSON.stringify({
          ProcessName: "Figma",
          Id: 101,
          MainWindowTitle: "Figma Design",
          MainWindowHandle: 123
        })
      )
      .mockResolvedValueOnce('{"ok":true}');

    const controller = new DesktopController({
      logger: createLogger("error"),
      appLauncher: { listInstalledApps: vi.fn(async () => []) } as unknown as AppLauncher,
      platform: "win32",
      runPowerShell
    });

    const result = await controller.focusApp("figma");

    expect(result.ok).toBe(true);
    expect(result.processId).toBe(101);
    expect(result.matchedApp).toContain("Figma");
    expect(runPowerShell).toHaveBeenCalledTimes(2);
  });

  it("returns a safe error when no running app matches", async () => {
    const controller = new DesktopController({
      logger: createLogger("error"),
      appLauncher: { listInstalledApps: vi.fn(async () => []) } as unknown as AppLauncher,
      platform: "win32",
      runPowerShell: vi.fn(async () => "[]")
    });

    const result = await controller.closeApp("photoshop");

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No running app matched "photoshop"');
  });
});
