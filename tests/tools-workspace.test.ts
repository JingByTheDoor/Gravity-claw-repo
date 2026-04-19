import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createListFilesTool } from "../src/tools/list-files.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createSearchFilesTool } from "../src/tools/search-files.js";
import { createPathAccessPolicy } from "../src/tools/workspace.js";

const tempRoots: string[] = [];

function createTempWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gravity-claw-workspace-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace tools", () => {
  it("lists files relative to the workspace root", async () => {
    const workspaceRoot = createTempWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, "alpha.txt"), "hello");
    fs.mkdirSync(path.join(workspaceRoot, "notes"));
    fs.writeFileSync(path.join(workspaceRoot, "notes", "beta.txt"), "world");

    const tool = createListFilesTool(createPathAccessPolicy(workspaceRoot));
    const result = JSON.parse(await tool.execute({ recursive: "true" }, { chatId: "chat-1" })) as {
      ok: boolean;
      entries: string[];
    };

    expect(result.ok).toBe(true);
    expect(result.entries).toContain("alpha.txt");
    expect(result.entries).toContain("notes/");
    expect(result.entries).toContain("notes/beta.txt");
  });

  it("reads file slices", async () => {
    const workspaceRoot = createTempWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, "story.txt"), "line1\nline2\nline3");

    const tool = createReadFileTool(createPathAccessPolicy(workspaceRoot));
    const result = JSON.parse(
      await tool.execute({ path: "story.txt", start_line: "2", end_line: "3" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      content: string;
    };

    expect(result.ok).toBe(true);
    expect(result.content).toBe("line2\nline3");
  });

  it("searches files for plain-text matches", async () => {
    const workspaceRoot = createTempWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, "notes.txt"), "alpha\norange\nbravo");

    const tool = createSearchFilesTool(createPathAccessPolicy(workspaceRoot));
    const result = JSON.parse(
      await tool.execute({ query: "orange" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      matches: Array<{ path: string; line: number; content: string }>;
    };

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toEqual({
      path: "notes.txt",
      line: 2,
      content: "orange"
    });
  });

  it("allows absolute paths inside extra trusted roots", async () => {
    const workspaceRoot = createTempWorkspace();
    const extraRoot = createTempWorkspace();
    const outsideFile = path.join(extraRoot, "outside.txt");
    fs.writeFileSync(outsideFile, "trusted");

    const tool = createReadFileTool(createPathAccessPolicy(workspaceRoot, [extraRoot]));
    const result = JSON.parse(
      await tool.execute({ path: outsideFile }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      path: string;
      content: string;
    };

    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.resolve(outsideFile));
    expect(result.content).toBe("trusted");
  });

  it("rejects paths outside trusted roots", async () => {
    const workspaceRoot = createTempWorkspace();
    const outsideRoot = createTempWorkspace();
    const outsideFile = path.join(outsideRoot, "blocked.txt");
    fs.writeFileSync(outsideFile, "blocked");

    const tool = createReadFileTool(createPathAccessPolicy(workspaceRoot));
    const result = JSON.parse(
      await tool.execute({ path: outsideFile }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the allowed local roots");
  });
});
