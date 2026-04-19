import type { ToolDefinition } from "../agent/types.js";
import { DesktopController, parseDesktopInteger, parseMouseButton } from "./desktop-controller.js";

export function createMouseClickTool(desktopController: DesktopController): ToolDefinition {
  return {
    name: "mouse_click",
    description:
      "Move the mouse to screen coordinates and click. Use find_element first when you need coordinates for a visible UI element.",
    parameters: {
      type: "object",
      properties: {
        x: {
          type: "string",
          description: "Screen x coordinate in pixels."
        },
        y: {
          type: "string",
          description: "Screen y coordinate in pixels."
        },
        button: {
          type: "string",
          description: "Mouse button: left, right, or middle.",
          enum: ["left", "right", "middle"]
        },
        count: {
          type: "string",
          description: "Number of clicks, default 1."
        }
      },
      required: ["x", "y"],
      additionalProperties: false
    },
    async execute(input) {
      const x = parseDesktopInteger(input.x);
      const y = parseDesktopInteger(input.y);
      if (x === undefined || y === undefined) {
        return JSON.stringify({ ok: false, error: "x and y must be integers." });
      }

      return JSON.stringify(
        await desktopController.mouseClick(
          x,
          y,
          parseMouseButton(input.button),
          parseDesktopInteger(input.count) ?? 1
        )
      );
    }
  };
}
