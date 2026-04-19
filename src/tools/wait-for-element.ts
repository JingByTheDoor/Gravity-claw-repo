import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopInteger } from "./desktop-controller.js";
import { VisionClient } from "./vision-client.js";

function parseMode(input: unknown): "full" | "region" {
  return input === "region" ? "region" : "full";
}

export function createWaitForElementTool(
  desktopController: DesktopController,
  visionClient: VisionClient
): ToolDefinition {
  return {
    name: "wait_for_element",
    description:
      "Keep checking screenshots until a UI element appears or the timeout expires. Returns the first matching bounding box.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or description of the UI element to wait for."
        },
        timeout_ms: {
          type: "string",
          description: "Maximum wait time in milliseconds, default 8000."
        },
        interval_ms: {
          type: "string",
          description: "Delay between checks in milliseconds, default 1000."
        },
        mode: {
          type: "string",
          description: "Use full or region when capturing screenshots."
        },
        x: {
          type: "string",
          description: "Optional region left coordinate in pixels."
        },
        y: {
          type: "string",
          description: "Optional region top coordinate in pixels."
        },
        width: {
          type: "string",
          description: "Optional region width in pixels."
        },
        height: {
          type: "string",
          description: "Optional region height in pixels."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(input) {
      const query = input.query;
      if (typeof query !== "string" || query.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "query must be a non-empty string." });
      }

      const timeoutMs = Math.min(Math.max(parseDesktopInteger(input.timeout_ms) ?? 8000, 500), 30000);
      const intervalMs = Math.min(Math.max(parseDesktopInteger(input.interval_ms) ?? 1000, 250), 5000);
      const startedAt = Date.now();

      while (Date.now() - startedAt <= timeoutMs) {
        const screenshot = await desktopController.takeScreenshot({
          mode: parseMode(input.mode),
          ...(parseDesktopInteger(input.x) !== undefined ? { x: parseDesktopInteger(input.x) } : {}),
          ...(parseDesktopInteger(input.y) !== undefined ? { y: parseDesktopInteger(input.y) } : {}),
          ...(parseDesktopInteger(input.width) !== undefined ? { width: parseDesktopInteger(input.width) } : {}),
          ...(parseDesktopInteger(input.height) !== undefined ? { height: parseDesktopInteger(input.height) } : {})
        });
        const result = await visionClient.findElement(screenshot.path, query);
        if (result.found) {
          return JSON.stringify({
            ...result,
            screenshotPath: screenshot.path,
            waitedMs: Date.now() - startedAt
          });
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, intervalMs);
        });
      }

      return JSON.stringify({
        ok: true,
        found: false,
        label: "",
        confidence: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        reason: `Timed out after ${timeoutMs}ms.`,
        waitedMs: timeoutMs
      });
    }
  };
}
