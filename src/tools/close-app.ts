import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopBoolean } from "./desktop-controller.js";

export function createCloseAppTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "close_app",
    description:
      "Close a running desktop app gracefully by name. Use force=true only when the app is hung or refuses to close normally.",
    parameters: {
      type: "object",
      properties: {
        app_name: {
          type: "string",
          description: "Name of the running app to close."
        },
        force: {
          type: "string",
          description: "Set to true to force kill the process if graceful close fails."
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

      return JSON.stringify(await desktopController.closeApp(appName, parseDesktopBoolean(input.force)));
    }
  };
}
