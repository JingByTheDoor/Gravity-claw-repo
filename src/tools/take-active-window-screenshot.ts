import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createTakeActiveWindowScreenshotTool(
  desktopController: DesktopController
): ToolDefinition {
  return {
    name: "take_active_window_screenshot",
    description:
      "Capture a screenshot of only the active foreground window. Returns the saved PNG path.",
    parameters: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "Optional absolute or relative PNG output path."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const outputPath =
        typeof input.output_path === "string" && input.output_path.trim().length > 0
          ? input.output_path.trim()
          : undefined;

      return JSON.stringify(await desktopController.takeActiveWindowScreenshot(outputPath));
    }
  };
}
