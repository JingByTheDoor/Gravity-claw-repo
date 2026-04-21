import type { ToolDefinition } from "../agent/types.js";

interface FetchWebPageToolOptions {
  fetchImpl?: typeof fetch;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|h\d|li|tr|td|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+/g, " ")
  ).trim();
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1] ? decodeHtml(match[1]).trim() : "";
  return title || undefined;
}

export function createFetchWebPageTool(options: FetchWebPageToolOptions = {}): ToolDefinition {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "fetch_web_page",
    description:
      "Fetch a public URL and return cleaned text or JSON without using browser UI automation. Use this when you need to read a page or API response.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The public URL to fetch."
        },
        max_chars: {
          type: "string",
          description: "Optional maximum number of text characters to return. Defaults to 4000."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    async execute(input) {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        return JSON.stringify({
          ok: false,
          error: "url must be an absolute http or https URL."
        });
      }

      const maxCharsRaw = typeof input.max_chars === "string" ? Number.parseInt(input.max_chars, 10) : 4000;
      const maxChars =
        Number.isFinite(maxCharsRaw) && maxCharsRaw > 0
          ? Math.min(maxCharsRaw, 12000)
          : 4000;

      try {
        const response = await fetchImpl(url, {
          headers: {
            "User-Agent": "Gravity Claw/0.1"
          }
        });
        if (!response.ok) {
          return JSON.stringify({
            ok: false,
            error: `Fetch failed with status ${response.status}.`
          });
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (/json/i.test(contentType)) {
          const payload = await response.json();
          const text = JSON.stringify(payload, null, 2);
          return JSON.stringify({
            ok: true,
            url: response.url,
            contentType,
            text: text.slice(0, maxChars),
            truncated: text.length > maxChars
          });
        }

        const html = await response.text();
        const text = stripHtml(html);

        return JSON.stringify({
          ok: true,
          url: response.url,
          contentType,
          ...(extractTitle(html) ? { title: extractTitle(html) } : {}),
          text: text.slice(0, maxChars),
          truncated: text.length > maxChars
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
