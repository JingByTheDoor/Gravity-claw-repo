import { describe, expect, it, vi } from "vitest";
import { createLaunchAppTool } from "../src/tools/launch-app.js";

describe("launch_app tool", () => {
  it("returns an input error for a blank app name", async () => {
    const tool = createLaunchAppTool({
      launch: vi.fn(async () => ({
        ok: true,
        query: "unused"
      }))
    } as never);

    const result = JSON.parse(await tool.execute({ app_name: "   " }, { chatId: "chat-1" })) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("app_name");
  });

  it("delegates launching to the app launcher", async () => {
    const launch = vi.fn(async () => ({
      ok: true,
      query: "Figma",
      matchedName: "Figma",
      appId: "figma.app",
      source: "start_apps" as const
    }));

    const tool = createLaunchAppTool({ launch } as never);
    const result = JSON.parse(await tool.execute({ app_name: "Figma" }, { chatId: "chat-1" })) as {
      ok: boolean;
      matchedName: string;
    };

    expect(launch).toHaveBeenCalledWith("Figma");
    expect(result.ok).toBe(true);
    expect(result.matchedName).toBe("Figma");
  });
});
