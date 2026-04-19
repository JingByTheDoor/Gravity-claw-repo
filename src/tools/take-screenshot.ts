import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopInteger } from "./desktop-controller.js";

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
      return JSON.stringify(await desktopController.takeScreenshot({
        mode: parseMode(input.mode),
        ...(parseDesktopInteger(input.x) !== undefined ? { x: parseDesktopInteger(input.x) } : {}),
        ...(parseDesktopInteger(input.y) !== undefined ? { y: parseDesktopInteger(input.y) } : {}),
        ...(parseDesktopInteger(input.width) !== undefined ? { width: parseDesktopInteger(input.width) } : {}),
        ...(parseDesktopInteger(input.height) !== undefined ? { height: parseDesktopInteger(input.height) } : {}),
        ...(typeof input.output_path === "string" ? { outputPath: input.output_path } : {})
      }));
    }
  };
}
