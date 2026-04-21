import type { LLMClient } from "./client.js";
import type { LLMRunRequest, LLMRunResponse } from "../agent/types.js";
import type { Logger } from "../logging/logger.js";

interface FallbackLLMClientOptions {
  primaryClient: LLMClient;
  primaryModel: string;
  logger: Logger;
  fallbackClient?: LLMClient;
  fallbackModel?: string;
}

const RETRYABLE_CHAT_FAILURE_PATTERN =
  /(?:^Ollama chat request failed\b|fetch failed\b|request timed out\b|status 5\d\d\b)/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FallbackLLMClient implements LLMClient {
  constructor(private readonly options: FallbackLLMClientOptions) {}

  async checkHealth(): Promise<void> {
    await this.options.primaryClient.checkHealth();
  }

  async runStep(request: LLMRunRequest): Promise<LLMRunResponse> {
    try {
      return await this.options.primaryClient.runStep(request);
    } catch (primaryError) {
      if (!this.shouldRetryWithFallback(primaryError)) {
        throw primaryError;
      }

      const fallbackClient = this.options.fallbackClient;
      const fallbackModel = this.options.fallbackModel?.trim();
      if (!fallbackClient || !fallbackModel || fallbackModel === this.options.primaryModel) {
        throw primaryError;
      }

      this.options.logger.warn("llm.chat.fallback", {
        primaryModel: this.options.primaryModel,
        fallbackModel,
        error: describeError(primaryError)
      });

      try {
        return await fallbackClient.runStep(request);
      } catch (fallbackError) {
        throw new Error(
          `Primary model "${this.options.primaryModel}" failed and fallback model "${fallbackModel}" also failed. Primary error: ${describeError(primaryError)}. Fallback error: ${describeError(fallbackError)}`
        );
      }
    }
  }

  private shouldRetryWithFallback(error: unknown): boolean {
    return RETRYABLE_CHAT_FAILURE_PATTERN.test(describeError(error));
  }
}
