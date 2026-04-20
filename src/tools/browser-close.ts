import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";

export function createBrowserCloseTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_close",
    description: "Close the current Playwright browser session and forget its page state.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    async execute() {
      return JSON.stringify(await browserController.close());
    }
  };
}
