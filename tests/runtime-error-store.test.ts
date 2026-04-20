import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeErrorStore } from "../src/errors/runtime-error-store.js";

const databasePaths: string[] = [];

function createTempDatabasePath(): string {
  const filePath = path.join(os.tmpdir(), `gravity-claw-errors-${Date.now()}-${Math.random()}.db`);
  databasePaths.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const databasePath of databasePaths.splice(0)) {
    fs.rmSync(databasePath, { force: true });
  }
});

describe("RuntimeErrorStore", () => {
  it("persists the latest local error across store recreation", () => {
    const databasePath = createTempDatabasePath();
    const firstStore = new RuntimeErrorStore(databasePath);
    firstStore.record("chat-1", "agent.run", "Vision failed");
    firstStore.close();

    const secondStore = new RuntimeErrorStore(databasePath);
    expect(secondStore.getLast("chat-1")).toEqual({
      chatId: "chat-1",
      scope: "agent.run",
      message: "Vision failed",
      createdAt: expect.any(String)
    });
    secondStore.close();
  });
});
