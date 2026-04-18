export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolName?: string;
  toolCalls?: ToolCall[];
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

export interface LLMRunRequest {
  messages: AgentMessage[];
  tools: ToolDefinition[];
}

export interface LLMRunResponse {
  message: AgentMessage;
}
