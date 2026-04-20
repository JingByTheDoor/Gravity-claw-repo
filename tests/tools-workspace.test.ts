import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createListFilesTool } from "../src/tools/list-files.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createResolveKnownFolderTool } from "../src/tools/resolve-known-folder.js";
import { createReplaceInFileTool } from "../src/tools/replace-in-file.js";
import { createSearchFilesTool } from "../src/tools/search-files.js";
import { createWriteFileTool } from "../src/tools/write-file.js";
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

  it("resolves a redirected Windows Downloads folder and reports when it is outside trusted roots", async () => {
    const workspaceRoot = createTempWorkspace();
    const redirectedDownloadsRoot = createTempWorkspace();
    const tool = createResolveKnownFolderTool(createPathAccessPolicy(workspaceRoot), {
      platform: "win32",
      homedir: () => workspaceRoot,
      readWindowsUserShellFolder: vi.fn(async () => redirectedDownloadsRoot),
      pathExists: vi.fn(() => true)
    });

    const result = JSON.parse(
      await tool.execute({ folder: "downloads folder" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      folder: string;
      path: string;
      accessible: boolean;
      accessError?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.folder).toBe("downloads");
    expect(result.path).toBe(path.resolve(redirectedDownloadsRoot));
    expect(result.accessible).toBe(false);
    expect(result.accessError).toContain("outside the allowed local roots");
  });

  it("falls back to the home-based Downloads path when no Windows redirect is found", async () => {
    const workspaceRoot = createTempWorkspace();
    const expectedDownloadsPath = path.join(workspaceRoot, "Downloads");
    const tool = createResolveKnownFolderTool(createPathAccessPolicy(workspaceRoot), {
      platform: "linux",
      homedir: () => workspaceRoot,
      pathExists: vi.fn(() => false),
      readWindowsUserShellFolder: vi.fn(async () => undefined)
    });

    const result = JSON.parse(
      await tool.execute({ folder: "downloads" }, { chatId: "chat-1" })
    ) as {
      ok: boolean;
      path: string;
      exists: boolean;
      accessible: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.resolve(expectedDownloadsPath));
    expect(result.exists).toBe(false);
    expect(result.accessible).toBe(true);
  });

  it("writes files inside trusted roots", async () => {
    const workspaceRoot = createTempWorkspace();
    const tool = createWriteFileTool(createPathAccessPolicy(workspaceRoot));

    const result = JSON.parse(
      await tool.execute(
        {
          path: "notes/out.txt",
          content: "hello world",
          mode: "overwrite"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      path: string;
    };

    expect(result.ok).toBe(true);
    expect(result.path).toBe("notes/out.txt");
    expect(fs.readFileSync(path.join(workspaceRoot, "notes", "out.txt"), "utf8")).toBe("hello world");
  });

  it("replaces text in trusted files", async () => {
    const workspaceRoot = createTempWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, "todo.txt"), "TODO\nTODO\n");
    const tool = createReplaceInFileTool(createPathAccessPolicy(workspaceRoot));

    const result = JSON.parse(
      await tool.execute(
        {
          path: "todo.txt",
          find: "TODO",
          replace: "DONE",
          all: "true"
        },
        { chatId: "chat-1" }
      )
    ) as {
      ok: boolean;
      replacements: number;
    };

    expect(result.ok).toBe(true);
    expect(result.replacements).toBe(2);
    expect(fs.readFileSync(path.join(workspaceRoot, "todo.txt"), "utf8")).toBe("DONE\nDONE\n");
  });
});
