import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Logger } from "../logging/logger.js";
import { AppLauncher, scoreAppCandidate, type StartAppEntry } from "./app-launcher.js";

const MATCH_THRESHOLD = 72;

export interface RunningAppEntry {
  processName: string;
  id: number;
  title: string;
  mainWindowHandle: number;
}

export interface ResolvedRunningApp {
  processName: string;
  id: number;
  title: string;
  mainWindowHandle: number;
  score: number;
}

export interface ListAppsResult {
  ok: boolean;
  query?: string;
  running: RunningAppEntry[];
  installed?: StartAppEntry[];
  installedTotal: number;
}

export interface FocusAppResult {
  ok: boolean;
  query: string;
  matchedApp?: string;
  processId?: number;
  error?: string;
  candidates?: string[];
}

export interface CloseAppResult {
  ok: boolean;
  query: string;
  matchedApp?: string;
  processId?: number;
  force: boolean;
  closed?: boolean;
  error?: string;
  candidates?: string[];
}

export interface ScreenshotOptions {
  mode?: "full" | "region";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  outputPath?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  mode: "full" | "region";
  path: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface KeyboardTypeResult {
  ok: boolean;
  typedTextLength: number;
}

export interface KeyboardHotkeyResult {
  ok: boolean;
  keys: string[];
}

export interface MouseClickResult {
  ok: boolean;
  x: number;
  y: number;
  button: "left" | "right" | "middle";
  count: number;
}

interface DesktopControllerOptions {
  logger: Logger;
  appLauncher: AppLauncher;
  artifactsDir?: string;
  platform?: NodeJS.Platform;
  runPowerShell?: (command: string) => Promise<string>;
}

interface ResolveRunningAppResult {
  ok: boolean;
  app?: ResolvedRunningApp;
  error?: string;
  candidates: string[];
  ambiguous?: boolean;
}

function escapeForSendKeys(value: string): string {
  const escapedCharacters: Record<string, string> = {
    "{": "{{}",
    "}": "{}}",
    "+": "{+}",
    "^": "{^}",
    "%": "{%}",
    "~": "{~}",
    "(": "{(}",
    ")": "{)}",
    "[": "{[}",
    "]": "{]}",
    "\n": "{ENTER}",
    "\r": ""
  };

  return [...value].map((character) => escapedCharacters[character] ?? character).join("");
}

function parseBooleanLike(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

function parseIntegerLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!value || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function parseButton(value: unknown): "left" | "right" | "middle" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "left";
  if (normalized === "right" || normalized === "middle") {
    return normalized;
  }

  return "left";
}

function createPayloadLiteral(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function parseJsonResponse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function describeRunningApp(app: RunningAppEntry): string {
  return app.title ? `${app.processName} - ${app.title}` : app.processName;
}

function mapKeyToVirtualKeyCode(key: string): number | undefined {
  const normalized = key.trim().toLowerCase();
  if (normalized.length === 1) {
    const code = normalized.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return code - 32;
    }
    if (code >= 48 && code <= 57) {
      return code;
    }
  }

  const namedKeys: Record<string, number> = {
    ctrl: 0x11,
    control: 0x11,
    shift: 0x10,
    alt: 0x12,
    win: 0x5b,
    windows: 0x5b,
    enter: 0x0d,
    return: 0x0d,
    tab: 0x09,
    esc: 0x1b,
    escape: 0x1b,
    space: 0x20,
    up: 0x26,
    down: 0x28,
    left: 0x25,
    right: 0x27,
    delete: 0x2e,
    del: 0x2e,
    backspace: 0x08,
    home: 0x24,
    end: 0x23,
    pageup: 0x21,
    pagedown: 0x22,
    insert: 0x2d,
    capslock: 0x14,
    printscreen: 0x2c
  };

  if (namedKeys[normalized]) {
    return namedKeys[normalized];
  }

  const functionKeyMatch = normalized.match(/^f([1-9]|1[0-2])$/);
  if (functionKeyMatch?.[1]) {
    return 0x70 + Number.parseInt(functionKeyMatch[1], 10) - 1;
  }

  return undefined;
}

export class DesktopController {
  private readonly platform: NodeJS.Platform;
  private readonly artifactsDir: string;
  private readonly runPowerShellImpl: (command: string) => Promise<string>;

