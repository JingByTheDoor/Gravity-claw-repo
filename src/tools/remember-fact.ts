import type { ToolDefinition, ToolExecutionContext } from "../agent/types.js";
import { MemoryStore } from "../memory/store.js";

function createErrorPayload(error: string): string {
  return JSON.stringify({
    ok: false,
    error
  });
}

export function createRememberFactTool(memoryStore: MemoryStore): ToolDefinition {
  return {
    name: "remember_fact",
    description: "Store a durable fact about the current chat, such as a preference, goal, or identity detail.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Short fact label, for example timezone or favorite_topic"
        },
        value: {
          type: "string",
          description: "Fact value to store"
        }
      },
      required: ["key", "value"],
      additionalProperties: false
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const key = input.key;
      const value = input.value;

      if (typeof key !== "string" || key.trim().length === 0) {
        return createErrorPayload("Key must be a non-empty string.");
      }

      if (typeof value !== "string" || value.trim().length === 0) {
        return createErrorPayload("Value must be a non-empty string.");
      }

      const fact = memoryStore.rememberFact(context.chatId, key.trim(), value.trim());
      return JSON.stringify({
        ok: true,
        fact
      });
    }
  };
}
