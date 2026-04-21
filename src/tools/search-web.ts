import type { ToolDefinition } from "../agent/types.js";

interface SearchWebToolOptions {
  fetchImpl?: typeof fetch;
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDuckDuckGoUrl(rawUrl: string): string {
  const normalized = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  try {
    const url = new URL(normalized);
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : normalized;
  } catch {
    return normalized;
  }
}

function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const pattern =
    /<a rel="nofollow" href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?<td class='result-snippet'[^>]*>([\s\S]*?)<\/td>/gi;
  const results: SearchResult[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) && results.length < maxResults) {
    const rawUrl = match[1];
    const rawTitle = match[2];
    const rawSnippet = match[3];
    if (!rawUrl || !rawTitle || !rawSnippet) {
      continue;
    }
    const title = decodeHtml(rawTitle);
    const url = resolveDuckDuckGoUrl(rawUrl);
    const snippet = decodeHtml(rawSnippet);

    if (!title || !url) {
      continue;
    }

    results.push({
      title,
      url,
      ...(snippet ? { snippet } : {})
    });
  }

  return results;
}

export function createSearchWebTool(options: SearchWebToolOptions = {}): ToolDefinition {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "search_web",
    description:
      "Search the public web and return the top result titles, URLs, and snippets. Use this when you need sources or a direct page URL without driving a browser UI.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for."
        },
        max_results: {
          type: "string",
          description: "Optional number of results to return. Defaults to 5."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(input) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) {
        return JSON.stringify({
          ok: false,
          error: "query must be a non-empty string."
        });
      }

      const maxResultsRaw = typeof input.max_results === "string" ? Number.parseInt(input.max_results, 10) : 5;
      const maxResults =
        Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
          ? Math.min(maxResultsRaw, 10)
          : 5;

      try {
        const response = await fetchImpl(
          `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
        );
        if (!response.ok) {
          return JSON.stringify({
            ok: false,
            error: `Web search failed with status ${response.status}.`
          });
        }

        const html = await response.text();
        const results = parseSearchResults(html, maxResults);

        return JSON.stringify({
          ok: true,
          query,
          results
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
