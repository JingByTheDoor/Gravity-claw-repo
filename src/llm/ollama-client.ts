import type { AgentMessage, LLMRunRequest, LLMRunResponse, ToolCall } from "../agent/types.js";
import type { LLMClient } from "./client.js";
import type { Logger } from "../logging/logger.js";

interface OllamaClientOptions {
  host: string;
  model: string;
  logger: Logger;
  healthCheckMaxAttempts?: number;
  healthCheckRetryDelayMs?: number;
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

const DEFAULT_HEALTH_CHECK_MAX_ATTEMPTS = 6;
const DEFAULT_HEALTH_CHECK_RETRY_DELAY_MS = 1_000;

export class OllamaClient implements LLMClient {
  constructor(private readonly options: OllamaClientOptions) {}

  async checkHealth(): Promise<void> {
    const maxAttempts = Math.max(1, this.options.healthCheckMaxAttempts ?? DEFAULT_HEALTH_CHECK_MAX_ATTEMPTS);
    const retryDelayMs = Math.max(0, this.options.healthCheckRetryDelayMs ?? DEFAULT_HEALTH_CHECK_RETRY_DELAY_MS);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(this.buildUrl("/api/tags"));
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
        return;
      } catch (error) {
        const normalizedError = this.normalizeHealthCheckError(error);
        if (!this.shouldRetryHealthCheck(normalizedError, attempt, maxAttempts)) {
          throw normalizedError;
        }

        lastError = normalizedError;
        this.options.logger.warn("ollama.health.retrying", {
          attempt,
          maxAttempts,
          host: this.options.host,
          error: normalizedError.message
        });
        await this.sleep(retryDelayMs);
      }
    }

    throw lastError ?? new Error(`Ollama health check failed for ${this.options.host}`);
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

  private normalizeHealthCheckError(error: unknown): Error {
    if (error instanceof Error) {
      if (/^Ollama (is unreachable|health check failed|chat request failed)/i.test(error.message)) {
        return error;
      }

      if (/^Configured Ollama model /i.test(error.message)) {
        return error;
      }

      return new Error(`Ollama is unreachable at ${this.options.host}: ${error.message}`);
    }

    return new Error(`Ollama is unreachable at ${this.options.host}: ${String(error)}`);
  }

  private shouldRetryHealthCheck(error: Error, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) {
      return false;
    }

    return !/^Configured Ollama model /i.test(error.message);
  }

  private async sleep(durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
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
