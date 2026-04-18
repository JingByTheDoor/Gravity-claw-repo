import { buildSystemPrompt } from "./prompt.js";
import type { AgentMessage } from "./types.js";
import type { LLMClient } from "../llm/client.js";
import type { Logger } from "../logging/logger.js";
import type { ToolRegistry } from "../tools/registry.js";

export const ITERATION_LIMIT_MESSAGE =
  "I hit my safety limit before finishing. Please try again with a simpler request.";
export const LOCAL_ERROR_MESSAGE =
  "I hit a local error before finishing. Please try again.";
export const EMPTY_REPLY_MESSAGE =
  "I couldn't produce a useful reply.";

interface AgentLoopOptions {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  logger: Logger;
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(userInput: string): Promise<string> {
    const trimmedInput = userInput.trim();
    if (trimmedInput.length === 0) {
      return "Please send a text message.";
    }

    const messages: AgentMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: trimmedInput }
    ];

    try {
      for (let iteration = 1; iteration <= this.options.maxIterations; iteration += 1) {
        this.options.logger.debug("agent.iteration.start", { iteration });

        const response = await this.options.llmClient.runStep({
          messages,
          tools: this.options.toolRegistry.list()
        });

        messages.push(response.message);

        const toolCalls = response.message.toolCalls ?? [];
        if (toolCalls.length === 0) {
          const content = response.message.content.trim();
          return content.length > 0 ? content : EMPTY_REPLY_MESSAGE;
        }

        for (const toolCall of toolCalls) {
          const startedAt = Date.now();
          this.options.logger.info("agent.tool.call", {
            iteration,
            toolName: toolCall.name
          });

          const result = await this.options.toolRegistry.execute(toolCall.name, toolCall.arguments);

          this.options.logger.info("agent.tool.result", {
            iteration,
            toolName: toolCall.name,
            durationMs: Date.now() - startedAt
          });

          messages.push({
            role: "tool",
            toolName: toolCall.name,
            content: result
          });
        }
      }

      this.options.logger.warn("agent.iteration.limit", {
        maxIterations: this.options.maxIterations
      });

      return ITERATION_LIMIT_MESSAGE;
    } catch (error) {
      this.options.logger.error("agent.run.error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return LOCAL_ERROR_MESSAGE;
    }
  }
}
