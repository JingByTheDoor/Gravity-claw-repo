import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopBoolean, parseDesktopInteger } from "./desktop-controller.js";

export function createBrowserClickTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_click",
    description:
      "Click an element on the current Playwright page. Prefer selector when you have one from browser_snapshot, otherwise use visible text.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the target element."
        },
        text: {
          type: "string",
          description: "Visible text to match when no selector is available."
        },
        exact: {
          type: "string",
          description: "Optional true or false. Only applies to text matches."
        },
        timeout_ms: {
          type: "string",
          description: "Optional click timeout in milliseconds."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const selector = typeof input.selector === "string" ? input.selector.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (selector.length === 0 && text.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "browser_click requires selector or text."
        });
      }

      const timeoutMs = parseDesktopInteger(input.timeout_ms);
      return JSON.stringify(
        await browserController.click(
          {
            ...(selector ? { selector } : {}),
            ...(text ? { text } : {}),
            ...(input.exact !== undefined ? { exact: parseDesktopBoolean(input.exact) } : {})
          },
          timeoutMs
        )
      );
    }
  };
}
