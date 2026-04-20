import type { ToolDefinition } from "../agent/types.js";
import { DesktopController } from "./desktop-controller.js";

export function createClipboardReadTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "clipboard_read",
    description: "Read the current text clipboard contents on the local desktop.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    async execute() {
      return JSON.stringify(await desktopController.clipboardRead());
    }
  };
}
