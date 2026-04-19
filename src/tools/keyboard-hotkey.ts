import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

function parseHotkey(value: string): string[] {
  return value
    .split(/[+,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function createKeyboardHotkeyTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "keyboard_hotkey",
    description:
      "Send a keyboard shortcut to the focused app, for example Ctrl+C, Alt+Tab, Win+R, or Ctrl+Shift+P.",
    parameters: {
      type: "object",
      properties: {
        keys: {
          type: "string",
          description: "Shortcut keys written like Ctrl+C, Alt+Tab, or Win+R."
        }
      },
      required: ["keys"],
      additionalProperties: false
    },
    async execute(input) {
      const keys = input.keys;
      if (typeof keys !== "string" || keys.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "keys must be a non-empty string." });
      }

      return JSON.stringify(await desktopController.keyboardHotkey(parseHotkey(keys)));
    }
  };
}
