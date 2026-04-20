import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopInteger } from "./desktop-controller.js";

export function createBrowserSnapshotTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_snapshot",
    description:
      "Inspect the current Playwright page. Returns the URL, title, visible page text, and a short list of actionable elements with selector hints.",
    parameters: {
      type: "object",
      properties: {
        max_text_length: {
          type: "string",
          description: "Optional limit for returned visible page text."
        },
        max_elements: {
          type: "string",
          description: "Optional limit for the number of returned interactive elements."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const maxTextLength = parseDesktopInteger(input.max_text_length);
      const maxElements = parseDesktopInteger(input.max_elements);

      return JSON.stringify(
        await browserController.snapshot({
          ...(maxTextLength !== undefined ? { maxTextLength } : {}),
          ...(maxElements !== undefined ? { maxElements } : {})
        })
      );
    }
  };
}
