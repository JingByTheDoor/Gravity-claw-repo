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
});
