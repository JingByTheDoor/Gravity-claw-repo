import fs from "node:fs/promises";
import type { ToolDefinition } from "../agent/types.js";
import { ensureFileExists, resolveWorkspacePath, toWorkspaceRelativePath } from "./workspace.js";

export function createReadFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a text file from the local workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the workspace."
        },
        start_line: {
          type: "string",
          description: "Optional 1-based start line."
        },
        end_line: {
          type: "string",
          description: "Optional 1-based end line."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(input) {
      const relativePath = input.path;
      if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "Path must be a non-empty string." });
      }

      const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath);
      ensureFileExists(absolutePath);

      const content = await fs.readFile(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      const startLine = Math.max(Number.parseInt(String(input.start_line ?? "1"), 10) || 1, 1);
      const parsedEndLine = Number.parseInt(String(input.end_line ?? String(lines.length)), 10);
      const endLine = Math.min(Number.isFinite(parsedEndLine) ? parsedEndLine : lines.length, lines.length);
      const sliced = lines.slice(startLine - 1, endLine);

      return JSON.stringify({
        ok: true,
        path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
        startLine,
        endLine,
        content: sliced.join("\n")
      });
    }
  };
}
