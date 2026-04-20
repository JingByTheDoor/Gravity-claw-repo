import type { PathAccessPolicy } from "./workspace.js";
import { resolveAccessiblePathFrom } from "./workspace.js";

const FILE_SYSTEM_PROVIDER_PATTERN = /^[A-Za-z]:($|[\\/])/;
const NON_FILE_PROVIDER_PATTERN = /^[A-Za-z]+:/;
const SAFE_FILE_COMMANDS = new Set(["ls", "dir", "get-childitem", "get-content", "type", "cat"]);

export interface ShellCommandValidationResult {
  ok: boolean;
  error?: string;
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character ?? "")) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function isOptionToken(token: string): boolean {
  return token.startsWith("-");
}

function isNonFilesystemProviderPath(value: string): boolean {
  const normalized = stripOuterQuotes(value.trim());
  return NON_FILE_PROVIDER_PATTERN.test(normalized) && !FILE_SYSTEM_PROVIDER_PATTERN.test(normalized);
}

function looksLikeExplicitFilesystemPath(value: string): boolean {
  const normalized = stripOuterQuotes(value.trim());
  return (
    FILE_SYSTEM_PROVIDER_PATTERN.test(normalized) ||
    normalized === "~" ||
    normalized.startsWith("~/") ||
    normalized.startsWith("~\\") ||
    normalized.startsWith("./") ||
    normalized.startsWith(".\\") ||
    normalized.startsWith("../") ||
    normalized.startsWith("..\\") ||
    /[\\/]/.test(normalized)
  );
}

function collectSafeCommandTargets(tokens: string[]): string[] {
  const commandName = tokens[0]?.toLowerCase();
  if (!commandName || !SAFE_FILE_COMMANDS.has(commandName)) {
    return [];
  }

  return tokens.slice(1).filter((token) => !isOptionToken(token));
}

function collectExplicitFilesystemTargets(tokens: string[]): string[] {
  return tokens.slice(1).filter((token) => {
    if (isOptionToken(token)) {
      return false;
    }

    return looksLikeExplicitFilesystemPath(token) || isNonFilesystemProviderPath(token);
  });
}

function validateTargetPath(
  policy: PathAccessPolicy,
  cwd: string,
  rawTarget: string
): ShellCommandValidationResult {
  const target = stripOuterQuotes(rawTarget.trim());
  if (target.length === 0) {
    return { ok: true };
  }

  if (isNonFilesystemProviderPath(target)) {
    return {
      ok: false,
      error: `Shell target "${target}" is not a local filesystem path inside the allowed roots.`
    };
  }

  try {
    resolveAccessiblePathFrom(policy, cwd, target);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function validateShellCommandTargets(
  command: string,
  cwd: string,
  pathAccessPolicy: PathAccessPolicy
): ShellCommandValidationResult {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) {
    return {
      ok: false,
      error: "Command must be a non-empty string."
    };
  }

  const targets = [...new Set([
    ...collectSafeCommandTargets(tokens),
    ...collectExplicitFilesystemTargets(tokens)
  ])];

  for (const target of targets) {
    const result = validateTargetPath(pathAccessPolicy, cwd, target);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}