  constructor(private readonly options: DesktopControllerOptions) {
    this.platform = options.platform ?? process.platform;
    this.artifactsDir = options.artifactsDir ?? path.resolve(process.cwd(), "artifacts", "screenshots");
    this.runPowerShellImpl = options.runPowerShell ?? ((command) => this.runPowerShell(command));
  }

  async listApps(options: {
    query?: string;
    includeInstalled?: boolean;
    limit?: number;
  } = {}): Promise<ListAppsResult> {
    if (this.platform !== "win32") {
      return {
        ok: false,
        running: [],
        installedTotal: 0
      };
    }

    const limit = clampPositiveInteger(options.limit, 20);
    const runningApps = await this.listRunningApps();
    const running = this.filterRunningApps(runningApps, options.query, limit);
    const includeInstalled = options.includeInstalled ?? Boolean(options.query);

    if (!includeInstalled) {
      return {
        ok: true,
        ...(options.query ? { query: options.query.trim() } : {}),
        running,
        installedTotal: 0
      };
    }

    const installedApps = await this.options.appLauncher.listInstalledApps();
    const installed = this.filterInstalledApps(installedApps, options.query, limit);

    return {
      ok: true,
      ...(options.query ? { query: options.query.trim() } : {}),
      running,
      installed,
      installedTotal: installedApps.length
    };
  }

  async focusApp(query: string): Promise<FocusAppResult> {
    if (this.platform !== "win32") {
      return {
        ok: false,
        query,
        error: "App focusing is currently supported on Windows only."
      };
    }

    const resolution = await this.resolveRunningApp(query);
    if (!resolution.ok || !resolution.app) {
      return {
        ok: false,
        query: query.trim(),
        error: resolution.error ?? "No running app matched.",
        ...(resolution.candidates.length > 0 ? { candidates: resolution.candidates } : {})
      };
    }

    const payload = createPayloadLiteral({ processId: resolution.app.id });
    await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GravityClawUser32 {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$process = Get-Process -Id ([int]$payload.processId) -ErrorAction Stop
if ($process.MainWindowHandle -eq 0) {
  throw "The app does not have a visible main window."
}
[GravityClawUser32]::ShowWindowAsync($process.MainWindowHandle, 5) | Out-Null
Start-Sleep -Milliseconds 150
[GravityClawUser32]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Write-Output '{"ok":true}'
`);

    return {
      ok: true,
      query: query.trim(),
      matchedApp: describeRunningApp(resolution.app),
      processId: resolution.app.id
    };
  }

  async closeApp(query: string, force = false): Promise<CloseAppResult> {
    if (this.platform !== "win32") {
      return {
        ok: false,
        query,
        force,
        error: "App closing is currently supported on Windows only."
      };
    }

    const resolution = await this.resolveRunningApp(query);
    if (!resolution.ok || !resolution.app) {
      return {
        ok: false,
        query: query.trim(),
        force,
        error: resolution.error ?? "No running app matched.",
        ...(resolution.candidates.length > 0 ? { candidates: resolution.candidates } : {})
      };
    }

    const payload = createPayloadLiteral({
      processId: resolution.app.id,
      force
    });
    const stdout = await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$process = Get-Process -Id ([int]$payload.processId) -ErrorAction Stop
$closed = $false
if ($process.MainWindowHandle -ne 0) {
  $closed = $process.CloseMainWindow()
  Start-Sleep -Milliseconds 800
  try { $process.Refresh() } catch {}
}
if (-not $process.HasExited -and [bool]$payload.force) {
  Stop-Process -Id $process.Id -Force -ErrorAction Stop
  $closed = $true
}
$result = [ordered]@{
  ok = $true
  closed = [bool]($closed -or $process.HasExited)
}
$result | ConvertTo-Json -Compress
`);
    const parsed = parseJsonResponse<{ ok?: boolean; closed?: boolean }>(stdout);

    return {
      ok: parsed.ok === true,
      query: query.trim(),
      matchedApp: describeRunningApp(resolution.app),
      processId: resolution.app.id,
      force,
      closed: parsed.closed === true
    };
  }

  async takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    if (this.platform !== "win32") {
      throw new Error("Screenshot capture is currently supported on Windows only.");
    }

