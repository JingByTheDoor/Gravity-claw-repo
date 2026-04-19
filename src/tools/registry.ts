import type { ToolDefinition, ToolExecutionContext } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import { MemoryStore } from "../memory/store.js";
import { createGetCurrentTimeTool } from "./get-current-time.js";
import { createListFilesTool } from "./list-files.js";
import { createReadFileTool } from "./read-file.js";
import { createRecallMemoryTool } from "./recall-memory.js";
import { createRememberFactTool } from "./remember-fact.js";
import { createRunShellCommandTool } from "./run-shell-command.js";
import { createSearchFilesTool } from "./search-files.js";
import { ShellRunner } from "./shell-runner.js";
import type { PathAccessPolicy } from "./workspace.js";

function createToolError(message: string): string {
  return JSON.stringify({
    ok: false,
    error: message
  });
}

export class ToolRegistry {
  private readonly toolsByName: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  list(): ToolDefinition[] {
    return [...this.toolsByName.values()];
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<string> {
    const tool = this.toolsByName.get(name);
    if (!tool) {
      return createToolError(`Unknown tool: ${name}`);
    }

    try {
      return await tool.execute(input, context);
    } catch (error) {
      return createToolError(
        error instanceof Error ? error.message : `Tool execution failed: ${String(error)}`
      );
    }
  }
}

interface CreateDefaultToolRegistryOptions {
  memoryStore: MemoryStore;
  pathAccessPolicy: PathAccessPolicy;
  approvalStore: ApprovalStore;
  shellRunner: ShellRunner;
  logger: Logger;
}

export function createDefaultToolRegistry(options: CreateDefaultToolRegistryOptions): ToolRegistry {
  return new ToolRegistry([
    createGetCurrentTimeTool(),
    createRememberFactTool(options.memoryStore),
    createRecallMemoryTool(options.memoryStore),
    createListFilesTool(options.pathAccessPolicy),
    createReadFileTool(options.pathAccessPolicy),
    createSearchFilesTool(options.pathAccessPolicy),
    createRunShellCommandTool(
      options.pathAccessPolicy,
      options.approvalStore,
      options.shellRunner,
      options.logger
    )
  ]);
}
