import fs from "node:fs/promises";
import type { ToolDefinition } from "../agent/types.js";
import {
  describeAccessiblePath,
  ensureFileExists,
  type PathAccessPolicy,
  resolveAccessiblePath
} from "./workspace.js";

export function createReadFileTool(pathAccessPolicy: PathAccessPolicy): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a text file from trusted local roots. Relative paths use the default workspace root; absolute paths must stay inside allowed roots.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path in the default root, or an absolute file path inside allowed roots."
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
      try {
        const relativePath = input.path;
        if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
          return JSON.stringify({ ok: false, error: "Path must be a non-empty string." });
        }

        const absolutePath = resolveAccessiblePath(pathAccessPolicy, relativePath);
        ensureFileExists(absolutePath);

        const content = await fs.readFile(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        const startLine = Math.max(Number.parseInt(String(input.start_line ?? "1"), 10) || 1, 1);
        const parsedEndLine = Number.parseInt(String(input.end_line ?? String(lines.length)), 10);
        const endLine = Math.min(Number.isFinite(parsedEndLine) ? parsedEndLine : lines.length, lines.length);
        const sliced = lines.slice(startLine - 1, endLine);

        return JSON.stringify({
          ok: true,
          path: describeAccessiblePath(pathAccessPolicy, absolutePath),
          startLine,
          endLine,
          content: sliced.join("\n")
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
