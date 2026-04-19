import { buildSystemPrompt } from "./prompt.js";
import type { AgentMessage } from "./types.js";
import type { LLMClient } from "../llm/client.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryFact, MemoryPromptContext, MemoryStoreLike } from "../memory/store.js";
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
  memoryStore: MemoryStoreLike;
  maxIterations: number;
  logger: Logger;
}

interface ExtractedFact {
  key: string;
  value: string;
}

function normalizeFactLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function formatFactsReply(facts: MemoryFact[]): string {
  if (facts.length === 0) {
    return "I don't have any saved facts about you yet.";
  }

  return `Here's what I know about you:\n${facts
    .map((fact) => `- ${normalizeFactLabel(fact.key)}: ${fact.value}`)
    .join("\n")}`;
}

function extractDurableFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  const favoriteColorMatch = text.match(/\bmy favou?rite colou?r is ([a-z][a-z\s-]{1,40})\b/i);
  if (favoriteColorMatch?.[1]) {
    facts.push({
      key: "favorite_color",
      value: favoriteColorMatch[1].trim().toLowerCase()
    });
  }

  const timezoneMatch = text.match(/\bmy time ?zone is ([A-Za-z_\/-]{3,64})\b/i);
  if (timezoneMatch?.[1]) {
    facts.push({
      key: "timezone",
      value: timezoneMatch[1].trim()
    });
  }

  const nameMatch = text.match(/\bmy name is ([A-Za-z][A-Za-z\s'-]{0,40})\b/i);
  if (nameMatch?.[1]) {
    facts.push({
      key: "name",
      value: nameMatch[1].trim()
    });
  }

  return facts;
}

function isMemoryRecallQuestion(text: string): boolean {
  return /\bwhat (do you know|do you remember) about me\b/i.test(text);
}

function extractFavoriteColorQuestion(text: string): boolean {
  return /\bwhat(?:'s| is) my favou?rite colou?r\b/i.test(text);
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(chatId: string, userInput: string): Promise<string> {
    const trimmedInput = userInput.trim();
    if (trimmedInput.length === 0) {
      return "Please send a text message.";
    }

    try {
      const extractedFacts = extractDurableFacts(trimmedInput);
      for (const fact of extractedFacts) {
        this.options.memoryStore.rememberFact(chatId, fact.key, fact.value);
      }

      const directReply = this.tryDirectReply(chatId, trimmedInput);
      if (directReply) {
        await this.persistTurn(chatId, trimmedInput, directReply);
        return directReply;
      }

      const promptContext = this.options.memoryStore.getPromptContext(chatId, 20);
      const messages = this.buildMessages(promptContext, trimmedInput);

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
          const finalReply = content.length > 0 ? content : EMPTY_REPLY_MESSAGE;
          await this.persistTurn(chatId, trimmedInput, finalReply);
          return finalReply;
        }

        for (const toolCall of toolCalls) {
          const startedAt = Date.now();
          this.options.logger.info("agent.tool.call", {
            iteration,
            toolName: toolCall.name
          });

          const result = await this.options.toolRegistry.execute(toolCall.name, toolCall.arguments, {
            chatId
          });

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

      await this.persistTurn(chatId, trimmedInput, ITERATION_LIMIT_MESSAGE);
      return ITERATION_LIMIT_MESSAGE;
    } catch (error) {
      this.options.logger.error("agent.run.error", {
        error: error instanceof Error ? error.message : String(error)
      });
      await this.persistTurn(chatId, trimmedInput, LOCAL_ERROR_MESSAGE);
      return LOCAL_ERROR_MESSAGE;
    }
  }

  private tryDirectReply(chatId: string, userInput: string): string | undefined {
    const facts = this.options.memoryStore.listFacts(chatId);

    if (isMemoryRecallQuestion(userInput)) {
      return formatFactsReply(facts);
    }

    if (extractFavoriteColorQuestion(userInput)) {
      const favoriteColor = facts.find((fact) => fact.key === "favorite_color");
      if (favoriteColor) {
        return `Your favorite color is ${favoriteColor.value}.`;
      }
      return "I don't have your favorite color saved yet.";
    }

    return undefined;
  }

  private buildMessages(promptContext: MemoryPromptContext, userInput: string): AgentMessage[] {
    return [
      {
        role: "system",
        content: buildSystemPrompt({
          coreFacts: promptContext.coreFacts,
          ...(promptContext.latestSummary ? { latestSummary: promptContext.latestSummary } : {})
        })
      },
      ...promptContext.recentMessages,
      { role: "user", content: userInput }
    ];
  }

  private async persistTurn(chatId: string, userInput: string, assistantReply: string): Promise<void> {
    this.options.memoryStore.saveConversationTurn(chatId, userInput, assistantReply);
    await this.options.memoryStore.compactConversation(chatId, this.options.llmClient);
  }
}
