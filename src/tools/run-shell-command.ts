import type { ToolDefinition } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import { isSafeShellCommand, ShellRunner } from "./shell-runner.js";
import { describeAccessiblePath, type PathAccessPolicy, resolveAccessiblePath } from "./workspace.js";

export function createRunShellCommandTool(
  pathAccessPolicy: PathAccessPolicy,
  approvalStore: ApprovalStore,
  shellRunner: ShellRunner,
  logger: Logger
): ToolDefinition {
  return {
    name: "run_shell_command",
    description:
      "Run a local shell command inside trusted local roots. Relative cwd uses the default workspace root; absolute cwd must stay inside allowed roots. Read-only commands can run immediately. Other commands require user approval first.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run."
        },
        cwd: {
          type: "string",
          description: "Optional relative working directory in the default root, or an absolute directory inside allowed roots."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async execute(input, context) {
      try {
        const command = input.command;
        if (typeof command !== "string" || command.trim().length === 0) {
          return JSON.stringify({ ok: false, error: "Command must be a non-empty string." });
        }

        const cwd = resolveAccessiblePath(
          pathAccessPolicy,
          typeof input.cwd === "string" ? input.cwd : "."
        );

        if (!isSafeShellCommand(command)) {
          const approval = approvalStore.createShellApproval(context.chatId, command.trim(), cwd);
          return JSON.stringify({
            ok: false,
            approvalRequired: true,
            approvalId: approval.id,
            message: `Command requires approval. Ask the user to send /approve ${approval.id} or /deny ${approval.id}.`,
            cwd: describeAccessiblePath(pathAccessPolicy, cwd)
          });
        }

        logger.info("shell.command.safe", {
          chatId: context.chatId,
          cwd: describeAccessiblePath(pathAccessPolicy, cwd)
        });

        const result = await shellRunner.execute(command.trim(), cwd);
        return JSON.stringify({
          ok: result.ok,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          cwd: describeAccessiblePath(pathAccessPolicy, cwd)
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
