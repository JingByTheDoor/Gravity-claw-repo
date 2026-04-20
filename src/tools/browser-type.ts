import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopBoolean, parseDesktopInteger } from "./desktop-controller.js";

export function createBrowserTypeTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_type",
    description:
      "Type into an input on the current Playwright page. Target the field by selector, label, placeholder, or name.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the input field."
        },
        label: {
          type: "string",
          description: "Accessible label text for the input field."
        },
        placeholder: {
          type: "string",
          description: "Placeholder text for the input field."
        },
        name: {
          type: "string",
          description: "HTML name attribute for the input field."
        },
        text: {
          type: "string",
          description: "Text to enter."
        },
        clear_first: {
          type: "string",
          description: "Optional true or false. Defaults to true and replaces existing content."
        },
        press_enter: {
          type: "string",
          description: "Optional true or false. Press Enter after typing."
        },
        timeout_ms: {
          type: "string",
          description: "Optional typing timeout in milliseconds."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    async execute(input, context) {
      const text = input.text;
      if (typeof text !== "string" || text.length === 0) {
        return JSON.stringify({ ok: false, error: "text must be a non-empty string." });
      }

      const selector = typeof input.selector === "string" ? input.selector.trim() : "";
      const label = typeof input.label === "string" ? input.label.trim() : "";
      const placeholder = typeof input.placeholder === "string" ? input.placeholder.trim() : "";
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!selector && !label && !placeholder && !name) {
        return JSON.stringify({
          ok: false,
          error: "browser_type requires selector, label, placeholder, or name."
        });
      }

      const timeoutMs = parseDesktopInteger(input.timeout_ms);
      return JSON.stringify(
        await browserController.type(
          context.chatId,
          {
            text,
            ...(selector ? { selector } : {}),
            ...(label ? { label } : {}),
            ...(placeholder ? { placeholder } : {}),
            ...(name ? { name } : {}),
            ...(input.clear_first !== undefined
              ? { clearFirst: parseDesktopBoolean(input.clear_first) }
              : {}),
            ...(input.press_enter !== undefined
              ? { pressEnter: parseDesktopBoolean(input.press_enter) }
              : {})
          },
          timeoutMs
        )
      );
    }
  };
}
