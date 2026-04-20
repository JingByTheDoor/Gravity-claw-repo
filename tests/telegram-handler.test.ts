import { describe, expect, it, vi } from "vitest";
import { ChatTaskQueue } from "../src/agent/queue.js";
import { ApprovalStore } from "../src/approvals/store.js";
import { RuntimeErrorStore } from "../src/errors/runtime-error-store.js";
import { createLogger } from "../src/logging/logger.js";
import type { RunEvent } from "../src/runtime/contracts.js";
import {
  createApprovalsCommandHandler,
  createApproveCommandHandler,
  createCancelCommandHandler,
  createDenyCommandHandler,
  createHelpCommandHandler,
  HELP_MESSAGE,
  createLastErrorCommandHandler,
  NO_ACTIVE_TASK_TO_CANCEL_MESSAGE,
  CANCEL_REQUESTED_MESSAGE,
  LIVE_STEERING_MESSAGE,
  createMessageHandler,
  createNewCommandHandler,
  createStatusCommandHandler,
  NEW_CHAT_MESSAGE,
  TEXT_ONLY_MESSAGE
} from "../src/telegram/handlers.js";
import { createPathAccessPolicy } from "../src/tools/workspace.js";

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(async () => ({}))
  }
}));

function createEvent(
  chatId: string,
  type: RunEvent["type"],
  message: string,
  extra: Partial<RunEvent> = {}
): RunEvent {
  return {
    taskId: "task-1",
    chatId,
    type,
    message,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...extra
  };
}

