import type { ToolDefinition } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import { validateShellCommandTargets } from "./shell-command-policy.js";
import { ShellRunner } from "./shell-runner.js";
import { describeAccessiblePath, type PathAccessPolicy, resolveAccessiblePath } from "./workspace.js";

export function createRunShellCommandTool(
  pathAccessPolicy: PathAccessPolicy,
  approvalStore: ApprovalStore,
  _shellRunner: ShellRunner,
  _logger: Logger
): ToolDefinition {
  return {
    name: "run_shell_command",
    description:
      "Prepare a local shell command inside trusted local roots. Relative cwd uses the default workspace root; absolute cwd must stay inside allowed roots. Every shell command requires user approval before execution.",
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
        const validation = validateShellCommandTargets(command.trim(), cwd, pathAccessPolicy);
        if (!validation.ok) {
          return JSON.stringify({
            ok: false,
            error: validation.error
          });
        }

        const approval = approvalStore.createShellApproval(context.chatId, command.trim(), cwd);
        return JSON.stringify({
          ok: false,
          approvalRequired: true,
          approvalId: approval.id,
          message: `Command requires approval. Ask the user to send /approve ${approval.id} or /deny ${approval.id}.`,
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
