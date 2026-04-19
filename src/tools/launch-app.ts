import type { ToolDefinition } from "../agent/types.js";
import { AppLauncher } from "./app-launcher.js";

export function createLaunchAppTool(appLauncher: AppLauncher): ToolDefinition {
  return {
    name: "launch_app",
    description:
      "Launch an installed Windows desktop app by friendly name, such as Figma, Telegram, File Explorer, or ChatGPT. Use this instead of run_shell_command when the user wants to open or start an app.",
    parameters: {
      type: "object",
      properties: {
        app_name: {
          type: "string",
          description: "Friendly app name to launch."
        }
      },
      required: ["app_name"],
      additionalProperties: false
    },
    async execute(input) {
      const appName = input.app_name;
      if (typeof appName !== "string" || appName.trim().length === 0) {
        return JSON.stringify({
          ok: false,
          error: "app_name must be a non-empty string."
        });
      }

      return JSON.stringify(await appLauncher.launch(appName));
    }
  };
}
