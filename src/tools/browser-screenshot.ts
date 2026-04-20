import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopBoolean } from "./desktop-controller.js";

export function createBrowserScreenshotTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_screenshot",
    description:
      "Capture a screenshot of the current Playwright page and return the saved PNG path.",
    parameters: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "Optional absolute or relative PNG output path."
        },
        full_page: {
          type: "string",
          description: "Optional true or false. Defaults to true."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const outputPath = typeof input.output_path === "string" ? input.output_path.trim() : "";

      return JSON.stringify(
        await browserController.screenshot({
          ...(outputPath ? { outputPath } : {}),
          ...(input.full_page !== undefined
            ? { fullPage: parseDesktopBoolean(input.full_page, true) }
            : {})
        })
      );
    }
  };
}
