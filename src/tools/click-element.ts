import type { ToolDefinition, ToolExecutionContext } from "../agent/types.js";
import {
  DesktopController,
  parseDesktopInteger,
  parseMouseButton,
  type ScreenshotOptions
} from "./desktop-controller.js";
import { VisionClient } from "./vision-client.js";

function parseMode(input: unknown): "full" | "region" {
  return input === "region" ? "region" : "full";
}

async function shouldCancel(context: ToolExecutionContext): Promise<boolean> {
  const result = await context.shouldCancel?.();
  return result === true;
}

export function createClickElementTool(
  desktopController: DesktopController,
  visionClient: VisionClient
): ToolDefinition {
  return {
    name: "click_element",
    description:
      "Find a visible UI element by text or description, then click the element center.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or description of the UI element to click."
        },
        mode: {
          type: "string",
          description: "Use full or region when capturing a screenshot."
        },
        x: {
          type: "string",
          description: "Optional region left coordinate in pixels."
        },
        y: {
          type: "string",
          description: "Optional region top coordinate in pixels."
        },
        width: {
          type: "string",
          description: "Optional region width in pixels."
        },
        height: {
          type: "string",
          description: "Optional region height in pixels."
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
      required: ["query"],
      additionalProperties: false
    },
    async execute(input, context) {
      const query = input.query;
      if (typeof query !== "string" || query.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "query must be a non-empty string." });
      }

      const screenshotOptions: ScreenshotOptions = {
        mode: parseMode(input.mode)
      };
      const x = parseDesktopInteger(input.x);
      const y = parseDesktopInteger(input.y);
      const width = parseDesktopInteger(input.width);
      const height = parseDesktopInteger(input.height);
      if (x !== undefined) {
        screenshotOptions.x = x;
      }
      if (y !== undefined) {
        screenshotOptions.y = y;
      }
      if (width !== undefined) {
        screenshotOptions.width = width;
      }
      if (height !== undefined) {
        screenshotOptions.height = height;
      }

      const screenshot = await desktopController.takeScreenshot(screenshotOptions);
      if (await shouldCancel(context)) {
        return JSON.stringify({
          ok: false,
          canceled: true,
          error: "Task canceled.",
          screenshotPath: screenshot.path
        });
      }

      const result = await visionClient.findElement(screenshot.path, query.trim());
      if (!result.found) {
        return JSON.stringify({
          ...result,
          screenshotPath: screenshot.path
        });
      }

      if (await shouldCancel(context)) {
        return JSON.stringify({
          ok: false,
          canceled: true,
          error: "Task canceled.",
          screenshotPath: screenshot.path
        });
      }

      const clickX = screenshot.x + result.x + Math.trunc(result.width / 2);
      const clickY = screenshot.y + result.y + Math.trunc(result.height / 2);
      const button = parseMouseButton(input.button);
      const count = parseDesktopInteger(input.count) ?? 1;

      const clickResult = await desktopController.mouseClick(clickX, clickY, button, count);

      return JSON.stringify({
        ...result,
        ...clickResult,
        found: true,
        screenshotPath: screenshot.path,
        clickX,
        clickY
      });
    }
  };
}