    const mode = options.mode ?? "full";
    if (mode !== "full" && mode !== "region") {
      throw new Error("Screenshot mode must be full or region.");
    }

    await fs.mkdir(this.artifactsDir, { recursive: true });
    const outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : path.join(this.artifactsDir, `screenshot-${Date.now()}.png`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const payload = createPayloadLiteral({
      mode,
      x: clampPositiveInteger(parseIntegerLike(options.x), 0),
      y: clampPositiveInteger(parseIntegerLike(options.y), 0),
      width: parseIntegerLike(options.width),
      height: parseIntegerLike(options.height),
      outputPath
    });

    const stdout = await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($payload.mode -eq 'region') {
  if (-not $payload.width -or -not $payload.height) {
    throw 'Region screenshots require width and height.'
  }
  $bounds = New-Object System.Drawing.Rectangle ([int]$payload.x), ([int]$payload.y), ([int]$payload.width), ([int]$payload.height)
} else {
  $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bounds = New-Object System.Drawing.Rectangle $virtual.X, $virtual.Y, $virtual.Width, $virtual.Height
}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($payload.outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[ordered]@{
  ok = $true
  mode = $payload.mode
  path = $payload.outputPath
  width = $bounds.Width
  height = $bounds.Height
  x = $bounds.X
  y = $bounds.Y
} | ConvertTo-Json -Compress
`);

    return parseJsonResponse<ScreenshotResult>(stdout);
  }

  async keyboardType(text: string): Promise<KeyboardTypeResult> {
    if (this.platform !== "win32") {
      throw new Error("Keyboard typing is currently supported on Windows only.");
    }

    if (text.trim().length === 0) {
      throw new Error("Text must be a non-empty string.");
    }

    const escapedText = escapeForSendKeys(text);
    const payload = createPayloadLiteral({ text: escapedText });
    await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait([string]$payload.text)
Write-Output '{"ok":true}'
`);

    return {
      ok: true,
      typedTextLength: text.length
    };
  }

  async keyboardHotkey(keys: string[]): Promise<KeyboardHotkeyResult> {
    if (this.platform !== "win32") {
      throw new Error("Keyboard hotkeys are currently supported on Windows only.");
    }

    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error("keys must be a non-empty array.");
    }

    const virtualKeyCodes = keys.flatMap((key) => {
      const code = mapKeyToVirtualKeyCode(key);
      return code === undefined ? [] : [code];
    });

    if (virtualKeyCodes.length !== keys.length) {
      throw new Error("One or more keys are unsupported.");
    }

