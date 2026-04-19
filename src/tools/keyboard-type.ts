import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createKeyboardTypeTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "keyboard_type",
    description: "Type text into the currently focused app or input field.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type into the focused app."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    async execute(input) {
      const text = input.text;
      if (typeof text !== "string" || text.length === 0) {
        return JSON.stringify({ ok: false, error: "text must be a non-empty string." });
      }

      return JSON.stringify(await desktopController.keyboardType(text));
    }
  };
}
