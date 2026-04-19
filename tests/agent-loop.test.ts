import { describe, expect, it, vi } from "vitest";
import { AgentLoop, ITERATION_LIMIT_MESSAGE } from "../src/agent/loop.js";
import type { LLMRunResponse } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import type { MemoryStoreLike } from "../src/memory/store.js";
import { createLogger } from "../src/logging/logger.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";

function createMemoryStoreStub(): MemoryStoreLike {
  return {
    getPromptContext: vi.fn(() => ({
      coreFacts: [],
      recentMessages: []
    })),
    rememberFact: vi.fn((_chatId: string, key: string, value: string) => ({ key, value })),
    listFacts: vi.fn(() => []),
    saveConversationTurn: vi.fn(() => undefined),
    compactConversation: vi.fn(async () => undefined),
    resetConversation: vi.fn(() => undefined)
  };
}

describe("AgentLoop", () => {
  it("returns a plain text assistant response", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "Hello from local Ollama."
        }
      }))
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("chat-1", "hello")).resolves.toEqual({
      replyText: "Hello from local Ollama.",
      attachments: []
    });
  });

  it("handles a tool roundtrip", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi
        .fn()
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "get_current_time", arguments: { timezone: "UTC" } }]
          }
        } satisfies LLMRunResponse)
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "It is currently UTC time."
          }
        } satisfies LLMRunResponse)
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("chat-1", "What time is it in UTC?")).resolves.toEqual({
      replyText: "It is currently UTC time.",
      attachments: []
    });
    expect(llmClient.runStep).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a tool error payload", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi
        .fn()
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              { name: "get_current_time", arguments: { timezone: "Mars/OlympusMons" } }
            ]
          }
        } satisfies LLMRunResponse)
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "That timezone is invalid."
          }
        } satisfies LLMRunResponse)
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error")
    });

    const reply = await loop.run("chat-1", "Time on Mars?");
    expect(reply.replyText).toBe("That timezone is invalid.");
    expect(reply.attachments).toEqual([]);

    const secondCall = vi.mocked(llmClient.runStep).mock.calls[1]?.[0];
    const toolMessage = secondCall?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toMatch(/"ok":false/);
  });

  it("returns the iteration limit fallback", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ name: "get_current_time", arguments: { timezone: "UTC" } }]
        }
      }))
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 2,
      logger: createLogger("error")
    });

    await expect(loop.run("chat-1", "loop")).resolves.toEqual({
      replyText: ITERATION_LIMIT_MESSAGE,
      attachments: []
    });
  });

  it("answers memory recall questions directly from stored facts", async () => {
    const memoryStore = createMemoryStoreStub();
    vi.mocked(memoryStore.listFacts).mockReturnValue([
      { key: "favorite_color", value: "orange" },
      { key: "timezone", value: "America/Vancouver" }
    ]);

    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("LLM should not run for direct recall");
      })
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore,
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("chat-1", "what do you know about me?")).resolves.toEqual({
      replyText: "Here's what I know about you:\n- favorite color: orange\n- timezone: America/Vancouver",
      attachments: []
    });
  });

  it("stores obvious durable facts even without a tool call", async () => {
    const memoryStore = createMemoryStoreStub();
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "I will remember that."
        }
      }))
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore,
      maxIterations: 4,
      logger: createLogger("error")
    });

    await loop.run("chat-1", "My favourite colour is orange");
    expect(memoryStore.rememberFact).toHaveBeenCalledWith("chat-1", "favorite_color", "orange");
  });

  it("collects screenshot attachments from screenshot tools", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi
        .fn()
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ name: "take_screenshot", arguments: {} }]
          }
        } satisfies LLMRunResponse)
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "Here is the screenshot."
          }
        } satisfies LLMRunResponse)
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([{
        name: "take_screenshot",
        description: "test screenshot",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        execute: vi.fn(async () =>
          JSON.stringify({
            ok: true,
            path: "C:\\temp\\screen.png"
          })
        )
      }]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("chat-1", "take a screenshot")).resolves.toEqual({
      replyText: "Here is the screenshot.",
      attachments: [{
        kind: "image",
        path: "C:\\temp\\screen.png"
      }]
    });
  });
});
