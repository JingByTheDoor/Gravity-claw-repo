import fs from "node:fs/promises";
import type { ToolDefinition } from "../agent/types.js";
import {
  describeAccessiblePath,
  ensureFileExists,
  type PathAccessPolicy,
  resolveAccessiblePath
} from "./workspace.js";

function parseAll(input: unknown): boolean {
  if (typeof input === "boolean") {
    return input;
  }

  if (typeof input === "string") {
    return input.trim().toLowerCase() === "true";
  }

  return false;
}

export function createReplaceInFileTool(pathAccessPolicy: PathAccessPolicy): ToolDefinition {
  return {
    name: "replace_in_file",
    description:
      "Replace text in a trusted local file. By default replaces the first match; set all=true to replace every match.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path in the default root, or an absolute file path inside allowed roots."
        },
        find: {
          type: "string",
          description: "Exact text to find."
        },
        replace: {
          type: "string",
          description: "Replacement text."
        },
        all: {
          type: "string",
          description: "Set to true to replace every match."
        }
      },
      required: ["path", "find", "replace"],
      additionalProperties: false
    },
    async execute(input) {
      try {
        const filePath = input.path;
        const find = input.find;
        const replace = input.replace;
        if (typeof filePath !== "string" || filePath.trim().length === 0) {
          return JSON.stringify({ ok: false, error: "path must be a non-empty string." });
        }
        if (typeof find !== "string" || find.length === 0) {
          return JSON.stringify({ ok: false, error: "find must be a non-empty string." });
        }
        if (typeof replace !== "string") {
          return JSON.stringify({ ok: false, error: "replace must be a string." });
        }

        const absolutePath = resolveAccessiblePath(pathAccessPolicy, filePath);
        ensureFileExists(absolutePath);

        const original = await fs.readFile(absolutePath, "utf8");
        const replaceAll = parseAll(input.all);
        let updated = original;
        let replacements = 0;

        if (replaceAll) {
          replacements = original.split(find).length - 1;
          updated = original.split(find).join(replace);
        } else {
          const index = original.indexOf(find);
          if (index >= 0) {
            replacements = 1;
            updated = `${original.slice(0, index)}${replace}${original.slice(index + find.length)}`;
          }
        }

        if (replacements === 0) {
          return JSON.stringify({
            ok: false,
            error: "No matching text found.",
            path: describeAccessiblePath(pathAccessPolicy, absolutePath)
          });
        }

        await fs.writeFile(absolutePath, updated, "utf8");

        return JSON.stringify({
          ok: true,
          path: describeAccessiblePath(pathAccessPolicy, absolutePath),
          replacements
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
