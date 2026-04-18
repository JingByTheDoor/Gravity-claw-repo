import { describe, expect, it, vi } from "vitest";
import { ChatTaskQueue } from "../src/agent/queue.js";
import { createLogger } from "../src/logging/logger.js";
import { createMessageHandler, TEXT_ONLY_MESSAGE } from "../src/telegram/handlers.js";

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
});
