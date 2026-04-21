import { describe, expect, it, vi } from "vitest";
import { createSearchWebTool } from "../src/tools/search-web.js";

describe("search_web tool", () => {
  it("returns top results and fetches the best result page text", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.startsWith("https://lite.duckduckgo.com/lite/")) {
        return new Response(
          `
            <html>
              <body>
                <a rel="nofollow" href="https://weather.example.com/current" class='result-link'>Current Vancouver Weather</a>
                <td class='result-snippet'>Current conditions and forecast.</td>
              </body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html"
            }
          }
        );
      }

      if (url === "https://weather.example.com/current") {
        return new Response(
          `
            <html>
              <head><title>Vancouver Current Conditions</title></head>
              <body>Current conditions: 15 C, cloudy, wind 5 km/h.</body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html"
            }
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const tool = createSearchWebTool({
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = JSON.parse(
      await tool.execute({ query: "weather in Vancouver Canada" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      results: Array<{ title: string; url: string; snippet?: string }>;
      bestResult?: {
        title: string;
        url: string;
        pageTitle?: string;
        text?: string;
      };
    };

    expect(result.ok).toBe(true);
    expect(result.results[0]).toEqual({
      title: "Current Vancouver Weather",
      url: "https://weather.example.com/current",
      snippet: "Current conditions and forecast."
    });
    expect(result.bestResult).toMatchObject({
      title: "Current Vancouver Weather",
      url: "https://weather.example.com/current",
      pageTitle: "Vancouver Current Conditions"
    });
    expect(result.bestResult?.text).toContain("Current conditions: 15 C, cloudy");
  });

  it("still returns search results when best-result page fetch fails", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.startsWith("https://lite.duckduckgo.com/lite/")) {
        return new Response(
          `
            <html>
              <body>
                <a rel="nofollow" href="https://weather.example.com/current" class='result-link'>Current Vancouver Weather</a>
                <td class='result-snippet'>Current conditions and forecast.</td>
              </body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html"
            }
          }
        );
      }

      throw new Error("fetch failed");
    });

    const tool = createSearchWebTool({
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = JSON.parse(
      await tool.execute({ query: "weather in Vancouver Canada" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      results: Array<{ title: string; url: string; snippet?: string }>;
      bestResult?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.bestResult).toBeUndefined();
  });
});
