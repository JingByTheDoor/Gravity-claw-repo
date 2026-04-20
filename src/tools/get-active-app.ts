import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createGetActiveAppTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "get_active_app",
    description: "Inspect the currently active desktop app and its window bounds.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    async execute() {
      return JSON.stringify(await desktopController.getActiveApp());
    }
  };
}
