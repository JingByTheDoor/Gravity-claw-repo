import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopInteger } from "./desktop-controller.js";
import { VisionClient } from "./vision-client.js";

function parseMode(input: unknown): "full" | "region" {
  return input === "region" ? "region" : "full";
}

export function createOcrReadTool(
  desktopController: DesktopController,
  visionClient: VisionClient
): ToolDefinition {
  return {
    name: "ocr_read",
    description:
      "Read visible text from a screenshot. Provide screenshot_path or let the tool capture a new screenshot first.",
    parameters: {
      type: "object",
      properties: {
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
      additionalProperties: false
    },
    async execute(input) {
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

      const ocr = await visionClient.ocrRead(screenshot.path);
      return JSON.stringify({
        ...ocr,
        screenshotPath: screenshot.path
      });
    }
  };
}
