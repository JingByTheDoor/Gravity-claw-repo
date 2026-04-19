import { describe, expect, it, vi } from "vitest";
import { ChatTaskQueue } from "../src/agent/queue.js";
import { ApprovalStore } from "../src/approvals/store.js";
import { createLogger } from "../src/logging/logger.js";
import {
  createApproveCommandHandler,
  createDenyCommandHandler,
  createMessageHandler,
  createNewCommandHandler,
  NEW_CHAT_MESSAGE,
  TEXT_ONLY_MESSAGE
} from "../src/telegram/handlers.js";
import { createPathAccessPolicy } from "../src/tools/workspace.js";

describe("Telegram message handler", () => {
  it("replies to whitelisted text messages", async () => {
    const handler = createMessageHandler({
      allowedUserId: "123",
      agentLoop: {
        run: vi.fn(async () => "pong")
      },
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77 },
      message: { text: "ping" },
      api: { sendChatAction },
      reply
    });

    expect(sendChatAction).toHaveBeenCalledWith(77, "typing");
    expect(reply).toHaveBeenCalledWith("pong");
  });

  it("silently ignores non-whitelisted users", async () => {
    const handler = createMessageHandler({
      allowedUserId: "123",
      agentLoop: {
        run: vi.fn(async () => "pong")
      },
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);

    await handler({
      from: { id: 999 },
      chat: { id: 77 },
      message: { text: "ping" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    expect(reply).not.toHaveBeenCalled();
  });

  it("returns the text-only fallback for unsupported messages", async () => {
    const handler = createMessageHandler({
      allowedUserId: "123",
      agentLoop: {
        run: vi.fn(async () => "pong")
      },
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77 },
      message: {},
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    expect(reply).toHaveBeenCalledWith(TEXT_ONLY_MESSAGE);
  });

  it("handles /new by resetting conversation state", async () => {
    const resetConversation = vi.fn(() => undefined);
    const handler = createNewCommandHandler({
      allowedUserId: "123",
      memoryStore: {
        getPromptContext: vi.fn(() => ({
          coreFacts: [],
          recentMessages: []
        })),
        rememberFact: vi.fn((_chatId: string, key: string, value: string) => ({ key, value })),
        listFacts: vi.fn(() => []),
        saveConversationTurn: vi.fn(() => undefined),
        compactConversation: vi.fn(async () => undefined),
        resetConversation
      },
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77 },
      reply
    });

    expect(resetConversation).toHaveBeenCalledWith("77");
    expect(reply).toHaveBeenCalledWith(NEW_CHAT_MESSAGE);
  });

  it("approves a pending command and returns output", async () => {
    const approvalStore = new ApprovalStore();
    const approval = approvalStore.createShellApproval("77", "git status", process.cwd());
    const shellRunner = {
      executeApproval: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: "status ok",
        stderr: ""
      }))
    };

    const handler = createApproveCommandHandler({
      allowedUserId: "123",
      approvalStore,
      shellRunner: shellRunner as never,
      pathAccessPolicy: createPathAccessPolicy(process.cwd()),
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler(
      {
        from: { id: 123 },
        chat: { id: 77 },
        reply
      },
      approval.id
    );

    expect(shellRunner.executeApproval).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining(`Approved command ${approval.id}.`));
  });

  it("denies a pending command", async () => {
    const approvalStore = new ApprovalStore();
    const approval = approvalStore.createShellApproval("77", "npm install", process.cwd());
    const handler = createDenyCommandHandler({
      allowedUserId: "123",
      approvalStore,
      shellRunner: { executeApproval: vi.fn() } as never,
      pathAccessPolicy: createPathAccessPolicy(process.cwd()),
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler(
      {
        from: { id: 123 },
        chat: { id: 77 },
        reply
      },
      approval.id
    );

    expect(reply).toHaveBeenCalledWith(`Denied command ${approval.id}.`);
  });
});
