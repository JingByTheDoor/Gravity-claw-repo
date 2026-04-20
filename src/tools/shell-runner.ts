import { spawn } from "node:child_process";
import type { PendingApproval } from "../approvals/store.js";

const SAFE_COMMAND_PREFIXES = [
  "get-date",
  "get-location",
  "pwd",
  "ls",
  "dir",
  "get-childitem",
  "get-content",
  "type ",
  "cat ",
  "select-string",
  "rg ",
  "git status",
  "git diff",
  "git diff --stat",
  "git log",
  "git show",
  "whoami",
  "node -v",
  "npm -v",
  "npm test",
  "npm run build",
  "npm run typecheck",
  "tsc --noemit",
  "ollama list",
  "ollama ps"
];

export interface ShellExecutionResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function truncateOutput(value: string, maxLength = 4000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function isSafeShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return SAFE_COMMAND_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

export class ShellRunner {
  constructor(private readonly timeoutMs = 15000) {}

  async execute(command: string, cwd: string): Promise<ShellExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = process.platform === "win32"
        ? spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], { cwd })
        : spawn("bash", ["-lc", command], { cwd });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        child.kill();
        if (!settled) {
          settled = true;
          reject(new Error("Shell command timed out."));
        }
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve({
            ok: code === 0,
            exitCode: code,
            stdout: truncateOutput(stdout.trim()),
            stderr: truncateOutput(stderr.trim())
          });
        }
      });
    });
  }

  async executeApproval(approval: PendingApproval): Promise<ShellExecutionResult> {
    return this.execute(approval.command, approval.cwd);
  }
}
