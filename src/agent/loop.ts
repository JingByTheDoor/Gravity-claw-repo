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

export interface AgentAttachment {
  kind: "image";
  path: string;
}

export interface AgentRunResult {
  replyText: string;
  attachments: AgentAttachment[];
}

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

function isSimpleScreenshotRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!/\b(screen ?shot|screenshot)\b/.test(normalized)) {
    return false;
  }

  if (
    /\b(ocr|find element|wait for element|read the text|text on screen|what(?:'s| is) on screen)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  return /\b(take|capture|grab|send|upload|attach|show)\b/.test(normalized);
}

function extractToolAttachments(
  toolName: string,
  rawResult: string,
  existingPaths: Set<string>
): AgentAttachment[] {
  try {
    const parsed = JSON.parse(rawResult) as Record<string, unknown>;
    const candidatePaths: string[] = [];

    if (toolName === "take_screenshot" && typeof parsed.path === "string") {
      candidatePaths.push(parsed.path);
    }

    if (
      (toolName === "ocr_read" || toolName === "find_element" || toolName === "wait_for_element") &&
      typeof parsed.screenshotPath === "string"
    ) {
      candidatePaths.push(parsed.screenshotPath);
    }

    return candidatePaths.flatMap((candidatePath) => {
      const trimmedPath = candidatePath.trim();
      if (trimmedPath.length === 0 || existingPaths.has(trimmedPath)) {
        return [];
      }

      if (!/\.(png|jpe?g|webp|bmp)$/i.test(trimmedPath)) {
        return [];
      }

      existingPaths.add(trimmedPath);
      return [{
        kind: "image" as const,
        path: trimmedPath
      }];
    });
  } catch {
    return [];
  }
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(chatId: string, userInput: string): Promise<AgentRunResult> {
    const trimmedInput = userInput.trim();
    if (trimmedInput.length === 0) {
      return {
        replyText: "Please send a text message.",
        attachments: []
      };
    }

    const attachments: AgentAttachment[] = [];
    const attachmentPaths = new Set<string>();

    try {
      const extractedFacts = extractDurableFacts(trimmedInput);
      for (const fact of extractedFacts) {
        this.options.memoryStore.rememberFact(chatId, fact.key, fact.value);
      }

      const directReply = this.tryDirectReply(chatId, trimmedInput);
      if (directReply) {
        await this.persistTurn(chatId, trimmedInput, directReply);
        return {
          replyText: directReply,
          attachments
        };
      }

      const directActionResult = await this.tryDirectAction(chatId, trimmedInput);
      if (directActionResult) {
        await this.persistTurn(chatId, trimmedInput, directActionResult.replyText);
        return directActionResult;
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
          return {
            replyText: finalReply,
            attachments
          };
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

          attachments.push(...extractToolAttachments(toolCall.name, result, attachmentPaths));

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
      return {
        replyText: ITERATION_LIMIT_MESSAGE,
        attachments
      };
    } catch (error) {
      this.options.logger.error("agent.run.error", {
        error: error instanceof Error ? error.message : String(error)
      });
      await this.persistTurn(chatId, trimmedInput, LOCAL_ERROR_MESSAGE);
      return {
        replyText: LOCAL_ERROR_MESSAGE,
        attachments
      };
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

  private async tryDirectAction(
    chatId: string,
    userInput: string
  ): Promise<AgentRunResult | undefined> {
    if (isSimpleScreenshotRequest(userInput)) {
      return this.takeDirectScreenshot(chatId);
    }

    return undefined;
  }

  private async takeDirectScreenshot(chatId: string): Promise<AgentRunResult> {
    const rawResult = await this.options.toolRegistry.execute("take_screenshot", {}, { chatId });
    const attachmentPaths = new Set<string>();
    const attachments = extractToolAttachments("take_screenshot", rawResult, attachmentPaths);

    try {
      const parsed = JSON.parse(rawResult) as Record<string, unknown>;
      if (parsed.ok === false) {
        return {
          replyText:
            typeof parsed.error === "string"
              ? `I couldn't take the screenshot: ${parsed.error}`
              : LOCAL_ERROR_MESSAGE,
          attachments: []
        };
      }

      if (attachments.length > 0) {
        return {
          replyText: "Attached the screenshot.",
          attachments
        };
      }
    } catch {
      // fall through to a safe fallback reply below
    }

    return {
      replyText: "I took the screenshot, but I couldn't attach it in the reply.",
      attachments
    };
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