    const payload = createPayloadLiteral({ virtualKeyCodes });
    await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GravityClawKeyboard {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@
$keys = @($payload.virtualKeyCodes | ForEach-Object { [byte]$_ })
foreach ($key in $keys) {
  [GravityClawKeyboard]::keybd_event($key, 0, 0, 0)
  Start-Sleep -Milliseconds 25
}
for ($index = $keys.Count - 1; $index -ge 0; $index--) {
  [GravityClawKeyboard]::keybd_event($keys[$index], 0, 2, 0)
  Start-Sleep -Milliseconds 25
}
Write-Output '{"ok":true}'
`);

    return {
      ok: true,
      keys
    };
  }

  async mouseClick(
    x: number,
    y: number,
    button: "left" | "right" | "middle" = "left",
    count = 1
  ): Promise<MouseClickResult> {
    if (this.platform !== "win32") {
      throw new Error("Mouse clicking is currently supported on Windows only.");
    }

    const clickCount = clampPositiveInteger(count, 1);
    const payload = createPayloadLiteral({
      x: Math.trunc(x),
      y: Math.trunc(y),
      button,
      count: clickCount
    });
    await this.runPowerShellImpl(`
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GravityClawMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$flags = switch ([string]$payload.button) {
  'right' { @(0x0008, 0x0010) }
  'middle' { @(0x0020, 0x0040) }
  default { @(0x0002, 0x0004) }
}
[GravityClawMouse]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
Start-Sleep -Milliseconds 80
for ($i = 0; $i -lt [int]$payload.count; $i++) {
  [GravityClawMouse]::mouse_event([uint32]$flags[0], 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 25
  [GravityClawMouse]::mouse_event([uint32]$flags[1], 0, 0, 0, [UIntPtr]::Zero)
  if ($i -lt ([int]$payload.count - 1)) {
    Start-Sleep -Milliseconds 120
  }
}
Write-Output '{"ok":true}'
`);

    return {
      ok: true,
      x: Math.trunc(x),
      y: Math.trunc(y),
      button,
      count: clickCount
    };
  }

  private filterRunningApps(
    apps: RunningAppEntry[],
    query: string | undefined,
    limit: number
  ): RunningAppEntry[] {
    if (!query || query.trim().length === 0) {
      return apps.slice(0, limit);
    }

    return apps
      .map((app) => ({
        app,
        score: Math.max(scoreAppCandidate(query, app.processName), scoreAppCandidate(query, app.title))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.app.processName.localeCompare(right.app.processName))
      .slice(0, limit)
      .map((entry) => entry.app);
  }

  private filterInstalledApps(
    apps: StartAppEntry[],
    query: string | undefined,
    limit: number
  ): StartAppEntry[] {
    if (!query || query.trim().length === 0) {
      return [...apps].sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit);
    }

    return apps
      .map((app) => ({
        app,
        score: scoreAppCandidate(query, app.name)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.app.name.localeCompare(right.app.name))
      .slice(0, limit)
      .map((entry) => entry.app);
  }

  private async resolveRunningApp(query: string): Promise<ResolveRunningAppResult> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return {
        ok: false,
        error: "App name must be a non-empty string.",
        candidates: []
      };
    }

    const runningApps = await this.listRunningApps();
    const matches = runningApps
      .map((app) => ({
        app,
        score: Math.max(scoreAppCandidate(trimmedQuery, app.processName), scoreAppCandidate(trimmedQuery, app.title))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.app.processName.localeCompare(right.app.processName));

    const candidates = matches.slice(0, 5).map((entry) => describeRunningApp(entry.app));
    const bestMatch = matches[0];
    if (!bestMatch || bestMatch.score < MATCH_THRESHOLD) {
      return {
        ok: false,
        error: `No running app matched "${trimmedQuery}".`,
        candidates
      };
    }

    const runnerUp = matches[1];
    if (
      runnerUp &&
      bestMatch.score < 100 &&
      bestMatch.score - runnerUp.score <= 3 &&
      describeRunningApp(bestMatch.app).toLowerCase() !== describeRunningApp(runnerUp.app).toLowerCase()
    ) {
      return {
        ok: false,
        error: `More than one running app matched "${trimmedQuery}".`,
        candidates,
        ambiguous: true
      };
    }

    return {
      ok: true,
      app: {
        ...bestMatch.app,
        score: bestMatch.score
      },
      candidates
    };
  }

  private async listRunningApps(): Promise<RunningAppEntry[]> {
    const stdout = await this.runPowerShellImpl(`
$apps = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Select-Object ProcessName, Id, MainWindowTitle, MainWindowHandle
$apps | ConvertTo-Json -Compress
`);

    if (stdout.trim().length === 0) {
      return [];
    }

    const parsed = JSON.parse(stdout) as
      | {
          ProcessName?: unknown;
          Id?: unknown;
          MainWindowTitle?: unknown;
          MainWindowHandle?: unknown;
        }
      | Array<{
          ProcessName?: unknown;
          Id?: unknown;
          MainWindowTitle?: unknown;
          MainWindowHandle?: unknown;
        }>;

    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      const processName = typeof entry.ProcessName === "string" ? entry.ProcessName.trim() : "";
      const id = typeof entry.Id === "number" ? entry.Id : Number(entry.Id);
      const title = typeof entry.MainWindowTitle === "string" ? entry.MainWindowTitle.trim() : "";
      const mainWindowHandle =
        typeof entry.MainWindowHandle === "number"
          ? entry.MainWindowHandle
          : Number(entry.MainWindowHandle);

      if (!processName || !title || !Number.isFinite(id) || !Number.isFinite(mainWindowHandle)) {
        return [];
      }

      return [{
        processName,
        id,
        title,
        mainWindowHandle
      }];
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

export function parseDesktopBoolean(input: unknown, fallback = false): boolean {
  return parseBooleanLike(input, fallback);
}

export function parseDesktopInteger(input: unknown): number | undefined {
  return parseIntegerLike(input);
}

export function parseMouseButton(input: unknown): "left" | "right" | "middle" {
  return parseButton(input);
}
