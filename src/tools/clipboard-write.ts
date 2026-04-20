import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createClipboardWriteTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "clipboard_write",
    description: "Write text to the local desktop clipboard.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to copy into the clipboard."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    async execute(input) {
      const text = input.text;
      if (typeof text !== "string") {
        return JSON.stringify({ ok: false, error: "text must be a string." });
      }

      return JSON.stringify(await desktopController.clipboardWrite(text));
    }
  };
}
