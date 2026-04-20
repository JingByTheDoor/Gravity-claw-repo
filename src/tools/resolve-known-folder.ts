import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../agent/types.js";
import { describeAccessiblePath, type PathAccessPolicy, resolveAccessiblePath } from "./workspace.js";

const execFileAsync = promisify(execFile);
const WINDOWS_USER_SHELL_FOLDERS_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

type SupportedKnownFolder =
  | "home"
  | "downloads"
  | "desktop"
  | "documents"
  | "pictures"
  | "music"
  | "videos";

interface KnownFolderSpec {
  aliases: string[];
  fallbackSegments: string[];
  windowsValueNames: string[];
}

interface ResolveKnownFolderDependencies {
  platform: NodeJS.Platform;
  homedir: () => string;
  pathExists: (candidatePath: string) => boolean;
  readWindowsUserShellFolder: (valueName: string) => Promise<string | undefined>;
}

const KNOWN_FOLDER_SPECS: Record<SupportedKnownFolder, KnownFolderSpec> = {
  home: {
    aliases: ["home", "home folder", "user home", "profile", "profile folder"],
    fallbackSegments: [],
    windowsValueNames: []
  },
  downloads: {
    aliases: ["downloads", "download", "downloads folder", "download folder"],
    fallbackSegments: ["Downloads"],
    windowsValueNames: ["{374DE290-123F-4565-9164-39C4925E467B}", "Downloads"]
  },
  desktop: {
    aliases: ["desktop", "desktop folder"],
    fallbackSegments: ["Desktop"],
    windowsValueNames: ["Desktop"]
  },
  documents: {
    aliases: ["documents", "document", "docs", "documents folder", "document folder"],
    fallbackSegments: ["Documents"],
    windowsValueNames: ["Personal"]
  },
  pictures: {
    aliases: ["pictures", "picture", "photos", "pictures folder", "photos folder"],
    fallbackSegments: ["Pictures"],
    windowsValueNames: ["My Pictures"]
  },
  music: {
    aliases: ["music", "music folder"],
    fallbackSegments: ["Music"],
    windowsValueNames: ["My Music"]
  },
  videos: {
    aliases: ["videos", "video", "videos folder", "video folder"],
    fallbackSegments: ["Videos"],
    windowsValueNames: ["My Video"]
  }
};

const SUPPORTED_KNOWN_FOLDERS = Object.keys(KNOWN_FOLDER_SPECS).join(", ");

function defaultPathExists(candidatePath: string): boolean {
  const stat = fs.statSync(candidatePath, { throwIfNoEntry: false });
  return !!stat && stat.isDirectory();
}

function normalizeFolderName(rawValue: string): SupportedKnownFolder | undefined {
  const normalized = rawValue
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return undefined;
  }

  for (const [folderName, spec] of Object.entries(KNOWN_FOLDER_SPECS) as Array<
    [SupportedKnownFolder, KnownFolderSpec]
  >) {
    if (spec.aliases.includes(normalized)) {
      return folderName;
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readEnvironmentVariableCaseInsensitive(name: string): string | undefined {
  const exactMatch = process.env[name];
  if (typeof exactMatch === "string") {
    return exactMatch;
  }

  const loweredName = name.toLowerCase();
  const matchingEntry = Object.entries(process.env).find(([key]) => key.toLowerCase() === loweredName);
  return typeof matchingEntry?.[1] === "string" ? matchingEntry[1] : undefined;
}

function expandWindowsEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, variableName: string) => {
    const resolvedValue = readEnvironmentVariableCaseInsensitive(variableName);
    return resolvedValue ?? `%${variableName}%`;
  });
}

async function readWindowsUserShellFolderFromRegistry(
  valueName: string
): Promise<string | undefined> {
  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      ["query", WINDOWS_USER_SHELL_FOLDERS_KEY, "/v", valueName],
      {
        windowsHide: true
      }
    );

    const matcher = new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_\\w+\\s+(.+)$`, "im");
    const match = stdout.match(matcher);
    if (!match?.[1]) {
      return undefined;
    }

    return expandWindowsEnvironmentVariables(match[1].trim());
  } catch {
    return undefined;
  }
}

function createDependencies(
  overrides: Partial<ResolveKnownFolderDependencies> = {}
): ResolveKnownFolderDependencies {
  return {
    platform: overrides.platform ?? process.platform,
    homedir: overrides.homedir ?? os.homedir,
    pathExists: overrides.pathExists ?? defaultPathExists,
    readWindowsUserShellFolder:
      overrides.readWindowsUserShellFolder ?? readWindowsUserShellFolderFromRegistry
  };
}

async function resolveKnownFolderPath(
  folder: SupportedKnownFolder,
  dependencies: ResolveKnownFolderDependencies
): Promise<string> {
  if (folder === "home") {
    return path.resolve(dependencies.homedir());
  }

  const spec = KNOWN_FOLDER_SPECS[folder];
  if (dependencies.platform === "win32") {
    for (const valueName of spec.windowsValueNames) {
      const candidatePath = await dependencies.readWindowsUserShellFolder(valueName);
      if (candidatePath && candidatePath.trim().length > 0) {
        return path.resolve(candidatePath);
      }
    }
  }

  return path.resolve(dependencies.homedir(), ...spec.fallbackSegments);
}

function isInsideAllowedRoots(policy: PathAccessPolicy, absolutePath: string): boolean {
  try {
    resolveAccessiblePath(policy, absolutePath);
    return true;
  } catch {
    return false;
  }
}

export function createResolveKnownFolderTool(
  pathAccessPolicy: PathAccessPolicy,
  overrides: Partial<ResolveKnownFolderDependencies> = {}
): ToolDefinition {
  const dependencies = createDependencies(overrides);

  return {
    name: "resolve_known_folder",
    description:
      "Resolve a common user folder like Downloads, Desktop, Documents, Pictures, Music, Videos, or Home to its real local path. Use this before file tools when the user names a standard folder without giving an exact path.",
    parameters: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description:
            "The common folder name to resolve. Examples: downloads, desktop, documents, pictures, music, videos, home."
        }
      },
      required: ["folder"],
      additionalProperties: false
    },
    async execute(input) {
      const rawFolder = typeof input.folder === "string" ? input.folder : "";
      const normalizedFolder = normalizeFolderName(rawFolder);

      if (!normalizedFolder) {
        return JSON.stringify({
          ok: false,
          error: `Unknown folder. Supported folders: ${SUPPORTED_KNOWN_FOLDERS}.`
        });
      }

      const absolutePath = await resolveKnownFolderPath(normalizedFolder, dependencies);
      const accessible = isInsideAllowedRoots(pathAccessPolicy, absolutePath);
      const exists = dependencies.pathExists(absolutePath);

      return JSON.stringify({
        ok: true,
        folder: normalizedFolder,
        path: absolutePath,
        displayPath: accessible
          ? describeAccessiblePath(pathAccessPolicy, absolutePath)
          : absolutePath,
        exists,
        accessible,
        ...(accessible ? {} : { accessError: "Path is outside the allowed local roots." })
      });
    }
  };
}
