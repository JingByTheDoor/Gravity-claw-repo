import type { ToolDefinition } from "../agent/types.js";

interface SearchWebToolOptions {
  fetchImpl?: typeof fetch;
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

interface BestSearchResult extends SearchResult {
  pageTitle?: string;
  text?: string;
  contentType?: string;
  truncated?: boolean;
}

const DEFAULT_MAX_PAGE_CHARS = 2_500;
const DEFAULT_PREFETCH_TIMEOUT_MS = 12_000;

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

async function fetchBestResult(
  fetchImpl: typeof fetch,
  results: SearchResult[],
  maxPageChars: number
): Promise<BestSearchResult | undefined> {
  for (const result of results.slice(0, 3)) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_PREFETCH_TIMEOUT_MS);

    try {
      const response = await fetchImpl(result.url, {
        headers: {
          "User-Agent": "Gravity Claw/0.1"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (/json/i.test(contentType)) {
        const payload = await response.json();
        const text = JSON.stringify(payload, null, 2);
        if (!text.trim()) {
          continue;
        }

        return {
          ...result,
          contentType,
          text: text.slice(0, maxPageChars),
          truncated: text.length > maxPageChars
        };
      }

      const html = await response.text();
      const text = stripHtml(html);
      if (!text) {
        continue;
      }

      return {
        ...result,
        ...(extractTitle(html) ? { pageTitle: extractTitle(html)! } : {}),
        ...(contentType ? { contentType } : {}),
        text: text.slice(0, maxPageChars),
        truncated: text.length > maxPageChars
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return undefined;
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
        },
        max_page_chars: {
          type: "string",
          description:
            "Optional maximum number of characters to include from the best fetched result page. Defaults to 2500."
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
      const maxPageCharsRaw =
        typeof input.max_page_chars === "string"
          ? Number.parseInt(input.max_page_chars, 10)
          : DEFAULT_MAX_PAGE_CHARS;
      const maxPageChars =
        Number.isFinite(maxPageCharsRaw) && maxPageCharsRaw > 0
          ? Math.min(maxPageCharsRaw, 8_000)
          : DEFAULT_MAX_PAGE_CHARS;

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
        const bestResult = await fetchBestResult(fetchImpl, results, maxPageChars);

        return JSON.stringify({
          ok: true,
          query,
          results,
          ...(bestResult ? { bestResult } : {})
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
