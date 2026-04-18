import { describe, expect, it, vi } from "vitest";
import { AgentLoop, ITERATION_LIMIT_MESSAGE } from "../src/agent/loop.js";
import type { LLMRunResponse } from "../src/agent/types.js";
import type { LLMClient } from "../src/llm/client.js";
import { createLogger } from "../src/logging/logger.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";

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
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("hello")).resolves.toBe("Hello from local Ollama.");
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
      maxIterations: 4,
      logger: createLogger("error")
    });

    await expect(loop.run("What time is it in UTC?")).resolves.toBe("It is currently UTC time.");
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
      maxIterations: 4,
      logger: createLogger("error")
    });

    const reply = await loop.run("Time on Mars?");
    expect(reply).toBe("That timezone is invalid.");

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
      maxIterations: 2,
      logger: createLogger("error")
    });

    await expect(loop.run("loop")).resolves.toBe(ITERATION_LIMIT_MESSAGE);
  });
});
