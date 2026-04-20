import type { ModelProvider } from "../runtime/contracts.js";
import type { Logger } from "../logging/logger.js";
import { OllamaClient } from "./ollama-client.js";
import { VisionClient } from "../tools/vision-client.js";

interface OllamaModelProviderOptions {
  host: string;
  logger: Logger;
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
      logger: this.options.logger
    });
  }

  createVisionClient(model: string): VisionClient {
    return new VisionClient({
      host: this.options.host,
      model,
      logger: this.options.logger
    });
  }
}
