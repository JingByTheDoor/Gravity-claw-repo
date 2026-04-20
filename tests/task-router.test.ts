import { describe, expect, it, vi } from "vitest";
import type { LLMRunResponse, ToolDefinition } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import { createLogger } from "../src/logging/logger.js";
import { FastFirstTaskRouter } from "../src/llm/task-router.js";

const dummyTools: ToolDefinition[] = [{
  name: "run_shell_command",
  description: "Runs a shell command.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  execute: vi.fn(async () => '{"ok":true}')
}];

describe("FastFirstTaskRouter", () => {
  it("keeps simple tasks on the fast model", async () => {
    const fastClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi
        .fn()
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: '{"route":"fast","rewritten_prompt":"","reason":"simple"}'
          }
        } satisfies LLMRunResponse)
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Primary client should not be selected");
      })
    };

    const router = new FastFirstTaskRouter({
      fastClient,
      primaryClient,
      fastModel: "qwen2.5:1.5b",
      primaryModel: "qwen2.5:7b",
      logger: createLogger("error")
    });

    const result = await router.routeTask({
      userInput: "what time is it",
      promptContext: {
        coreFacts: [],
        recentMessages: []
      },
      tools: dummyTools
    });

    expect(result.route).toBe("fast");
    expect(result.preparedUserInput).toBe("what time is it");
    expect(result.llmClient).toBe(fastClient);
  });

  it("rewrites and escalates harder tasks to the primary model", async () => {
    const fastClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content:
            '{"route":"primary","rewritten_prompt":"Fix the failing build, inspect the error output, and explain the root cause.","reason":"coding_task"}'
        }
      }))
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Primary client should not be called during routing");
      })
    };

    const router = new FastFirstTaskRouter({
      fastClient,
      primaryClient,
      fastModel: "qwen2.5:1.5b",
      primaryModel: "qwen2.5:7b",
      logger: createLogger("error")
    });

    const result = await router.routeTask({
      userInput: "fix the broken build and tell me why",
      promptContext: {
        coreFacts: [],
        recentMessages: []
      },
      tools: dummyTools
    });

    expect(result.route).toBe("primary");
    expect(result.llmClient).toBe(primaryClient);
    expect(result.preparedUserInput).toContain("Cleaned task:");
    expect(result.preparedUserInput).toContain("Fix the failing build");
    expect(result.preparedUserInput).toContain("Original user message:");
  });

  it("falls back to heuristics when the router response is invalid", async () => {
    const fastClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "primary because this looks hard"
        }
      }))
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Primary client should not be called during routing");
      })
    };

    const router = new FastFirstTaskRouter({
      fastClient,
      primaryClient,
      fastModel: "qwen2.5:1.5b",
      primaryModel: "qwen2.5:7b",
      logger: createLogger("error")
    });

    const result = await router.routeTask({
      userInput: "debug this failing TypeScript build and patch the code",
      promptContext: {
        coreFacts: [],
        recentMessages: []
      },
      tools: dummyTools
    });

    expect(result.route).toBe("primary");
    expect(result.llmClient).toBe(primaryClient);
    expect(result.reason).toBe("heuristic_fallback");
  });

  it("overrides a fast routing decision when the message is an actual task", async () => {
    const fastClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: '{"route":"fast","rewritten_prompt":"","reason":"short_request"}'
        }
      }))
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Primary client should not be called during routing");
      })
    };

    const router = new FastFirstTaskRouter({
      fastClient,
      primaryClient,
      fastModel: "qwen2.5:1.5b",
      primaryModel: "qwen2.5:7b",
      logger: createLogger("error")
    });

    const result = await router.routeTask({
      userInput: "could you draft a short email to my teacher about being absent tomorrow",
      promptContext: {
        coreFacts: [],
        recentMessages: []
      },
      tools: dummyTools
    });

    expect(result.route).toBe("primary");
    expect(result.llmClient).toBe(primaryClient);
    expect(result.reason).toBe("task_bias_override");
    expect(result.preparedUserInput).toBe(
      "could you draft a short email to my teacher about being absent tomorrow"
    );
  });

  it("keeps plain question answering on the fast model", async () => {
    const fastClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: '{"route":"fast","rewritten_prompt":"","reason":"plain_qa"}'
        }
      }))
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Primary client should not be selected");
      })
    };

    const router = new FastFirstTaskRouter({
      fastClient,
      primaryClient,
      fastModel: "qwen2.5:1.5b",
      primaryModel: "qwen2.5:7b",
      logger: createLogger("error")
    });

    const result = await router.routeTask({
      userInput: "why is the sky blue",
      promptContext: {
        coreFacts: [],
        recentMessages: []
      },
      tools: dummyTools
    });

    expect(result.route).toBe("fast");
    expect(result.llmClient).toBe(fastClient);
    expect(result.reason).toBe("plain_qa");
  });
});
