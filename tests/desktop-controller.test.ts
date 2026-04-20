import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { AppLauncher } from "../src/tools/app-launcher.js";
import { DesktopController } from "../src/tools/desktop-controller.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("keeps screenshot output paths inside the artifacts directory", async () => {
    const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gravity-claw-shots-"));
    const runPowerShell = vi.fn(async (command: string) => {
      const payloadMatch = command.match(/FromBase64String\('([^']+)'\)/);
      const payload = JSON.parse(
        Buffer.from(payloadMatch?.[1] ?? "", "base64").toString("utf8")
      ) as { outputPath: string };

      return JSON.stringify({
        ok: true,
        mode: "full",
        path: payload.outputPath,
        width: 100,
        height: 100,
        x: 0,
        y: 0
      });
    });

    try {
      const controller = new DesktopController({
        logger: createLogger("error"),
        appLauncher: { listInstalledApps: vi.fn(async () => []) } as unknown as AppLauncher,
        artifactsDir,
        platform: "win32",
        runPowerShell
      });

      const result = await controller.takeScreenshot({
        outputPath: "named-shot.png"
      });

      expect(result.path).toBe(path.join(artifactsDir, "named-shot.png"));
    } finally {
      fs.rmSync(artifactsDir, { recursive: true, force: true });
    }
  });

  it("rejects desktop screenshot output paths outside the artifacts directory", async () => {
    const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gravity-claw-shots-"));
    const outsidePath = path.join(os.tmpdir(), "outside-shot.png");

    try {
      const controller = new DesktopController({
        logger: createLogger("error"),
        appLauncher: { listInstalledApps: vi.fn(async () => []) } as unknown as AppLauncher,
        artifactsDir,
        platform: "win32",
        runPowerShell: vi.fn(async () => '{"ok":true}')
      });

      await expect(
        controller.takeScreenshot({
          outputPath: outsidePath
        })
      ).rejects.toThrow("screenshots artifacts directory");
    } finally {
      fs.rmSync(artifactsDir, { recursive: true, force: true });
    }
  });
});
