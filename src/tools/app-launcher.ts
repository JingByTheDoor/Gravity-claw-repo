import { spawn } from "node:child_process";
import type { Logger } from "../logging/logger.js";

export interface StartAppEntry {
  name: string;
  appId: string;
}

export interface ResolvedApp {
  name: string;
  appId: string;
  score: number;
  source: "alias" | "start_apps";
}

export interface ResolveAppResult {
  ok: boolean;
  app?: ResolvedApp;
  error?: string;
  candidates: string[];
  ambiguous?: boolean;
}

export interface LaunchAppResult {
  ok: boolean;
  query: string;
  matchedName?: string;
  appId?: string;
  source?: "alias" | "start_apps";
  error?: string;
  candidates?: string[];
}

interface AppLauncherOptions {
  logger: Logger;
  platform?: NodeJS.Platform;
  listStartApps?: () => Promise<StartAppEntry[]>;
  launchAppId?: (appId: string) => Promise<void>;
  startAppsCacheTtlMs?: number;
}

interface CachedStartApps {
  expiresAt: number;
  entries: StartAppEntry[];
}

export function normalizeAppLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function collapseAppLabel(value: string): string {
  return normalizeAppLabel(value).replace(/\s+/g, "");
}

function tokenizeAppLabel(value: string): string[] {
  return normalizeAppLabel(value).split(/\s+/).filter((token) => token.length > 0);
}

export function scoreAppCandidate(query: string, candidate: string): number {
  const normalizedQuery = normalizeAppLabel(query);
  const normalizedCandidate = normalizeAppLabel(candidate);
  const collapsedQuery = collapseAppLabel(query);
  const collapsedCandidate = collapseAppLabel(candidate);

  if (!collapsedQuery || !collapsedCandidate) {
    return 0;
  }

  if (collapsedQuery === collapsedCandidate) {
    return 100;
  }

  if (
    collapsedCandidate.startsWith(collapsedQuery) ||
    collapsedQuery.startsWith(collapsedCandidate)
  ) {
    return 90;
  }

  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return 82;
  }

  const queryTokens = tokenizeAppLabel(query);
  const candidateTokens = new Set(tokenizeAppLabel(candidate));
  const sharedTokenCount = queryTokens.filter((token) => candidateTokens.has(token)).length;

  if (sharedTokenCount === queryTokens.length && queryTokens.length > 0) {
    return 72 + Math.min(sharedTokenCount, 3);
  }

  if (sharedTokenCount > 0) {
    return 40 + sharedTokenCount;
  }

  return 0;
}

