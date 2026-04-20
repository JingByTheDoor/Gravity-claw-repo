import { describe, expect, it, vi } from "vitest";
import { AgentLoop, CANCELED_MESSAGE, ITERATION_LIMIT_MESSAGE } from "../src/agent/loop.js";
import { RuntimeErrorStore } from "../src/errors/runtime-error-store.js";
import type { LLMRunResponse } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import type { TaskRouter } from "../src/llm/task-router.js";
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "tell me something useful")).resolves.toEqual({
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "What time is it in UTC?")).resolves.toEqual({
      replyText: "It is currently UTC time.",
      attachments: []
    });
    expect(llmClient.runStep).toHaveBeenCalledTimes(2);
  });

  it("emits status updates while it works", async () => {
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    const progressMessages: string[] = [];

    await loop.run("chat-1", "What time is it in UTC?", {
      onProgress: async (message) => {
        progressMessages.push(message);
      }
    });

    expect(progressMessages).toEqual([
      'Status: proceeding with "What time is it in UTC?"',
      "Status: planning the next step",
      "Status: checking the current time",
      "Status: checked the current time",
      "Status: preparing the reply"
    ]);
  });

  it("treats live steering as guidance for the current task", async () => {
    const memoryStore = createMemoryStoreStub();
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi
        .fn()
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "Here is a long detailed answer."
          }
        } satisfies LLMRunResponse)
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "Short answer."
          }
        } satisfies LLMRunResponse)
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore,
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    const steeringBatches: string[][] = [[], ["Keep it short."], [], []];
    const consumeSteeringMessages = vi.fn(() => steeringBatches.shift() ?? []);

    await expect(loop.run("chat-1", "Explain the plan", { consumeSteeringMessages })).resolves.toEqual({
      replyText: "Short answer.",
      attachments: []
    });

    expect(llmClient.runStep).toHaveBeenCalledTimes(2);

    const secondCall = vi.mocked(llmClient.runStep).mock.calls[1]?.[0];
    expect(secondCall?.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Keep it short.")
      })
    );
    expect(
      secondCall?.messages.some(
        (message) => message.role === "assistant" && message.content === "Here is a long detailed answer."
      )
    ).toBe(false);
    expect(memoryStore.saveConversationTurn).toHaveBeenCalledWith(
      "chat-1",
      expect.stringContaining("Keep it short."),
      "Short answer."
    );
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "what do you know about me?")).resolves.toEqual({
      replyText: "Here's what I know about you:\n- favorite color: orange\n- timezone: America/Vancouver",
      attachments: []
    });
  });

  it("answers simple greetings directly without waiting for the model", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("LLM should not run for direct greeting replies");
      })
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "hi")).resolves.toEqual({
      replyText: "Hello! How can I assist you today?",
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await loop.run("chat-1", "My favourite colour is orange");
    expect(memoryStore.rememberFact).toHaveBeenCalledWith("chat-1", "favorite_color", "orange");
  });

  it("answers iteration limit questions truthfully", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("LLM should not run for direct limit answers");
      })
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "like iterations?")).resolves.toEqual({
      replyText:
        "My local limit here is mainly the agent step limit. I can take up to 4 tool/model steps in one message before I stop and ask you to break the task into smaller steps.",
      attachments: []
    });
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
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "take a screenshot")).resolves.toEqual({
      replyText: "Attached the screenshot.",
      attachments: [{
        kind: "image",
        path: "C:\\temp\\screen.png"
      }]
    });
  });

  it("takes simple screenshot requests directly without waiting for the model", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("LLM should not run for direct screenshot requests");
      })
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
            path: "C:\\temp\\direct-shot.png"
          })
        )
      }]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(
      loop.run("chat-1", "take a screenshot right now and upload it into telegram as your message")
    ).resolves.toEqual({
      replyText: "Attached the screenshot.",
      attachments: [{
        kind: "image",
        path: "C:\\temp\\direct-shot.png"
      }]
    });
  });

  it("does not shortcut complex multi-step screenshot requests", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "Working on the full workflow."
        }
      }))
    };

    const screenshotTool = {
      name: "take_screenshot",
      description: "test screenshot",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false
      },
      execute: vi.fn(async () =>
        JSON.stringify({
          ok: true,
          path: "C:\\temp\\direct-shot.png"
        })
      )
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([screenshotTool]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(
      loop.run("chat-1", "open figma wait for it to load then take a full screen screenshot and describe it")
    ).resolves.toEqual({
      replyText: "Working on the full workflow.",
      attachments: []
    });

    expect(llmClient.runStep).toHaveBeenCalledTimes(1);
    expect(screenshotTool.execute).not.toHaveBeenCalled();
  });

  it("does not shortcut screenshot requests that also require finding something online", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "I'll handle the broader task instead of taking the current screen immediately."
        }
      }))
    };

    const screenshotTool = {
      name: "take_screenshot",
      description: "test screenshot",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false
      },
      execute: vi.fn(async () =>
        JSON.stringify({
          ok: true,
          path: "C:\\temp\\wrong-shot.png"
        })
      )
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([screenshotTool]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(
      loop.run("chat-1", "could you find an image of a zebra online and take a screenshot of it")
    ).resolves.toEqual({
      replyText: "I'll handle the broader task instead of taking the current screen immediately.",
      attachments: []
    });

    expect(llmClient.runStep).toHaveBeenCalledTimes(1);
    expect(screenshotTool.execute).not.toHaveBeenCalled();
  });

  it("stores the last local error for later inspection", async () => {
    const errorStore = new RuntimeErrorStore();
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Vision pipeline crashed");
      })
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore
    });

    await expect(loop.run("chat-1", "do something")).resolves.toEqual({
      replyText: "I hit a local error before finishing. Send /last_error to inspect the most recent failure.",
      attachments: []
    });
    expect(errorStore.getLast("chat-1")?.message).toBe("Vision pipeline crashed");
  });

  it("keeps a successful reply when memory compaction fails afterward", async () => {
    const memoryStore = createMemoryStoreStub();
    vi.mocked(memoryStore.compactConversation).mockRejectedValueOnce(
      new Error("Compaction model unavailable")
    );
    const errorStore = new RuntimeErrorStore();
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "Successful reply."
        }
      }))
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore,
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore
    });

    await expect(loop.run("chat-1", "say something")).resolves.toEqual({
      replyText: "Successful reply.",
      attachments: []
    });
    expect(errorStore.getLast("chat-1")?.scope).toBe("memory.compaction");
    expect(memoryStore.saveConversationTurn).toHaveBeenCalledWith(
      "chat-1",
      "say something",
      "Successful reply."
    );
  });

  it("uses a routed prompt and stronger model when the router escalates", async () => {
    const defaultClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("Default client should not handle an escalated task");
      })
    };
    const primaryClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => ({
        message: {
          role: "assistant",
          content: "Escalated task handled."
        }
      }))
    };
    const taskRouter: TaskRouter = {
      routeTask: vi.fn(async () => ({
        llmClient: primaryClient,
        preparedUserInput: "Cleaned task for the stronger model",
        route: "primary" as const,
        reason: "complex_request"
      }))
    };

    const loop = new AgentLoop({
      llmClient: defaultClient,
      taskRouter,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(loop.run("chat-1", "fix the broken build and explain why")).resolves.toEqual({
      replyText: "Escalated task handled.",
      attachments: []
    });

    expect(taskRouter.routeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userInput: "fix the broken build and explain why"
      })
    );
    expect(defaultClient.runStep).not.toHaveBeenCalled();
    expect(primaryClient.runStep).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(primaryClient.runStep)
        .mock.calls[0]?.[0].messages.some(
          (message) =>
            message.role === "user" && message.content === "Cleaned task for the stronger model"
        )
    ).toBe(true);
  });

  it("stops before calling the model when cancellation is already requested", async () => {
    const llmClient: LLMClient = {
      checkHealth: vi.fn(async () => undefined),
      runStep: vi.fn(async (): Promise<LLMRunResponse> => {
        throw new Error("LLM should not run after cancellation");
      })
    };

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([createGetCurrentTimeTool()]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    await expect(
      loop.run("chat-1", "do something", {
        shouldCancel: () => true
      })
    ).resolves.toEqual({
      replyText: CANCELED_MESSAGE,
      attachments: []
    });
    expect(llmClient.runStep).not.toHaveBeenCalled();
  });

  it("stops before executing a tool when cancellation arrives after the model step", async () => {
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
    const toolExecute = vi.fn(async () =>
      JSON.stringify({
        ok: true,
        timezone: "UTC"
      })
    );

    const loop = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry([{
        name: "get_current_time",
        description: "test tool",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        execute: toolExecute
      }]),
      memoryStore: createMemoryStoreStub(),
      maxIterations: 4,
      logger: createLogger("error"),
      errorStore: new RuntimeErrorStore()
    });

    let cancelCheckCount = 0;
    await expect(
      loop.run("chat-1", "do something", {
        shouldCancel: () => {
          cancelCheckCount += 1;
          return cancelCheckCount >= 2;
        }
      })
    ).resolves.toEqual({
      replyText: CANCELED_MESSAGE,
      attachments: []
    });

    expect(toolExecute).not.toHaveBeenCalled();
  });
});
