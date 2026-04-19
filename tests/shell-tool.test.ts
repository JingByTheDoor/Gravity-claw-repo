import { describe, expect, it, vi } from "vitest";
import { ApprovalStore } from "../src/approvals/store.js";
import { createLogger } from "../src/logging/logger.js";
import { createRunShellCommandTool } from "../src/tools/run-shell-command.js";
import type { ShellExecutionResult } from "../src/tools/shell-runner.js";

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
      process.cwd(),
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
      process.cwd(),
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
});
