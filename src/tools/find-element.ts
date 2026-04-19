import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopInteger } from "./desktop-controller.js";
import { VisionClient } from "./vision-client.js";

function parseMode(input: unknown): "full" | "region" {
  return input === "region" ? "region" : "full";
}

export function createFindElementTool(
  desktopController: DesktopController,
  visionClient: VisionClient
): ToolDefinition {
  return {
    name: "find_element",
    description:
      "Find a visible UI element in a screenshot by text or description and return its bounding box coordinates.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or description of the UI element to find."
        },
        screenshot_path: {
          type: "string",
          description: "Optional existing screenshot PNG path."
        },
        mode: {
          type: "string",
          description: "Use full or region when auto-capturing a screenshot."
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

      const screenshot =
        typeof input.screenshot_path === "string" && input.screenshot_path.trim().length > 0
          ? { path: input.screenshot_path.trim() }
          : await desktopController.takeScreenshot({
              mode: parseMode(input.mode),
              ...(parseDesktopInteger(input.x) !== undefined ? { x: parseDesktopInteger(input.x) } : {}),
              ...(parseDesktopInteger(input.y) !== undefined ? { y: parseDesktopInteger(input.y) } : {}),
              ...(parseDesktopInteger(input.width) !== undefined ? { width: parseDesktopInteger(input.width) } : {}),
              ...(parseDesktopInteger(input.height) !== undefined ? { height: parseDesktopInteger(input.height) } : {})
            });

      const result = await visionClient.findElement(screenshot.path, query);
      return JSON.stringify({
        ...result,
        screenshotPath: screenshot.path
      });
    }
  };
}
