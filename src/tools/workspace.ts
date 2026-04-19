import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist"]);

export interface PathAccessPolicy {
  defaultRoot: string;
  allowedRoots: string[];
}

function normalizeSlashes(value: string): string {
  return value.replace(/[\\/]+/g, path.sep);
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

function normalizeForComparison(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  const normalizedTarget = normalizeForComparison(resolvedTarget);
  const normalizedRoot = normalizeForComparison(resolvedRoot);

  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

export function createPathAccessPolicy(
  defaultRoot: string,
  extraRoots: string[] = []
): PathAccessPolicy {
  const roots = [defaultRoot, ...extraRoots]
    .map((root) => expandHomePath(root))
    .filter((root) => root.length > 0)
    .map((root) => path.resolve(root));

  return {
    defaultRoot: roots[0] ?? path.resolve(defaultRoot),
    allowedRoots: [...new Set(roots)]
  };
}

export function resolveAccessiblePath(policy: PathAccessPolicy, inputPath = "."): string {
  const trimmedInput = inputPath.trim() || ".";
  const normalizedInput = normalizeSlashes(expandHomePath(trimmedInput));
  const candidatePath = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(policy.defaultRoot, normalizedInput);

  if (!policy.allowedRoots.some((root) => isPathInsideRoot(candidatePath, root))) {
    throw new Error("Path is outside the allowed local roots.");
  }

  return candidatePath;
}

export function describeAccessiblePath(policy: PathAccessPolicy, absolutePath: string): string {
  const resolvedPath = path.resolve(absolutePath);
  const relativePath = path.relative(policy.defaultRoot, resolvedPath);

  if (isPathInsideRoot(resolvedPath, policy.defaultRoot)) {
    return relativePath.length === 0 ? "." : relativePath.split(path.sep).join("/");
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
