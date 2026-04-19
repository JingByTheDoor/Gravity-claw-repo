import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFindElementTool } from "../src/tools/find-element.js";
import { createKeyboardHotkeyTool } from "../src/tools/keyboard-hotkey.js";
import { createMouseClickTool } from "../src/tools/mouse-click.js";
import { createTakeScreenshotTool } from "../src/tools/take-screenshot.js";
import { createWaitForElementTool } from "../src/tools/wait-for-element.js";

describe("desktop tools", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes screenshot options through to the controller", async () => {
    const takeScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "region" as const,
      path: "shot.png",
      width: 100,
      height: 50,
      x: 10,
      y: 20
    }));
    const tool = createTakeScreenshotTool({ takeScreenshot } as never);

    const result = JSON.parse(
      await tool.execute(
        {
          mode: "region",
          x: "10",
          y: "20",
          width: "100",
          height: "50"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      mode: string;
      path: string;
    };

    expect(takeScreenshot).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("region");
    expect(result.path).toBe("shot.png");
  });

  it("parses hotkey strings into key arrays", async () => {
    const keyboardHotkey = vi.fn(async () => ({
      ok: true,
      keys: ["Ctrl", "Shift", "P"]
    }));
    const tool = createKeyboardHotkeyTool({ keyboardHotkey } as never);

    const result = JSON.parse(
      await tool.execute({ keys: "Ctrl+Shift+P" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      keys: string[];
    };

    expect(keyboardHotkey).toHaveBeenCalledWith(["Ctrl", "Shift", "P"]);
    expect(result.ok).toBe(true);
  });

  it("validates mouse coordinates", async () => {
    const tool = createMouseClickTool({ mouseClick: vi.fn() } as never);

    const result = JSON.parse(
      await tool.execute({ x: "abc", y: "10" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("x and y");
  });

  it("finds an element using a fresh screenshot", async () => {
    const takeScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "full" as const,
      path: "screen.png",
      width: 1280,
      height: 720,
      x: 0,
      y: 0
    }));
    const findElement = vi.fn(async () => ({
      ok: true,
      found: true,
      label: "Search",
      confidence: 0.9,
      x: 100,
      y: 200,
      width: 120,
      height: 30,
      reason: "visible"
    }));
    const tool = createFindElementTool(
      { takeScreenshot } as never,
      { findElement } as never
    );

    const result = JSON.parse(
      await tool.execute({ query: "search box" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      found: boolean;
      screenshotPath: string;
    };

    expect(findElement).toHaveBeenCalledWith("screen.png", "search box");
    expect(result.found).toBe(true);
    expect(result.screenshotPath).toBe("screen.png");
  });

  it("waits until an element appears", async () => {
    const takeScreenshot = vi
      .fn<() => Promise<{ ok: true; mode: "full"; path: string; width: number; height: number; x: number; y: number }>>()
      .mockResolvedValueOnce({
        ok: true,
        mode: "full",
        path: "screen-1.png",
        width: 1280,
        height: 720,
        x: 0,
        y: 0
      })
      .mockResolvedValueOnce({
        ok: true,
        mode: "full",
        path: "screen-2.png",
        width: 1280,
        height: 720,
        x: 0,
        y: 0
      });
    const findElement = vi
      .fn<(_: string, __: string) => Promise<{
        ok: true;
        found: boolean;
        label: string;
        confidence: number;
        x: number;
        y: number;
        width: number;
        height: number;
        reason: string;
      }>>()
      .mockResolvedValueOnce({
        ok: true,
        found: false,
        label: "",
        confidence: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        reason: "not visible"
      })
      .mockResolvedValueOnce({
        ok: true,
        found: true,
        label: "Open",
        confidence: 0.8,
        x: 10,
        y: 20,
        width: 40,
        height: 20,
        reason: "visible"
      });
    const tool = createWaitForElementTool(
      { takeScreenshot } as never,
      { findElement } as never
    );

    const pending = tool.execute(
      {
        query: "open button",
        timeout_ms: "1000",
        interval_ms: "250"
      },
      { chatId: "chat-1" }
    );

    await vi.advanceTimersByTimeAsync(300);
    const result = JSON.parse(await pending) as {
      ok: boolean;
      found: boolean;
      screenshotPath: string;
    };

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.screenshotPath).toBe("screen-2.png");
  });
});
