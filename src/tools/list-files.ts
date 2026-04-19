import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../agent/types.js";
import { ensureDirectoryExists, isIgnoredPathSegment, resolveWorkspacePath, toWorkspaceRelativePath } from "./workspace.js";

async function walkDirectory(
  workspaceRoot: string,
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
    const relativePath = toWorkspaceRelativePath(workspaceRoot, absolutePath);
    output.push(entry.isDirectory() ? `${relativePath}/` : relativePath);

    if (output.length >= limit) {
      return;
    }

    if (recursive && entry.isDirectory()) {
      await walkDirectory(workspaceRoot, absolutePath, recursive, limit, output);
      if (output.length >= limit) {
        return;
      }
    }
  }
}

export function createListFilesTool(workspaceRoot: string): ToolDefinition {
  return {
    name: "list_files",
    description: "List files and folders inside the local workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional relative path inside the workspace."
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
      const relativePath = typeof input.path === "string" ? input.path : ".";
      const recursive = String(input.recursive ?? "false").toLowerCase() === "true";
      const parsedLimit = Number.parseInt(String(input.limit ?? "50"), 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

      const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath);
      ensureDirectoryExists(absolutePath);

      const entries: string[] = [];
      await walkDirectory(workspaceRoot, absolutePath, recursive, limit, entries);

      return JSON.stringify({
        ok: true,
        path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
        entries
      });
    }
  };
}
