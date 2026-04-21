import type { ToolDefinition } from "../agent/types.js";
import { BrowserController } from "./browser-controller.js";
import { parseDesktopInteger } from "./desktop-controller.js";

type SearchProvider = "bing" | "google" | "duckduckgo";

function resolveSearchProvider(rawProvider: unknown): SearchProvider {
  const normalized =
    typeof rawProvider === "string" ? rawProvider.trim().toLowerCase() : "";

  switch (normalized) {
    case "google":
    case "duckduckgo":
      return normalized;
    case "bing":
    default:
      return "bing";
  }
}

function buildSearchUrl(query: string, provider: SearchProvider): string {
  const encodedQuery = encodeURIComponent(query);

  switch (provider) {
    case "google":
      return `https://www.google.com/search?q=${encodedQuery}`;
    case "duckduckgo":
      return `https://duckduckgo.com/?q=${encodedQuery}`;
    case "bing":
    default:
      return `https://www.bing.com/search?q=${encodedQuery}`;
  }
}

export function createBrowserSearchTool(browserController: BrowserController): ToolDefinition {
  return {
    name: "browser_search",
    description:
      "Search the web directly in the Playwright browser without first loading a search homepage. Use this when you do not already have a direct URL.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to run."
        },
        provider: {
          type: "string",
          description: "Optional provider: bing, google, or duckduckgo. Defaults to bing."
        },
        timeout_ms: {
          type: "string",
          description: "Optional navigation timeout in milliseconds."
        },
        max_text_length: {
          type: "string",
          description: "Optional limit for returned visible page text."
        },
        max_elements: {
          type: "string",
          description: "Optional limit for the number of returned interactive elements."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(input, context) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (query.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "query must be a non-empty string."
        });
      }

      const provider = resolveSearchProvider(input.provider);
      const timeoutMs = parseDesktopInteger(input.timeout_ms);
      const maxTextLength = parseDesktopInteger(input.max_text_length);
      const maxElements = parseDesktopInteger(input.max_elements);
      const navigationResult = await browserController.navigate(
        context.chatId,
        buildSearchUrl(query, provider),
        timeoutMs
      );
      const snapshotResult = await browserController.snapshot(context.chatId, {
        ...(maxTextLength !== undefined ? { maxTextLength } : {}),
        ...(maxElements !== undefined ? { maxElements } : {})
      });

      return JSON.stringify({
        ok: navigationResult.ok && snapshotResult.ok,
        url: snapshotResult.url,
        title: snapshotResult.title,
        status: navigationResult.status,
        query,
        provider,
        text: snapshotResult.text,
        truncated: snapshotResult.truncated,
        elements: snapshotResult.elements
      });
    }
  };
}
