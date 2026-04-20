import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../agent/types.js";
import { describeAccessiblePath, type PathAccessPolicy, resolveAccessiblePath } from "./workspace.js";

function parseMode(input: unknown): "overwrite" | "append" | "create_new" {
  return input === "append" || input === "create_new" ? input : "overwrite";
}

export function createWriteFileTool(pathAccessPolicy: PathAccessPolicy): ToolDefinition {
  return {
    name: "write_file",
    description:
      "Write text to a file inside trusted local roots. Supports overwrite, append, and create_new modes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path in the default root, or an absolute path inside allowed roots."
        },
        content: {
          type: "string",
          description: "Text content to write."
        },
        mode: {
          type: "string",
          description: "Write mode: overwrite, append, or create_new.",
          enum: ["overwrite", "append", "create_new"]
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    async execute(input) {
      try {
        const filePath = input.path;
        const content = input.content;
        if (typeof filePath !== "string" || filePath.trim().length === 0) {
          return JSON.stringify({ ok: false, error: "path must be a non-empty string." });
        }

        if (typeof content !== "string") {
          return JSON.stringify({ ok: false, error: "content must be a string." });
        }

        const absolutePath = resolveAccessiblePath(pathAccessPolicy, filePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });

        const mode = parseMode(input.mode);
        if (mode === "create_new") {
          const existing = await fs.stat(absolutePath).catch(() => undefined);
          if (existing) {
            return JSON.stringify({
              ok: false,
              error: "File already exists."
            });
          }
        }

        if (mode === "append") {
          await fs.appendFile(absolutePath, content, "utf8");
        } else {
          await fs.writeFile(absolutePath, content, {
            encoding: "utf8",
            flag: mode === "create_new" ? "wx" : "w"
          });
        }

        return JSON.stringify({
          ok: true,
          mode,
          path: describeAccessiblePath(pathAccessPolicy, absolutePath),
          bytesWritten: Buffer.byteLength(content, "utf8")
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
