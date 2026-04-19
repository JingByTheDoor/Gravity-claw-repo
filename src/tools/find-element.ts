import type { ToolDefinition } from "../agent/types.js";
import {
  DesktopController,
  parseDesktopInteger,
  type ScreenshotOptions
} from "./desktop-controller.js";
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

      const screenshotOptions: ScreenshotOptions = {
        mode: parseMode(input.mode)
      };
      const x = parseDesktopInteger(input.x);
      const y = parseDesktopInteger(input.y);
      const width = parseDesktopInteger(input.width);
      const height = parseDesktopInteger(input.height);
      if (x !== undefined) {
        screenshotOptions.x = x;
      }
      if (y !== undefined) {
        screenshotOptions.y = y;
      }
      if (width !== undefined) {
        screenshotOptions.width = width;
      }
      if (height !== undefined) {
        screenshotOptions.height = height;
      }

      const screenshot =
        typeof input.screenshot_path === "string" && input.screenshot_path.trim().length > 0
          ? { path: input.screenshot_path.trim() }
          : await desktopController.takeScreenshot(screenshotOptions);

      const result = await visionClient.findElement(screenshot.path, query);
      return JSON.stringify({
        ...result,
        screenshotPath: screenshot.path
      });
    }
  };
}