export class AppLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly listStartAppsImpl: () => Promise<StartAppEntry[]>;
  private readonly launchAppIdImpl: (appId: string) => Promise<void>;
  private readonly aliasCache = new Map<string, ResolvedApp>();
  private readonly startAppsCacheTtlMs: number;
  private startAppsCache?: CachedStartApps;

  constructor(private readonly options: AppLauncherOptions) {
    this.platform = options.platform ?? process.platform;
    this.listStartAppsImpl = options.listStartApps ?? (() => this.listStartAppsFromWindows());
    this.launchAppIdImpl = options.launchAppId ?? ((appId) => this.launchWindowsAppId(appId));
    this.startAppsCacheTtlMs = Math.max(0, options.startAppsCacheTtlMs ?? 60_000);
  }

  async resolve(appName: string): Promise<ResolveAppResult> {
    const trimmedName = appName.trim();
    if (trimmedName.length === 0) {
      return {
        ok: false,
        error: "App name must be a non-empty string.",
        candidates: []
      };
    }

    if (this.platform !== "win32") {
      return {
        ok: false,
        error: "App launching is currently supported on Windows only.",
        candidates: []
      };
    }

    const aliasKey = collapseAppLabel(trimmedName);
    const aliased = this.aliasCache.get(aliasKey);
    if (aliased) {
      return {
        ok: true,
        app: {
          ...aliased,
          source: "alias"
        },
        candidates: [aliased.name]
      };
    }

    const startApps = await this.getStartApps();
    const matches = startApps
      .map((entry) => ({
        entry,
        score: scoreAppCandidate(trimmedName, entry.name)
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));

    const candidateNames = matches.slice(0, 5).map((match) => match.entry.name);
    const bestMatch = matches[0];
    if (!bestMatch || bestMatch.score < 72) {
      return {
        ok: false,
        error: `No installed app matched "${trimmedName}".`,
        candidates: candidateNames
      };
    }

    const runnerUp = matches[1];
    if (
      runnerUp &&
      bestMatch.score < 100 &&
      bestMatch.score - runnerUp.score <= 3 &&
      bestMatch.entry.name.toLowerCase() !== runnerUp.entry.name.toLowerCase()
    ) {
      return {
        ok: false,
        error: `More than one installed app matched "${trimmedName}".`,
        candidates: candidateNames,
        ambiguous: true
      };
    }

    const resolved: ResolvedApp = {
      name: bestMatch.entry.name,
      appId: bestMatch.entry.appId,
      score: bestMatch.score,
      source: "start_apps"
    };
    this.rememberAlias(trimmedName, resolved);

    return {
      ok: true,
      app: resolved,
      candidates: candidateNames
    };
  }

  async launch(appName: string): Promise<LaunchAppResult> {
    const resolution = await this.resolve(appName);
    if (!resolution.ok || !resolution.app) {
      this.options.logger.warn("app.launch.not_found", {
        query: appName,
        candidates: resolution.candidates,
        ambiguous: resolution.ambiguous ?? false
      });
      return {
        ok: false,
        query: appName.trim(),
        error: resolution.error ?? "App lookup failed.",
        ...(resolution.candidates.length > 0 ? { candidates: resolution.candidates } : {})
      };
    }

    await this.launchAppIdImpl(resolution.app.appId);

    this.options.logger.info("app.launch.ok", {
      query: appName,
      matchedName: resolution.app.name,
      source: resolution.app.source
    });

    return {
      ok: true,
      query: appName.trim(),
      matchedName: resolution.app.name,
      appId: resolution.app.appId,
      source: resolution.app.source
    };
  }

  async listInstalledApps(): Promise<StartAppEntry[]> {
    if (this.platform !== "win32") {
      return [];
    }

    return this.getStartApps();
  }

  private async getStartApps(): Promise<StartAppEntry[]> {
    const now = Date.now();
    if (this.startAppsCache && this.startAppsCache.expiresAt > now) {
      return this.startAppsCache.entries;
    }

    const entries = await this.listStartAppsImpl();
    this.startAppsCache = {
      entries,
      expiresAt: now + this.startAppsCacheTtlMs
    };
    return entries;
  }

  private rememberAlias(query: string, resolvedApp: ResolvedApp): void {
    const normalizedQuery = collapseAppLabel(query);
    const normalizedName = collapseAppLabel(resolvedApp.name);

    this.aliasCache.set(normalizedQuery, resolvedApp);
    this.aliasCache.set(normalizedName, resolvedApp);
  }

  private async listStartAppsFromWindows(): Promise<StartAppEntry[]> {
    const stdout = await this.runPowerShell(
      "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"
    );

    if (stdout.trim().length === 0) {
      return [];
    }

    const parsed = JSON.parse(stdout) as
      | { Name?: unknown; AppID?: unknown; AppId?: unknown }
      | Array<{ Name?: unknown; AppID?: unknown; AppId?: unknown }>;

    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      const name = typeof entry.Name === "string" ? entry.Name.trim() : "";
      const appId =
        typeof entry.AppID === "string"
          ? entry.AppID.trim()
          : typeof entry.AppId === "string"
            ? entry.AppId.trim()
            : "";

      if (!name || !appId) {
        return [];
      }

      return [{ name, appId }];
    });
  }

  private async launchWindowsAppId(appId: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("explorer.exe", [`shell:AppsFolder\\${appId}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });

      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  private async runPowerShell(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], {
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `PowerShell exited with code ${String(code)}`));
          return;
        }

        resolve(stdout.trim());
      });
    });
  }
}
