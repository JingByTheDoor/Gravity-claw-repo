import type { AgentMessage, ToolDefinition } from "../agent/types.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryPromptContext } from "../memory/store.js";
import type { LLMClient } from "./client.js";

const ROUTER_MESSAGE_LIMIT = 6;
const ROUTER_TEXT_LIMIT = 280;

type TaskRoute = "fast" | "primary";

interface RoutingDecision {
  route: TaskRoute;
  rewritten_prompt?: string;
  reason?: string;
}

export interface TaskRouteRequest {
  userInput: string;
  promptContext: MemoryPromptContext;
  tools: ToolDefinition[];
}

export interface TaskRouteResult {
  llmClient: LLMClient;
  preparedUserInput: string;
  route: TaskRoute;
  reason: string;
}

export interface TaskRouter {
  routeTask(request: TaskRouteRequest): Promise<TaskRouteResult>;
}

interface FastFirstTaskRouterOptions {
  fastClient: LLMClient;
  primaryClient: LLMClient;
  fastModel: string;
  primaryModel: string;
  logger: Logger;
}

function truncateText(text: string, maxLength = ROUTER_TEXT_LIMIT): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function summarizeMessages(messages: AgentMessage[]): string {
  if (messages.length === 0) {
    return "None";
  }

  return messages
    .slice(-ROUTER_MESSAGE_LIMIT)
    .map((message, index) => `${index + 1}. ${message.role}: ${truncateText(message.content)}`)
    .join("\n");
}

function summarizeFacts(promptContext: MemoryPromptContext): string {
  if (promptContext.coreFacts.length === 0) {
    return "None";
  }

  return promptContext.coreFacts
    .slice(0, 8)
    .map((fact) => `${fact.key}=${truncateText(fact.value, 80)}`)
    .join(", ");
}

function normalizeRoute(value: unknown): TaskRoute | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "fast" || normalized === "primary") {
    return normalized;
  }

  return undefined;
}

function parseRoutingDecision(rawContent: string): RoutingDecision | undefined {
  const trimmedContent = rawContent.trim();
  const candidates = [trimmedContent];
  const jsonStart = trimmedContent.indexOf("{");
  const jsonEnd = trimmedContent.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    candidates.push(trimmedContent.slice(jsonStart, jsonEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const route = normalizeRoute(parsed.route);
      if (!route) {
        continue;
      }

      return {
        route,
        ...(typeof parsed.rewritten_prompt === "string"
          ? { rewritten_prompt: parsed.rewritten_prompt.trim() }
          : {}),
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason.trim() } : {})
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function looksComplexTask(request: TaskRouteRequest): boolean {
  const normalizedInput = request.userInput.trim();
  if (normalizedInput.length >= 220) {
    return true;
  }

  if (request.promptContext.recentMessages.length >= 8) {
    return true;
  }

  return /```|`[^`]+`|\b(debug|fix|bug|error|stack trace|refactor|rewrite|implement|build|test|code|typescript|javascript|python|sql|regex|shell|terminal|command|script|file|folder|path|read|write|edit|patch|screenshot|ocr|click|wait|open|launch|focus|close|first|then|after|before|analy[sz]e|compare|investigate|why)\b/i.test(
    normalizedInput
  );
}

function buildPrimaryPrompt(originalInput: string, rewrittenPrompt?: string): string {
  const trimmedOriginalInput = originalInput.trim();
  const trimmedRewrite = rewrittenPrompt?.trim();

  if (!trimmedRewrite || trimmedRewrite.toLowerCase() === trimmedOriginalInput.toLowerCase()) {
    return trimmedOriginalInput;
  }

  return [
    "The fast local router escalated this task to the stronger model.",
    "Use the cleaned task below, but preserve any useful nuance from the original wording.",
    "",
    "Cleaned task:",
    trimmedRewrite,
    "",
    "Original user message:",
    trimmedOriginalInput
  ].join("\n");
}

export class FastFirstTaskRouter implements TaskRouter {
  constructor(private readonly options: FastFirstTaskRouterOptions) {}

  async routeTask(request: TaskRouteRequest): Promise<TaskRouteResult> {
    if (this.options.fastModel === this.options.primaryModel) {
      return {
        llmClient: this.options.primaryClient,
        preparedUserInput: request.userInput,
        route: "primary",
        reason: "fast_model_matches_primary"
      };
    }

    let decision: RoutingDecision | undefined;

    try {
      const response = await this.options.fastClient.runStep({
        messages: this.buildRoutingMessages(request),
        tools: []
      });
      decision = parseRoutingDecision(response.message.content);
      if (!decision) {
        throw new Error("Router returned an invalid decision payload.");
      }
    } catch (error) {
      const fallbackRoute: TaskRoute = looksComplexTask(request) ? "primary" : "fast";
      decision = {
        route: fallbackRoute,
        ...(fallbackRoute === "primary" ? { rewritten_prompt: request.userInput } : {}),
        reason: "heuristic_fallback"
      };

      this.options.logger.warn("llm.route.fallback", {
        fastModel: this.options.fastModel,
        primaryModel: this.options.primaryModel,
        fallbackRoute,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const preparedUserInput =
      decision.route === "primary"
        ? buildPrimaryPrompt(request.userInput, decision.rewritten_prompt)
        : request.userInput;
    const llmClient =
      decision.route === "primary" ? this.options.primaryClient : this.options.fastClient;

    this.options.logger.info("llm.route.selected", {
      route: decision.route,
      fastModel: this.options.fastModel,
      primaryModel: this.options.primaryModel,
      reason: decision.reason ?? "unspecified"
    });

    return {
      llmClient,
      preparedUserInput,
      route: decision.route,
      reason: decision.reason ?? "unspecified"
    };
  }

  private buildRoutingMessages(request: TaskRouteRequest): AgentMessage[] {
    return [
      {
        role: "system",
        content: [
          "You are a strict routing model for a local AI agent.",
          'Return JSON only with this schema: {"route":"fast"|"primary","rewritten_prompt":"string","reason":"string"}.',
          "Choose fast only for short, direct, low-risk tasks that a small local model can handle well.",
          "Choose primary for coding, debugging, files, shell work, screenshots, OCR, multi-step actions, longer context, ambiguous requests, or anything that needs careful reasoning.",
          "If you choose primary, rewrite the task into a cleaner prompt that preserves the user's intent and constraints.",
          "If you choose fast, set rewritten_prompt to an empty string."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_input: request.userInput,
            recent_context: summarizeMessages(request.promptContext.recentMessages),
            durable_facts: summarizeFacts(request.promptContext),
            latest_summary: request.promptContext.latestSummary
              ? truncateText(request.promptContext.latestSummary, ROUTER_TEXT_LIMIT)
              : "None",
            available_tools: request.tools.map((tool) => tool.name)
          },
          null,
          2
        )
      }
    ];
  }
}
