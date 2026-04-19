import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopBoolean, parseDesktopInteger } from "./desktop-controller.js";

export function createListAppsTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "list_apps",
    description:
      "List running desktop apps and optionally installed apps. Use this before focus_app or close_app when you need the exact app name.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional app name filter."
        },
        include_installed: {
          type: "string",
          description: "Set to true to include installed app matches from the Windows app list."
        },
        limit: {
          type: "string",
          description: "Optional max number of running and installed results, default 20."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const result = await desktopController.listApps({
        ...(typeof input.query === "string" ? { query: input.query } : {}),
        includeInstalled: parseDesktopBoolean(input.include_installed, false),
        ...(parseDesktopInteger(input.limit) ? { limit: parseDesktopInteger(input.limit) } : {})
      });

      return JSON.stringify(result);
    }
  };
}
