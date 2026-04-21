import { buildSystemPrompt } from "./prompt.js";
import {
  CANCELLATION_PROGRESS_MESSAGE,
  formatTaskStartedProgressMessage,
  formatToolFinishedProgressMessage,
  formatToolStartProgressMessage,
  ITERATION_LIMIT_PROGRESS_MESSAGE,
  LOCAL_ERROR_PROGRESS_MESSAGE,
  PLANNING_PROGRESS_MESSAGE,
  PREPARING_REPLY_PROGRESS_MESSAGE,
  STEERING_PROGRESS_MESSAGE,
  type AgentRunOptions
} from "./progress.js";
import type { AgentMessage } from "./types.js";
import { RuntimeErrorStore } from "../errors/runtime-error-store.js";
import type { LLMClient } from "../llm/client.js";
import type { TaskRouter } from "../llm/task-router.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryFact, MemoryPromptContext, MemoryStoreLike } from "../memory/store.js";
import type { ApprovalRequest } from "../runtime/contracts.js";
import type { ToolRegistry } from "../tools/registry.js";

export const ITERATION_LIMIT_MESSAGE =
  "I hit my local step limit before finishing. I can only take a small number of tool/model steps per message, so please break this into smaller steps.";
export const LOCAL_ERROR_MESSAGE =
  "I hit a local error before finishing. Send /last_error to inspect the most recent failure.";
export const EMPTY_REPLY_MESSAGE =
  "I couldn't produce a useful reply.";
export const CANCELED_MESSAGE = "Canceled the current task before finishing.";

export interface AgentAttachment {
  kind: "image";
  path: string;
}

export interface AgentRunResult {
  state: "completed" | "waiting_approval" | "failed" | "canceled";
  replyText: string;
  attachments: AgentAttachment[];
  pendingApproval?: ApprovalRequest;
}

interface AgentLoopOptions {
  llmClient: LLMClient;
  taskRouter?: TaskRouter;
  toolRegistry: ToolRegistry;
  memoryStore: MemoryStoreLike;
  maxIterations: number;
  enableModelThinking?: boolean;
  logger: Logger;
  errorStore: RuntimeErrorStore;
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

function isIterationLimitQuestion(text: string): boolean {
  return /\b(safety limit|step limit|iteration limit|max iterations|like iterations)\b/i.test(text);
}

function isSimpleGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 48) {
    return false;
  }

  return /^(?:hi|hello|hey|heya|yo|hiya|good morning|good afternoon|good evening|sup|what'?s up)[!.?]*$/i.test(
    normalized
  );
}

function isSimpleScreenshotRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!/\b(screen ?shot|screenshot)\b/.test(normalized)) {
    return false;
  }

  if (
    /\b(online|internet|web|website|browser|google|bing|search|find|look up|image|photo|picture|pic|download|navigate|site|url)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  if (
    /\b(ocr|find element|wait for element|read the text|text on screen|what(?:'s| is) on screen|open|launch|start|focus|close|describe|then|after|before|while|wait)\b/.test(
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

    if (toolName === "take_active_window_screenshot" && typeof parsed.path === "string") {
      candidatePaths.push(parsed.path);
    }

    if (toolName === "click_element" && typeof parsed.screenshotPath === "string") {
      candidatePaths.push(parsed.screenshotPath);
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

function extractPendingApproval(rawResult: string, chatId: string): ApprovalRequest | undefined {
  try {
    const parsed = JSON.parse(rawResult) as Record<string, unknown>;
    if (parsed.approvalRequired !== true || typeof parsed.approvalId !== "string") {
      return undefined;
    }

    const kind = parsed.kind === "external_action" ? "external_action" : "shell_command";
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : kind === "external_action"
          ? "External action approval"
          : "Shell command approval";
    const details =
      typeof parsed.details === "string" && parsed.details.trim().length > 0
        ? parsed.details.trim()
        : typeof parsed.message === "string"
          ? parsed.message.trim()
          : title;
    const taskId =
      typeof parsed.taskId === "string" && parsed.taskId.trim().length > 0
        ? parsed.taskId.trim()
        : undefined;

    return {
      id: parsed.approvalId,
      kind,
      chatId,
      ...(taskId ? { taskId } : {}),
      title,
      details,
      createdAt: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

function readApprovalMessage(rawResult: string, approvalId: string): string {
  try {
    const parsed = JSON.parse(rawResult) as Record<string, unknown>;
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    // ignore parse failure and use the safe fallback below
  }

  return `Action requires approval. Send /approve ${approvalId} or /deny ${approvalId}.`;
}

function tryParseToolPayload(rawContent: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function clipFallbackText(text: string, maxLength = 500): string {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}...`;
}

function buildToolFallbackReply(messages: AgentMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "tool" || !message.toolName) {
      continue;
    }

    const payload = tryParseToolPayload(message.content);
    if (!payload || payload.ok === false) {
      continue;
    }

    if (message.toolName === "search_web") {
      const results = Array.isArray(payload.results)
        ? payload.results
            .filter(
              (result): result is { title?: unknown; url?: unknown; snippet?: unknown } =>
                Boolean(result) && typeof result === "object"
            )
            .slice(0, 3)
        : [];

      if (results.length > 0) {
        return [
          "I found these web results:",
          ...results.map((result) => {
            const title = typeof result.title === "string" ? result.title.trim() : "Untitled";
            const url = typeof result.url === "string" ? result.url.trim() : "";
            const snippet =
              typeof result.snippet === "string" && result.snippet.trim().length > 0
                ? ` - ${result.snippet.trim()}`
                : "";
            return `- ${title}${url ? ` (${url})` : ""}${snippet}`;
          })
        ].join("\n");
      }
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (text.length > 0) {
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      return [
        title ? `I found this on ${title}:` : "I found this on the page:",
        clipFallbackText(text)
      ].join("\n");
    }
  }

  return undefined;
}

function formatSteeringMessage(steeringMessages: string[]): string {
  return [
    "Live steering for the current task.",
    "Treat this as updated guidance for the same task, not as a separate request.",
    steeringMessages.map((message) => `- ${message}`).join("\n")
  ].join("\n\n");
}

function mergeSteeringIntoUserInput(userInput: string, steeringMessages: string[]): string {
  if (steeringMessages.length === 0) {
    return userInput;
  }

  return [
    userInput,
    "Additional steering received while the task was running:",
    steeringMessages.map((message) => `- ${message}`).join("\n")
  ].join("\n\n");
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(
    chatId: string,
    userInput: string,
    runOptions: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    const trimmedInput = userInput.trim();
    if (trimmedInput.length === 0) {
      return {
        state: "completed",
        replyText: "Please send a text message.",
        attachments: []
      };
    }

    const attachments: AgentAttachment[] = [];
    const attachmentPaths = new Set<string>();
    const appliedSteeringMessages: string[] = [];

    try {
      await this.emitProgress(runOptions, formatTaskStartedProgressMessage(trimmedInput));
      const canceledAtStart = await this.finishIfCanceled(
        chatId,
        trimmedInput,
        appliedSteeringMessages,
        attachments,
        runOptions
      );
      if (canceledAtStart) {
        return canceledAtStart;
      }

      const extractedFacts = extractDurableFacts(trimmedInput);
      for (const fact of extractedFacts) {
        this.options.memoryStore.rememberFact(chatId, fact.key, fact.value);
      }

      const directReply = this.tryDirectReply(chatId, trimmedInput);
      if (directReply) {
        const canceledBeforeDirectReply = await this.finishIfCanceled(
          chatId,
          trimmedInput,
          appliedSteeringMessages,
          attachments,
          runOptions
        );
        if (canceledBeforeDirectReply) {
          return canceledBeforeDirectReply;
        }
        await this.emitProgress(runOptions, PREPARING_REPLY_PROGRESS_MESSAGE);
        await this.persistTurn(chatId, trimmedInput, directReply);
        return {
          state: "completed",
          replyText: directReply,
          attachments
        };
      }

      const directActionResult = await this.tryDirectAction(chatId, trimmedInput, runOptions);
      if (directActionResult) {
        const canceledAfterDirectAction = await this.finishIfCanceled(
          chatId,
          trimmedInput,
          appliedSteeringMessages,
          directActionResult.attachments,
          runOptions
        );
        if (canceledAfterDirectAction) {
          return canceledAfterDirectAction;
        }
        await this.emitProgress(runOptions, PREPARING_REPLY_PROGRESS_MESSAGE);
        await this.persistTurn(chatId, trimmedInput, directActionResult.replyText);
        return directActionResult;
      }

      const promptContext = this.options.memoryStore.getPromptContext(chatId, 20);
      const tools = this.options.toolRegistry.list();
      const routedTask = await this.options.taskRouter?.routeTask({
        userInput: trimmedInput,
        promptContext,
        tools
      });
      const llmClient = routedTask?.llmClient ?? this.options.llmClient;
      const llmUserInput = routedTask?.preparedUserInput ?? trimmedInput;
      const messages = this.buildMessages(promptContext, llmUserInput);
      await this.emitProgress(runOptions, PLANNING_PROGRESS_MESSAGE);

      for (let iteration = 1; iteration <= this.options.maxIterations; iteration += 1) {
        this.options.logger.debug("agent.iteration.start", { iteration });

        const canceledBeforeModel = await this.finishIfCanceled(
          chatId,
          trimmedInput,
          appliedSteeringMessages,
          attachments,
          runOptions
        );
        if (canceledBeforeModel) {
          return canceledBeforeModel;
        }

        await this.applyPendingSteering(messages, runOptions, appliedSteeringMessages);

        const response = await llmClient.runStep({
          messages,
          tools
        });

        const canceledAfterModel = await this.finishIfCanceled(
          chatId,
          trimmedInput,
          appliedSteeringMessages,
          attachments,
          runOptions
        );
        if (canceledAfterModel) {
          return canceledAfterModel;
        }

        const steeringAppliedAfterResponse = await this.applyPendingSteering(
          messages,
          runOptions,
          appliedSteeringMessages
        );
        if (steeringAppliedAfterResponse) {
          await this.emitProgress(runOptions, PLANNING_PROGRESS_MESSAGE);
          continue;
        }

        messages.push(response.message);

        const toolCalls = response.message.toolCalls ?? [];
        if (toolCalls.length === 0) {
          const content = response.message.content.trim();
          const finalReply =
            content.length > 0
              ? content
              : buildToolFallbackReply(messages) ?? EMPTY_REPLY_MESSAGE;
          const canceledBeforeReply = await this.finishIfCanceled(
            chatId,
            trimmedInput,
            appliedSteeringMessages,
            attachments,
            runOptions
          );
          if (canceledBeforeReply) {
            return canceledBeforeReply;
          }
          await this.emitProgress(runOptions, PREPARING_REPLY_PROGRESS_MESSAGE);
          await this.persistTurn(
            chatId,
            mergeSteeringIntoUserInput(trimmedInput, appliedSteeringMessages),
            finalReply
          );
          return {
            state: "completed",
            replyText: finalReply,
            attachments
          };
        }

        for (const toolCall of toolCalls) {
          const canceledBeforeTool = await this.finishIfCanceled(
            chatId,
            trimmedInput,
            appliedSteeringMessages,
            attachments,
            runOptions
          );
          if (canceledBeforeTool) {
            return canceledBeforeTool;
          }

          const startedAt = Date.now();
          await this.emitProgress(
            runOptions,
            formatToolStartProgressMessage(toolCall.name, toolCall.arguments)
          );
          this.options.logger.info("agent.tool.call", {
            iteration,
            toolName: toolCall.name
          });

          const result = await this.options.toolRegistry.execute(toolCall.name, toolCall.arguments, {
            chatId,
            ...(runOptions.taskId ? { taskId: runOptions.taskId } : {}),
            ...(runOptions.shouldCancel ? { shouldCancel: runOptions.shouldCancel } : {})
          });

          this.options.logger.info("agent.tool.result", {
            iteration,
            toolName: toolCall.name,
            durationMs: Date.now() - startedAt
          });
          await this.emitProgress(
            runOptions,
            formatToolFinishedProgressMessage(toolCall.name, toolCall.arguments, result)
          );

          attachments.push(...extractToolAttachments(toolCall.name, result, attachmentPaths));
          const pendingApproval = extractPendingApproval(result, chatId);

          const canceledAfterTool = await this.finishIfCanceled(
            chatId,
            trimmedInput,
            appliedSteeringMessages,
            attachments,
            runOptions
          );
          if (canceledAfterTool) {
            return canceledAfterTool;
          }

          if (pendingApproval) {
            const replyText = readApprovalMessage(result, pendingApproval.id);
            await this.emitProgress(runOptions, PREPARING_REPLY_PROGRESS_MESSAGE);
            await this.persistTurn(
              chatId,
              mergeSteeringIntoUserInput(trimmedInput, appliedSteeringMessages),
              replyText
            );
            return {
              state: "waiting_approval",
              replyText,
              attachments,
              pendingApproval
            };
          }

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

      await this.emitProgress(runOptions, ITERATION_LIMIT_PROGRESS_MESSAGE);
      await this.persistTurn(
        chatId,
        mergeSteeringIntoUserInput(trimmedInput, appliedSteeringMessages),
        ITERATION_LIMIT_MESSAGE
      );
      return {
        state: "completed",
        replyText: ITERATION_LIMIT_MESSAGE,
        attachments
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.logger.error("agent.run.error", {
        error: errorMessage
      });
      this.options.errorStore.record(chatId, "agent.run", errorMessage);
      await this.emitProgress(runOptions, LOCAL_ERROR_PROGRESS_MESSAGE);
      await this.persistTurn(
        chatId,
        mergeSteeringIntoUserInput(trimmedInput, appliedSteeringMessages),
        LOCAL_ERROR_MESSAGE
      );
      return {
        state: "failed",
        replyText: LOCAL_ERROR_MESSAGE,
        attachments
      };
    }
  }

  private tryDirectReply(chatId: string, userInput: string): string | undefined {
    const facts = this.options.memoryStore.listFacts(chatId);

    if (isSimpleGreeting(userInput)) {
      return "Hello! How can I assist you today?";
    }

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

    if (isIterationLimitQuestion(userInput)) {
      return `My local limit here is mainly the agent step limit. I can take up to ${this.options.maxIterations} tool/model steps in one message before I stop and ask you to break the task into smaller steps.`;
    }

    return undefined;
  }

  private async tryDirectAction(
    chatId: string,
    userInput: string,
    runOptions: AgentRunOptions
  ): Promise<AgentRunResult | undefined> {
    if (isSimpleScreenshotRequest(userInput)) {
      return this.takeDirectScreenshot(chatId, runOptions);
    }

    return undefined;
  }

  private async takeDirectScreenshot(
    chatId: string,
    runOptions: AgentRunOptions
  ): Promise<AgentRunResult> {
    await this.emitProgress(runOptions, formatToolStartProgressMessage("take_screenshot", {}));
    const rawResult = await this.options.toolRegistry.execute("take_screenshot", {}, {
      chatId,
      ...(runOptions.taskId ? { taskId: runOptions.taskId } : {})
    });
    await this.emitProgress(
      runOptions,
      formatToolFinishedProgressMessage("take_screenshot", {}, rawResult)
    );
    const attachmentPaths = new Set<string>();
    const attachments = extractToolAttachments("take_screenshot", rawResult, attachmentPaths);

    try {
      const parsed = JSON.parse(rawResult) as Record<string, unknown>;
      if (parsed.ok === false) {
        return {
          state: "failed",
          replyText:
            typeof parsed.error === "string"
              ? `I couldn't take the screenshot: ${parsed.error}`
              : LOCAL_ERROR_MESSAGE,
          attachments: []
        };
      }

      if (attachments.length > 0) {
        return {
          state: "completed",
          replyText: "Attached the screenshot.",
          attachments
        };
      }
    } catch {
      // fall through to a safe fallback reply below
    }

    return {
      state: "completed",
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
          ...(this.options.enableModelThinking !== undefined
            ? { enableThinking: this.options.enableModelThinking }
            : {}),
          ...(promptContext.latestSummary ? { latestSummary: promptContext.latestSummary } : {})
        })
      },
      ...promptContext.recentMessages,
      { role: "user", content: userInput }
    ];
  }

  private async applyPendingSteering(
    messages: AgentMessage[],
    runOptions: AgentRunOptions,
    appliedSteeringMessages: string[]
  ): Promise<boolean> {
    const steeringMessages = await this.consumeSteeringMessages(runOptions);
    if (steeringMessages.length === 0) {
      return false;
    }

    appliedSteeringMessages.push(...steeringMessages);
    messages.push({
      role: "user",
      content: formatSteeringMessage(steeringMessages)
    });
    await this.emitProgress(runOptions, STEERING_PROGRESS_MESSAGE);
    return true;
  }

  private async consumeSteeringMessages(runOptions: AgentRunOptions): Promise<string[]> {
    const steeringMessages = await runOptions.consumeSteeringMessages?.();
    if (!steeringMessages) {
      return [];
    }

    return steeringMessages
      .map((message) => message.trim())
      .filter((message) => message.length > 0);
  }

  private async emitProgress(runOptions: AgentRunOptions, message: string): Promise<void> {
    if (message.trim().length === 0) {
      return;
    }

    await runOptions.onProgress?.(message);
  }

  private async finishIfCanceled(
    chatId: string,
    userInput: string,
    appliedSteeringMessages: string[],
    attachments: AgentAttachment[],
    runOptions: AgentRunOptions
  ): Promise<AgentRunResult | undefined> {
    if (!(await this.shouldCancel(runOptions))) {
      return undefined;
    }

    await this.emitProgress(runOptions, CANCELLATION_PROGRESS_MESSAGE);
    await this.persistTurn(
      chatId,
      mergeSteeringIntoUserInput(userInput, appliedSteeringMessages),
      CANCELED_MESSAGE
    );
    return {
      state: "canceled",
      replyText: CANCELED_MESSAGE,
      attachments
    };
  }

  private async shouldCancel(runOptions: AgentRunOptions): Promise<boolean> {
    const result = await runOptions.shouldCancel?.();
    return result === true;
  }

  private async persistTurn(chatId: string, userInput: string, assistantReply: string): Promise<void> {
    this.options.memoryStore.saveConversationTurn(chatId, userInput, assistantReply);

    try {
      await this.options.memoryStore.compactConversation(chatId, this.options.llmClient);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.logger.warn("memory.compaction.failed", {
        chatId,
        error: errorMessage
      });
      this.options.errorStore.record(chatId, "memory.compaction", errorMessage);
    }
  }
}
