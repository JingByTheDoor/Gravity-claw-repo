import { describe, expect, it } from "vitest";
import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";

describe("get_current_time tool", () => {
  it("returns a successful payload for a valid timezone", async () => {
    const tool = createGetCurrentTimeTool();
    const result = JSON.parse(await tool.execute({ timezone: "UTC" }, { chatId: "chat-1" })) as {
      ok: boolean;
      timezone: string;
    };

    expect(result.ok).toBe(true);
    expect(result.timezone).toBe("UTC");
  });

  it("returns a safe error payload for an invalid timezone", async () => {
    const tool = createGetCurrentTimeTool();
    const result = JSON.parse(
      await tool.execute({ timezone: "Mars/OlympusMons" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid timezone/);
  });
});
