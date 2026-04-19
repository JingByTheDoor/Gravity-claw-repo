import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../agent/types.js";
import { isIgnoredPathSegment, resolveWorkspacePath, toWorkspaceRelativePath } from "./workspace.js";

interface SearchMatch {
  path: string;
  line: number;
  content: string;
}

async function searchDirectory(
  workspaceRoot: string,
  directoryPath: string,
  query: string,
  limit: number,
  matches: SearchMatch[]
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= limit) {
      return;
    }

    if (isIgnoredPathSegment(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await searchDirectory(workspaceRoot, absolutePath, query, limit, matches);
      continue;
    }

    const buffer = await fs.readFile(absolutePath, "utf8").catch(() => undefined);
    if (buffer === undefined) {
      continue;
    }

    const lines = buffer.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= limit) {
        return;
      }

      if (lines[index]?.toLowerCase().includes(query)) {
        matches.push({
          path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
          line: index + 1,
          content: lines[index] ?? ""
        });
      }
    }
  }
}

export function createSearchFilesTool(workspaceRoot: string): ToolDefinition {
  return {
    name: "search_files",
    description: "Search text files in the local workspace for a plain-text query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Plain-text search query."
        },
        path: {
          type: "string",
          description: "Optional relative directory inside the workspace."
        },
        limit: {
          type: "string",
          description: "Optional max result count, default 20."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(input) {
      const rawQuery = input.query;
      if (typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "Query must be a non-empty string." });
      }

      const query = rawQuery.trim().toLowerCase();
      const relativePath = typeof input.path === "string" ? input.path : ".";
      const parsedLimit = Number.parseInt(String(input.limit ?? "20"), 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
      const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath);
      const matches: SearchMatch[] = [];

      await searchDirectory(workspaceRoot, absolutePath, query, limit, matches);

      return JSON.stringify({
        ok: true,
        query: rawQuery.trim(),
        matches
      });
    }
  };
}
