import type { ToolDefinition, ToolExecutionContext } from "../agent/types.js";
import { MemoryStore } from "../memory/store.js";

export function createRecallMemoryTool(memoryStore: MemoryStore): ToolDefinition {
  return {
    name: "recall_memory",
    description: "Search stored facts and prior local conversation memory for the current chat.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query. Leave blank to list remembered facts."
        }
      },
      additionalProperties: false
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const rawQuery = input.query;
      const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
      return JSON.stringify(memoryStore.recallMemory(context.chatId, query, 5));
    }
  };
}
