import type { ToolDefinition } from "../agent/types.js";
import { createGetCurrentTimeTool } from "./get-current-time.js";

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

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.toolsByName.get(name);
    if (!tool) {
      return createToolError(`Unknown tool: ${name}`);
    }

    try {
      return await tool.execute(input);
    } catch (error) {
      return createToolError(
        error instanceof Error ? error.message : `Tool execution failed: ${String(error)}`
      );
    }
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([createGetCurrentTimeTool()]);
}
