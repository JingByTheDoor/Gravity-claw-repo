import { describe, expect, it } from "vitest";
import { ChatTaskQueue } from "../src/agent/queue.js";

describe("ChatTaskQueue", () => {
  it("preserves order for the same chat", async () => {
    const queue = new ChatTaskQueue();
    const events: string[] = [];

    const first = queue.run("chat-1", async () => {
      events.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first-end");
    });

    const second = queue.run("chat-1", async () => {
      events.push("second-start");
      events.push("second-end");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("serializes work across chats to avoid shared interactive controller state", async () => {
    const queue = new ChatTaskQueue();
    const events: string[] = [];

    const first = queue.run("chat-1", async () => {
      events.push("chat-1-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("chat-1-end");
    });

    const second = queue.run("chat-2", async () => {
      events.push("chat-2-start");
      events.push("chat-2-end");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["chat-1-start", "chat-1-end", "chat-2-start", "chat-2-end"]);
  });

  it("tracks active runs and captures steering messages", () => {
    const queue = new ChatTaskQueue();

    expect(queue.captureSteeringMessage("chat-1", "be careful")).toBe(false);

    queue.beginActiveRun("chat-1");
    expect(queue.isActiveRun("chat-1")).toBe(true);
    expect(queue.captureSteeringMessage("chat-1", "be careful")).toBe(true);
    expect(queue.captureSteeringMessage("chat-1", "  use a shorter answer  ")).toBe(true);
    expect(queue.consumeSteeringMessages("chat-1")).toEqual([
      "be careful",
      "use a shorter answer"
    ]);
    expect(queue.consumeSteeringMessages("chat-1")).toEqual([]);

    queue.endActiveRun("chat-1");
    expect(queue.isActiveRun("chat-1")).toBe(false);
  });

  it("tracks and clears cancel requests per chat", () => {
    const queue = new ChatTaskQueue();

    expect(queue.requestCancel("chat-1")).toBe(false);

    queue.beginActiveRun("chat-1");
    expect(queue.requestCancel("chat-1")).toBe(true);
    expect(queue.shouldCancel("chat-1")).toBe(true);

    queue.endActiveRun("chat-1");
    expect(queue.shouldCancel("chat-1")).toBe(false);
  });
});
