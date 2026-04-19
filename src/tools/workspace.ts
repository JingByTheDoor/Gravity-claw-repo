import fs from "node:fs";
import path from "node:path";

const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist"]);

function normalizeSlashes(value: string): string {
  return value.replace(/[\\/]+/g, path.sep);
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath = "."): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const safeRelativePath = normalizeSlashes(relativePath.trim() || ".");
  const resolvedPath = path.resolve(resolvedRoot, safeRelativePath);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Path escapes the workspace root.");
  }

  return resolvedPath;
}

export function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(workspaceRoot), absolutePath);
  return relativePath.length === 0 ? "." : relativePath.split(path.sep).join("/");
}

export function isIgnoredPathSegment(segment: string): boolean {
  return IGNORED_SEGMENTS.has(segment);
}

export function ensureFileExists(filePath: string): void {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error("Path does not exist.");
  }
  if (!stat.isFile()) {
    throw new Error("Path is not a file.");
  }
}

export function ensureDirectoryExists(directoryPath: string): void {
  const stat = fs.statSync(directoryPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error("Path does not exist.");
  }
  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory.");
  }
}
