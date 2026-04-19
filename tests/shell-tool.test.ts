import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApprovalStore } from "../src/approvals/store.js";
import { createLogger } from "../src/logging/logger.js";
import { createRunShellCommandTool } from "../src/tools/run-shell-command.js";
import type { ShellExecutionResult } from "../src/tools/shell-runner.js";
import { createPathAccessPolicy } from "../src/tools/workspace.js";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gravity-claw-shell-"));
}

describe("run_shell_command tool", () => {
  it("requires approval for non-read-only commands", async () => {
    const approvalStore = new ApprovalStore();
    const shellRunner = {
      execute: vi.fn(async (): Promise<ShellExecutionResult> => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: ""
      }))
    };

    const tool = createRunShellCommandTool(
      createPathAccessPolicy(process.cwd()),
      approvalStore,
      shellRunner as never,
      createLogger("error")
    );

    const result = JSON.parse(
      await tool.execute({ command: "npm install" }, { chatId: "chat-1" })
    ) as {
      approvalRequired: boolean;
      approvalId: string;
    };

    expect(result.approvalRequired).toBe(true);
    expect(result.approvalId).toBeTruthy();
    expect(approvalStore.listPending("chat-1")).toHaveLength(1);
  });

  it("runs safe read-only shell commands immediately", async () => {
    const approvalStore = new ApprovalStore();
    const shellRunner = {
      execute: vi.fn(async (): Promise<ShellExecutionResult> => ({
        ok: true,
        exitCode: 0,
        stdout: "status output",
        stderr: ""
      }))
    };

    const tool = createRunShellCommandTool(
      createPathAccessPolicy(process.cwd()),
      approvalStore,
      shellRunner as never,
      createLogger("error")
    );

    const result = JSON.parse(
      await tool.execute({ command: "git status" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      stdout: string;
    };

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("status output");
    expect(approvalStore.listPending("chat-1")).toHaveLength(0);
  });

  it("allows absolute cwd inside extra trusted roots", async () => {
    const approvalStore = new ApprovalStore();
    const shellRunner = {
      execute: vi.fn(async (): Promise<ShellExecutionResult> => ({
        ok: true,
        exitCode: 0,
        stdout: "ok",
        stderr: ""
      }))
    };

    const workspaceRoot = createTempRoot();
    const otherRoot = createTempRoot();
    const tool = createRunShellCommandTool(
      createPathAccessPolicy(workspaceRoot, [otherRoot]),
      approvalStore,
      shellRunner as never,
      createLogger("error")
    );

    const result = JSON.parse(
      await tool.execute({ command: "git status", cwd: otherRoot }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      cwd: string;
    };

    expect(result.ok).toBe(true);
    expect(result.cwd).toBe(otherRoot);
  });

  it("rejects cwd outside trusted roots", async () => {
    const approvalStore = new ApprovalStore();
    const shellRunner = {
      execute: vi.fn(async (): Promise<ShellExecutionResult> => ({
        ok: true,
        exitCode: 0,
        stdout: "ok",
        stderr: ""
      }))
    };

    const workspaceRoot = createTempRoot();
    const outsideRoot = createTempRoot();
    const tool = createRunShellCommandTool(
      createPathAccessPolicy(workspaceRoot),
      approvalStore,
      shellRunner as never,
      createLogger("error")
    );

    const result = JSON.parse(
      await tool.execute({ command: "git status", cwd: outsideRoot }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the allowed local roots");
    expect(shellRunner.execute).not.toHaveBeenCalled();
  });
});