describe("Telegram message handler", () => {
  it("replies to whitelisted text messages", async () => {
    const submitTask = vi.fn(async (chatId: string, _input: string, sink?: { notify(event: RunEvent): Promise<void> }) => {
      await sink?.notify(createEvent(chatId, "task_completed", "pong", { status: "completed" }));
      return { task: { id: "task-1", chatId, userInput: "ping", status: "completed", createdAt: "", updatedAt: "" }, replyText: "pong", attachments: [] };
    });

    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask,
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async (_text: string) => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: { text: "ping" },
      api: { sendChatAction },
      reply
    });

    expect(sendChatAction).toHaveBeenCalledWith(77, "typing");
    expect(submitTask).toHaveBeenCalledWith("77", "ping", expect.any(Object));
    expect(reply).toHaveBeenCalledWith("pong");
  });

  it("silently ignores non-whitelisted users", async () => {
    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask: vi.fn(),
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async (_text: string) => undefined);

    await handler({
      from: { id: 999 },
      chat: { id: 77, type: "private" },
      message: { text: "ping" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    expect(reply).not.toHaveBeenCalled();
  });

  it("ignores non-private chats even when the sender is allowed", async () => {
    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: ["-1001"],
      taskRuntime: {
        submitTask: vi.fn(),
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async (_text: string) => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: -1001, type: "group" },
      message: { text: "ping" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    expect(reply).not.toHaveBeenCalled();
  });

  it("returns the text-only fallback for unsupported messages", async () => {
    const submitTask = vi.fn();
    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask,
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: {},
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    expect(submitTask).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(TEXT_ONLY_MESSAGE);
  });

  it("sends screenshot attachments as Telegram photos", async () => {
    const submitTask = vi.fn(async (chatId: string, _input: string, sink?: { notify(event: RunEvent): Promise<void> }) => {
      await sink?.notify(createEvent(chatId, "task_completed", "Here is the screenshot.", { status: "completed" }));
      await sink?.notify(createEvent(chatId, "artifact_recorded", "screen.png", {
        status: "completed",
        artifact: {
          kind: "image",
          path: "C:\\temp\\screen.png",
          label: "screen.png"
        }
      }));

      return { task: { id: "task-1", chatId, userInput: "take screenshot", status: "completed", createdAt: "", updatedAt: "" }, replyText: "Here is the screenshot.", attachments: [] };
    });

    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask,
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const sendPhoto = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: { text: "take screenshot" },
      api: { sendChatAction, sendPhoto },
      reply
    });

    expect(reply).toHaveBeenCalledWith("Here is the screenshot.");
    expect(sendPhoto).toHaveBeenCalledTimes(1);
  });

  it("forwards progress updates as separate Telegram messages", async () => {
    const submitTask = vi.fn(async (chatId: string, _input: string, sink?: { notify(event: RunEvent): Promise<void> }) => {
      await sink?.notify(createEvent(chatId, "progress", 'Status: opening "Figma"', { status: "running" }));
      await sink?.notify(createEvent(chatId, "progress", 'Status: opened "Figma"', { status: "running" }));
      await sink?.notify(createEvent(chatId, "task_completed", "Done.", { status: "completed" }));
      return { task: { id: "task-1", chatId, userInput: "open figma", status: "completed", createdAt: "", updatedAt: "" }, replyText: "Done.", attachments: [] };
    });

    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask,
        requestCancel: vi.fn(() => false)
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);

    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: { text: "open figma" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply
    });

    const replyCalls = reply.mock.calls as unknown as string[][];

    expect(replyCalls.map((call) => call[0])).toEqual([
      'Status: opening "Figma"',
      'Status: opened "Figma"',
      "Done."
    ]);
  });

  it("treats a second mid-run message as live steering instead of a new queued turn", async () => {
    let resolveRun!: () => void;
    let markRunStarted!: () => void;
    let observedSteering: string[] = [];
    const runBlocked = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runStarted = new Promise<void>((resolve) => {
      markRunStarted = resolve;
    });

    const queue = new ChatTaskQueue();
    const submitTask = vi.fn(async (chatId: string, _input: string, sink?: { notify(event: RunEvent): Promise<void> }) => {
      queue.beginActiveRun(chatId);
      markRunStarted();
      await runBlocked;
      observedSteering = queue.consumeSteeringMessages(chatId);
      queue.endActiveRun(chatId);
      await sink?.notify(createEvent(chatId, "task_completed", "Done.", { status: "completed" }));
      return { task: { id: "task-1", chatId, userInput: "start the task", status: "completed", createdAt: "", updatedAt: "" }, replyText: "Done.", attachments: [] };
    });

    const handler = createMessageHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        submitTask,
        requestCancel: vi.fn(() => false)
      } as never,
      queue,
      logger: createLogger("error")
    });

    const firstReply = vi.fn(async () => undefined);
    const secondReply = vi.fn(async () => undefined);

    const firstMessagePromise = handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: { text: "start the task" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply: firstReply
    });

    await runStarted;

    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      message: { text: "also keep the reply short" },
      api: { sendChatAction: vi.fn(async () => undefined) },
      reply: secondReply
    });

    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(secondReply).toHaveBeenCalledWith(LIVE_STEERING_MESSAGE);

    resolveRun();
    await firstMessagePromise;

    expect(observedSteering).toEqual(["also keep the reply short"]);
    expect(firstReply).toHaveBeenCalledWith("Done.");
  });

  it("handles /new by resetting conversation state", async () => {
    const resetConversation = vi.fn(() => undefined);
    const handler = createNewCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
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
      chat: { id: 77, type: "private" },
      reply
    });

    expect(resetConversation).toHaveBeenCalledWith("77");
    expect(reply).toHaveBeenCalledWith(NEW_CHAT_MESSAGE);
  });

  it("shows help text through /help", async () => {
    const handler = createHelpCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(reply).toHaveBeenCalledWith(HELP_MESSAGE);
  });

  it("shows status details through /status", async () => {
    const handler = createStatusCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      statusService: {
        getStatus: vi.fn(async () => ({
          bot: { id: 42, username: "gravity_claw_bot" },
          ollamaReachable: true,
          chatModelAvailable: true,
          fastModelAvailable: true,
          visionModelAvailable: true,
          databasePath: "gravity-claw.db",
          workspaceRoot: "C:/workspace",
          allowedRoots: ["C:/workspace"],
          ollamaHost: "http://127.0.0.1:11434",
          ollamaModel: "qwen2.5:3b",
          ollamaFastModel: "qwen2.5:1.5b",
          ollamaVisionModel: "gemma4:latest",
          fastRoutingEnabled: true,
          pendingApprovalCount: 1,
          workerLabel: "Gravity Claw Worker",
          workerMode: "vm" as const,
          browserProfileDir: "C:/bot/browser",
          taskCounts: {
            queued: 0,
            running: 1,
            waiting_approval: 1,
            completed: 5,
            failed: 0,
            canceled: 0
          },
          latestLocalErrorAt: "2026-04-20T02:31:56.000Z",
          latestLocalErrorScope: "agent.run"
        }))
      } as never,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Vision model: gemma4:latest"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Worker: Gravity Claw Worker (vm)"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Pending approvals in this chat: 1"));
  });

  it("lists pending approvals through /approvals", async () => {
    const approvalStore = new ApprovalStore();
    approvalStore.createShellApproval("77", "npm install", process.cwd());
    const handler = createApprovalsCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      approvalStore,
      pathAccessPolicy: createPathAccessPolicy(process.cwd()),
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Pending approvals for this chat: 1"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("npm install"));
  });

  it("approves a pending command and returns output for orphaned approvals", async () => {
    const approvalStore = new ApprovalStore();
    const approval = approvalStore.createShellApproval("77", "git status", process.cwd());
    const approvePending = vi.fn(async () => ({
      task: {
        id: "task-approval",
        chatId: "77",
        userInput: "approval",
        status: "completed",
        createdAt: "",
        updatedAt: ""
      },
      replyText: `Approved command ${approval.id}.`,
      attachments: []
    }));

    const handler = createApproveCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      approvalStore,
      taskRuntime: {
        approvePending,
        denyPending: vi.fn(),
        requestCancel: vi.fn(() => false)
      } as never,
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler(
      {
        from: { id: 123 },
        chat: { id: 77, type: "private" },
        reply
      },
      approval.id
    );

    expect(approvePending).toHaveBeenCalledWith("77", approval.id, expect.any(Object));
    expect(reply).toHaveBeenCalledWith(`Approved command ${approval.id}.`);
  });

  it("denies a pending command", async () => {
    const approvalStore = new ApprovalStore();
    const approval = approvalStore.createShellApproval("77", "npm install", process.cwd());
    const denyPending = vi.fn(() => approval);
    const handler = createDenyCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      approvalStore,
      taskRuntime: {
        approvePending: vi.fn(),
        denyPending,
        requestCancel: vi.fn(() => false)
      } as never,
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler(
      {
        from: { id: 123 },
        chat: { id: 77, type: "private" },
        reply
      },
      approval.id
    );

    expect(reply).toHaveBeenCalledWith(`Denied command ${approval.id}.`);
  });

  it("shows the last stored local error", async () => {
    const errorStore = new RuntimeErrorStore();
    errorStore.record("77", "agent.run", "Vision pipeline crashed");
    const handler = createLastErrorCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      errorStore,
      queue: new ChatTaskQueue(),
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Vision pipeline crashed"));
  });

  it("requests cancellation immediately for an active task", async () => {
    const requestCancel = vi.fn(() => true);
    const handler = createCancelCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        requestCancel
      } as never,
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(requestCancel).toHaveBeenCalledWith("77");
    expect(reply).toHaveBeenCalledWith(CANCEL_REQUESTED_MESSAGE);
  });

  it("reports when there is no task to cancel", async () => {
    const handler = createCancelCommandHandler({
      allowedUserId: "123",
      allowedChatIds: [],
      taskRuntime: {
        requestCancel: vi.fn(() => false)
      } as never,
      logger: createLogger("error")
    });

    const reply = vi.fn(async () => undefined);
    await handler({
      from: { id: 123 },
      chat: { id: 77, type: "private" },
      reply
    });

    expect(reply).toHaveBeenCalledWith(NO_ACTIVE_TASK_TO_CANCEL_MESSAGE);
  });
});
