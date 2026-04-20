import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClickElementTool } from "../src/tools/click-element.js";
import { createClipboardReadTool } from "../src/tools/clipboard-read.js";
import { createClipboardWriteTool } from "../src/tools/clipboard-write.js";
import { createFindElementTool } from "../src/tools/find-element.js";
import { createGetActiveAppTool } from "../src/tools/get-active-app.js";
import { createKeyboardHotkeyTool } from "../src/tools/keyboard-hotkey.js";
import { createMouseClickTool } from "../src/tools/mouse-click.js";
import { createTakeActiveWindowScreenshotTool } from "../src/tools/take-active-window-screenshot.js";
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

  it("passes negative screenshot coordinates through to the controller", async () => {
    const takeScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "region" as const,
      path: "shot.png",
      width: 100,
      height: 50,
      x: -10,
      y: -20
    }));
    const tool = createTakeScreenshotTool({ takeScreenshot } as never);

    await tool.execute(
      {
        mode: "region",
        x: "-10",
        y: "-20",
        width: "100",
        height: "50"
      },
      { chatId: "chat-1" }
    );

    expect(takeScreenshot).toHaveBeenCalledWith({
      mode: "region",
      x: -10,
      y: -20,
      width: 100,
      height: 50
    });
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

  it("stops waiting for an element when cancellation is requested", async () => {
    const takeScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "full" as const,
      path: "screen-1.png",
      width: 1280,
      height: 720,
      x: 0,
      y: 0
    }));
    const findElement = vi.fn(async () => ({
      ok: true,
      found: false,
      label: "",
      confidence: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      reason: "not visible"
    }));
    const tool = createWaitForElementTool(
      { takeScreenshot } as never,
      { findElement } as never
    );

    const result = JSON.parse(
      await tool.execute(
        {
          query: "open button",
          timeout_ms: "5000",
          interval_ms: "250"
        },
        {
          chatId: "chat-1",
          shouldCancel: () => true
        }
      )
    ) as {
      ok: boolean;
      canceled: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.canceled).toBe(true);
    expect(result.error).toContain("canceled");
  });

  it("reads and writes the clipboard through dedicated tools", async () => {
    const clipboardRead = vi.fn(async () => ({
      ok: true,
      text: "copied text"
    }));
    const clipboardWrite = vi.fn(async () => ({
      ok: true,
      textLength: 11
    }));

    const readTool = createClipboardReadTool({ clipboardRead } as never);
    const writeTool = createClipboardWriteTool({ clipboardWrite } as never);

    const readResult = JSON.parse(await readTool.execute({}, { chatId: "chat-1" })) as {
      ok: boolean;
      text: string;
    };
    const writeResult = JSON.parse(
      await writeTool.execute({ text: "copied text" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      textLength: number;
    };

    expect(readResult).toEqual({
      ok: true,
      text: "copied text"
    });
    expect(clipboardWrite).toHaveBeenCalledWith("copied text");
    expect(writeResult.textLength).toBe(11);
  });

  it("returns the active app through the dedicated tool", async () => {
    const getActiveApp = vi.fn(async () => ({
      ok: true,
      processName: "Code",
      processId: 42,
      title: "README.md",
      x: 10,
      y: 20,
      width: 800,
      height: 600
    }));
    const tool = createGetActiveAppTool({ getActiveApp } as never);

    const result = JSON.parse(await tool.execute({}, { chatId: "chat-1" })) as {
      ok: boolean;
      processName: string;
    };

    expect(result.ok).toBe(true);
    expect(result.processName).toBe("Code");
  });

  it("captures the active window through the dedicated tool", async () => {
    const takeActiveWindowScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "window" as const,
      path: "window.png",
      width: 800,
      height: 600,
      x: 10,
      y: 20
    }));
    const tool = createTakeActiveWindowScreenshotTool({
      takeActiveWindowScreenshot
    } as never);

    const result = JSON.parse(
      await tool.execute({ output_path: "window.png" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      path: string;
    };

    expect(takeActiveWindowScreenshot).toHaveBeenCalledWith("window.png");
    expect(result.path).toBe("window.png");
  });

  it("finds and clicks an element using screenshot-relative coordinates", async () => {
    const takeScreenshot = vi.fn(async () => ({
      ok: true,
      mode: "region" as const,
      path: "screen.png",
      width: 300,
      height: 200,
      x: 100,
      y: 200
    }));
    const mouseClick = vi.fn(async () => ({
      ok: true,
      x: 130,
      y: 230,
      button: "left" as const,
      count: 1
    }));
    const findElement = vi.fn(async () => ({
      ok: true,
      found: true,
      label: "Save",
      confidence: 0.95,
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      reason: "visible"
    }));
    const tool = createClickElementTool(
      { takeScreenshot, mouseClick } as never,
      { findElement } as never
    );

    const result = JSON.parse(
      await tool.execute({ query: "Save" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      clickX: number;
      clickY: number;
      screenshotPath: string;
    };

    expect(mouseClick).toHaveBeenCalledWith(130, 230, "left", 1);
    expect(result.clickX).toBe(130);
    expect(result.clickY).toBe(230);
    expect(result.screenshotPath).toBe("screen.png");
  });
});
