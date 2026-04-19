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

      const ocr = await visionClient.ocrRead(screenshot.path);
      return JSON.stringify({
        ...ocr,
        screenshotPath: screenshot.path
      });
    }
  };
}
