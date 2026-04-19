import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/approvals/store.js";

describe("ApprovalStore", () => {
  it("stores and consumes pending approvals", () => {
    const store = new ApprovalStore();
    const approval = store.createShellApproval("chat-1", "Get-Date", "C:/workspace");

    expect(store.peek("chat-1")?.id).toBe(approval.id);
    expect(store.consume("chat-1", approval.id)?.command).toBe("Get-Date");
    expect(store.peek("chat-1")).toBeUndefined();
  });
});
