import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopInteger } from "./desktop-controller.js";

export function createBrowserNavigateTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_navigate",
    description:
      "Launch or reuse the Playwright browser page and navigate it to a URL. Use this before inspecting or interacting with a website.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Target URL or hostname. Plain hostnames default to https, localhost defaults to http."
        },
        timeout_ms: {
          type: "string",
          description: "Optional navigation timeout in milliseconds."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    async execute(input) {
      const url = input.url;
      if (typeof url !== "string" || url.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "url must be a non-empty string." });
      }

      const timeoutMs = parseDesktopInteger(input.timeout_ms);
      return JSON.stringify(await browserController.navigate(url, timeoutMs));
    }
  };
}
