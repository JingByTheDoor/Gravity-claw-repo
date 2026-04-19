import type { ToolDefinition } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import { isSafeShellCommand, ShellRunner } from "./shell-runner.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./workspace.js";

export function createRunShellCommandTool(
  workspaceRoot: string,
  approvalStore: ApprovalStore,
  shellRunner: ShellRunner,
  logger: Logger
): ToolDefinition {
  return {
    name: "run_shell_command",
    description:
      "Run a local shell command in the workspace. Read-only commands can run immediately. Other commands require user approval first.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run."
        },
        cwd: {
          type: "string",
          description: "Optional relative working directory inside the workspace."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async execute(input, context) {
      const command = input.command;
      if (typeof command !== "string" || command.trim().length === 0) {
        return JSON.stringify({ ok: false, error: "Command must be a non-empty string." });
      }

      const cwd = resolveWorkspacePath(
        workspaceRoot,
        typeof input.cwd === "string" ? input.cwd : "."
      );

      if (!isSafeShellCommand(command)) {
        const approval = approvalStore.createShellApproval(context.chatId, command.trim(), cwd);
        return JSON.stringify({
          ok: false,
          approvalRequired: true,
          approvalId: approval.id,
          message: `Command requires approval. Ask the user to send /approve ${approval.id} or /deny ${approval.id}.`,
          cwd: toWorkspaceRelativePath(workspaceRoot, cwd)
        });
      }

      logger.info("shell.command.safe", {
        chatId: context.chatId,
        cwd: toWorkspaceRelativePath(workspaceRoot, cwd)
      });

      const result = await shellRunner.execute(command.trim(), cwd);
      return JSON.stringify({
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        cwd: toWorkspaceRelativePath(workspaceRoot, cwd)
      });
    }
  };
}
