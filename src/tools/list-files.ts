import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../agent/types.js";
import {
  describeAccessiblePath,
  ensureDirectoryExists,
  isIgnoredPathSegment,
  type PathAccessPolicy,
  resolveAccessiblePath
} from "./workspace.js";

async function walkDirectory(
  pathAccessPolicy: PathAccessPolicy,
  directoryPath: string,
  recursive: boolean,
  limit: number,
  output: string[]
): Promise<void> {
  if (output.length >= limit) {
    return;
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (isIgnoredPathSegment(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    const displayPath = describeAccessiblePath(pathAccessPolicy, absolutePath);
    output.push(entry.isDirectory() ? `${displayPath}/` : displayPath);

    if (output.length >= limit) {
      return;
    }

    if (recursive && entry.isDirectory()) {
      await walkDirectory(pathAccessPolicy, absolutePath, recursive, limit, output);
      if (output.length >= limit) {
        return;
      }
    }
  }
}

export function createListFilesTool(pathAccessPolicy: PathAccessPolicy): ToolDefinition {
  return {
    name: "list_files",
    description: "List files and folders inside trusted local roots. Relative paths use the default workspace root; absolute paths must stay inside allowed roots.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional relative path in the default root, or an absolute path inside allowed roots."
        },
        recursive: {
          type: "string",
          description: "Set to true to walk subdirectories. Otherwise only one level."
        },
        limit: {
          type: "string",
          description: "Optional max result count, default 50."
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      try {
        const relativePath = typeof input.path === "string" ? input.path : ".";
        const recursive = String(input.recursive ?? "false").toLowerCase() === "true";
        const parsedLimit = Number.parseInt(String(input.limit ?? "50"), 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

        const absolutePath = resolveAccessiblePath(pathAccessPolicy, relativePath);
        ensureDirectoryExists(absolutePath);

        const entries: string[] = [];
        await walkDirectory(pathAccessPolicy, absolutePath, recursive, limit, entries);

        return JSON.stringify({
          ok: true,
          path: describeAccessiblePath(pathAccessPolicy, absolutePath),
          entries
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
