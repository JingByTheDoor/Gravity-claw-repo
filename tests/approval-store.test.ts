import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/approvals/store.js";

const databasePaths: string[] = [];

function createTempDatabasePath(): string {
  const filePath = path.join(os.tmpdir(), `gravity-claw-approval-${Date.now()}-${Math.random()}.db`);
  databasePaths.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const databasePath of databasePaths.splice(0)) {
    fs.rmSync(databasePath, { force: true });
  }
});

describe("ApprovalStore", () => {
  it("stores and consumes pending approvals", () => {
    const store = new ApprovalStore();
    const approval = store.createShellApproval("chat-1", "Get-Date", "C:/workspace");

    expect(store.peek("chat-1")?.id).toBe(approval.id);
    expect(store.consume("chat-1", approval.id)?.command).toBe("Get-Date");
    expect(store.peek("chat-1")).toBeUndefined();
  });

  it("persists approvals across store recreation", () => {
    const databasePath = createTempDatabasePath();
    const firstStore = new ApprovalStore(databasePath);
    const approval = firstStore.createShellApproval("chat-1", "npm install", "C:/workspace");
    firstStore.close();

    const secondStore = new ApprovalStore(databasePath);
    expect(secondStore.peek("chat-1", approval.id)?.command).toBe("npm install");
    expect(secondStore.countPending("chat-1")).toBe(1);
    expect(secondStore.deny("chat-1", approval.id)?.id).toBe(approval.id);
    expect(secondStore.countPending("chat-1")).toBe(0);
    secondStore.close();
  });
});
