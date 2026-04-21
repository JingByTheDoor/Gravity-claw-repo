import type { ModelProvider } from "../runtime/contracts.js";
import type { Logger } from "../logging/logger.js";
import type { GemmaVisionTokenBudget, OllamaSamplingConfig } from "./gemma.js";
import { OllamaClient } from "./ollama-client.js";
import { VisionClient } from "../tools/vision-client.js";

interface OllamaModelProviderOptions {
  host: string;
  logger: Logger;
  sampling: OllamaSamplingConfig;
  visionTokenBudget?: GemmaVisionTokenBudget;
}

export class OllamaModelProvider implements ModelProvider {
  readonly kind = "ollama";
  readonly endpoint: string;

  constructor(private readonly options: OllamaModelProviderOptions) {
    this.endpoint = options.host;
  }

  createChatClient(model: string): OllamaClient {
    return new OllamaClient({
      host: this.options.host,
      model,
      logger: this.options.logger,
      sampling: this.options.sampling
    });
  }

  createVisionClient(model: string): VisionClient {
    return new VisionClient({
      host: this.options.host,
      model,
      logger: this.options.logger,
      sampling: this.options.sampling,
      ...(this.options.visionTokenBudget !== undefined
        ? { visionTokenBudget: this.options.visionTokenBudget }
        : {})
    });
  }
}
