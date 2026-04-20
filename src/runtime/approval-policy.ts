import type { ApprovalPolicy } from "./contracts.js";

export class DefaultApprovalPolicy implements ApprovalPolicy {
  shouldRequestReview(): boolean {
    return true;
  }
}
