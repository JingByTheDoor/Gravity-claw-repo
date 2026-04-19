import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createFocusAppTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "focus_app",
    description: "Bring a running desktop app window to the foreground by name.",
    parameters: {
      type: "object",
      properties: {
        app_name: {
          type: "string",
          description: "Name of the running app to focus."
        }
      },
      required: ["app_name"],
      additionalProperties: false
    },
    async execute(input) {
      const appName = input.app_name;
      if (typeof appName !== "string" || appName.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "app_name must be a non-empty string." });
      }

      return JSON.stringify(await desktopController.focusApp(appName));
    }
  };
}
