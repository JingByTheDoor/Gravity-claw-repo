import { describe, expect, it, vi } from "vitest";
import { createBrowserClickTool } from "../src/tools/browser-click.js";
import { createBrowserCloseTool } from "../src/tools/browser-close.js";
import { createBrowserNavigateTool } from "../src/tools/browser-navigate.js";
import { createBrowserScreenshotTool } from "../src/tools/browser-screenshot.js";
import { createBrowserSnapshotTool } from "../src/tools/browser-snapshot.js";
import { createBrowserTypeTool } from "../src/tools/browser-type.js";

describe("browser tools", () => {
  it("normalizes navigation input and delegates to the browser controller", async () => {
    const navigate = vi.fn(async () => ({
      ok: true,
      url: "https://example.com",
      title: "Example Domain",
      status: 200
    }));
    const tool = createBrowserNavigateTool({ navigate } as never);

    const result = JSON.parse(
      await tool.execute({ url: "example.com", timeout_ms: "5000" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      url: string;
    };

    expect(navigate).toHaveBeenCalledWith("example.com", 5000);
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://example.com");
  });

  it("returns a safe error when browser_click has no target", async () => {
    const tool = createBrowserClickTool({ click: vi.fn() } as never);

    const result = JSON.parse(await tool.execute({}, { chatId: "chat-1" })) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("selector or text");
  });

  it("passes browser click arguments through to the controller", async () => {
    const click = vi.fn(async () => ({
      ok: true,
      url: "https://example.com/login",
      title: "Login",
      target: "text:Sign in"
    }));
    const tool = createBrowserClickTool({ click } as never);

    const result = JSON.parse(
      await tool.execute(
        {
          text: "Sign in",
          exact: "true",
          timeout_ms: "2500"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      target: string;
    };

    expect(click).toHaveBeenCalledWith({ text: "Sign in", exact: true }, 2500);
    expect(result.ok).toBe(true);
    expect(result.target).toBe("text:Sign in");
  });

  it("requires a field target for browser_type", async () => {
    const tool = createBrowserTypeTool({ type: vi.fn() } as never);

    const result = JSON.parse(
      await tool.execute({ text: "hello" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("selector, label, placeholder, or name");
  });

  it("passes typing options through to the controller", async () => {
    const type = vi.fn(async () => ({
      ok: true,
      url: "https://example.com/search",
      title: "Search",
      target: "label:Search",
      textLength: 5,
      submitted: true
    }));
    const tool = createBrowserTypeTool({ type } as never);

    const result = JSON.parse(
      await tool.execute(
        {
          label: "Search",
          text: "hello",
          clear_first: "false",
          press_enter: "true",
          timeout_ms: "4000"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      textLength: number;
      submitted: boolean;
    };

    expect(type).toHaveBeenCalledWith(
      {
        label: "Search",
        text: "hello",
        clearFirst: false,
        pressEnter: true
      },
      4000
    );
    expect(result.ok).toBe(true);
    expect(result.textLength).toBe(5);
    expect(result.submitted).toBe(true);
  });

  it("passes snapshot limits through to the controller", async () => {
    const snapshot = vi.fn(async () => ({
      ok: true,
      url: "https://example.com",
      title: "Example Domain",
      text: "Example Domain",
      truncated: false,
      elements: []
    }));
    const tool = createBrowserSnapshotTool({ snapshot } as never);

    const result = JSON.parse(
      await tool.execute(
        {
          max_text_length: "1200",
          max_elements: "10"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      title: string;
    };

    expect(snapshot).toHaveBeenCalledWith({
      maxTextLength: 1200,
      maxElements: 10
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe("Example Domain");
  });

  it("passes screenshot options through to the controller", async () => {
    const screenshot = vi.fn(async () => ({
      ok: true,
      url: "https://example.com",
      title: "Example Domain",
      path: "artifacts/screenshots/browser.png",
      fullPage: false
    }));
    const tool = createBrowserScreenshotTool({ screenshot } as never);

    const result = JSON.parse(
      await tool.execute(
        {
          output_path: "artifacts/screenshots/browser.png",
          full_page: "false"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      path: string;
      fullPage: boolean;
    };

    expect(screenshot).toHaveBeenCalledWith({
      outputPath: "artifacts/screenshots/browser.png",
      fullPage: false
    });
    expect(result.ok).toBe(true);
    expect(result.path).toContain("browser.png");
    expect(result.fullPage).toBe(false);
  });

  it("closes the browser session through a dedicated tool", async () => {
    const close = vi.fn(async () => ({
      ok: true,
      closed: true
    }));
    const tool = createBrowserCloseTool({ close } as never);

    const result = JSON.parse(await tool.execute({}, { chatId: "chat-1" })) as {
      ok: boolean;
      closed: boolean;
    };

    expect(close).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      closed: true
    });
  });
});
