import type { ToolDefinition } from "../agent/types.js";
import {
  DesktopController,
  parseDesktopInteger,
  type ScreenshotOptions
} from "./desktop-controller.js";

function parseMode(input: unknown): "full" | "region" {
  return input === "region" ? "region" : "full";
}

export function createTakeScreenshotTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "take_screenshot",
    description:
      "Capture a screenshot of the desktop. Supports full screen or a specific region. Returns the saved PNG path.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Use full for the whole desktop or region for a rectangular crop."
        },
        x: {
          type: "string",
          description: "Region left coordinate in pixels."
        },
        y: {
          type: "string",
          description: "Region top coordinate in pixels."
        },
        width: {
          type: "string",
          description: "Region width in pixels."
        },
        height: {
          type: "string",
          description: "Region height in pixels."
        },
        output_path: {
          type: "string",
          description: "Optional absolute or relative PNG output path."
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
      if (typeof input.output_path === "string") {
        screenshotOptions.outputPath = input.output_path;
      }

      return JSON.stringify(await desktopController.takeScreenshot(screenshotOptions));
    }
  };
}
