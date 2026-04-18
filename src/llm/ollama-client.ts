import type { AgentMessage, LLMRunRequest, LLMRunResponse, ToolCall } from "../agent/types.js";
import type { LLMClient } from "./client.js";
import type { Logger } from "../logging/logger.js";

interface OllamaClientOptions {
  host: string;
  model: string;
  logger: Logger;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_name?: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export class OllamaClient implements LLMClient {
  constructor(private readonly options: OllamaClientOptions) {}

  async checkHealth(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl("/api/tags"));
    } catch (error) {
      throw new Error(
        `Ollama is unreachable at ${this.options.host}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Ollama health check failed with status ${response.status} ${response.statusText}`
      );
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const modelNames = new Set(
      (payload.models ?? []).flatMap((model) => (model.name ? [model.name] : []))
    );

    if (!modelNames.has(this.options.model)) {
      throw new Error(
        `Configured Ollama model "${this.options.model}" is not available locally.`
      );
    }

    this.options.logger.info("ollama.health.ok", {
      host: this.options.host,
      model: this.options.model
    });
  }

  async runStep(request: LLMRunRequest): Promise<LLMRunResponse> {
    const response = await fetch(this.buildUrl("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        messages: request.messages.map((message) => this.toOllamaMessage(message)),
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        })),
        options: {
          temperature: 0
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama chat request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    if (!payload.message) {
      throw new Error("Ollama response did not include a message payload.");
    }

    const toolCalls = this.parseToolCalls(payload.message.tool_calls);

    return {
      message: {
        role: "assistant",
        content: payload.message.content ?? "",
        ...(toolCalls ? { toolCalls } : {})
      }
    };
  }

  private buildUrl(pathname: string): string {
    const base = this.options.host.replace(/\/+$/, "");
    return `${base}${pathname}`;
  }

  private parseToolCalls(toolCalls: OllamaToolCall[] | undefined): ToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) {
      return undefined;
    }

    const parsed = toolCalls
      .map((toolCall) => {
        const name = toolCall.function?.name;
        if (!name) {
          return undefined;
        }

        return {
          name,
          arguments: toolCall.function?.arguments ?? {}
        } satisfies ToolCall;
      })
      .filter((toolCall): toolCall is ToolCall => toolCall !== undefined);

    return parsed.length > 0 ? parsed : undefined;
  }

  private toOllamaMessage(message: AgentMessage): OllamaMessage {
    if (message.role === "tool") {
      return {
        role: "tool",
        ...(message.toolName ? { tool_name: message.toolName } : {}),
        content: message.content
      };
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments
          }
        }))
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  }
}
