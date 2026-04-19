export interface PendingApproval {
  id: string;
  chatId: string;
  kind: "shell_command";
  command: string;
  cwd: string;
  createdAt: string;
}

function createApprovalId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class ApprovalStore {
  private readonly approvalsByChat = new Map<string, PendingApproval[]>();

  createShellApproval(chatId: string, command: string, cwd: string): PendingApproval {
    const approval: PendingApproval = {
      id: createApprovalId(),
      chatId,
      kind: "shell_command",
      command,
      cwd,
      createdAt: new Date().toISOString()
    };

    const existing = this.approvalsByChat.get(chatId) ?? [];
    existing.push(approval);
    this.approvalsByChat.set(chatId, existing);
    return approval;
  }

  listPending(chatId: string): PendingApproval[] {
    return [...(this.approvalsByChat.get(chatId) ?? [])];
  }

  peek(chatId: string, approvalId?: string): PendingApproval | undefined {
    const pending = this.approvalsByChat.get(chatId) ?? [];
    if (!approvalId) {
      return pending[pending.length - 1];
    }

    return pending.find((approval) => approval.id === approvalId);
  }

  consume(chatId: string, approvalId?: string): PendingApproval | undefined {
    const pending = this.approvalsByChat.get(chatId) ?? [];
    if (pending.length === 0) {
      return undefined;
    }

    const index = approvalId
      ? pending.findIndex((approval) => approval.id === approvalId)
      : pending.length - 1;

    if (index < 0) {
      return undefined;
    }

    const [approval] = pending.splice(index, 1);
    if (pending.length === 0) {
      this.approvalsByChat.delete(chatId);
    } else {
      this.approvalsByChat.set(chatId, pending);
    }

    return approval;
  }

  deny(chatId: string, approvalId?: string): PendingApproval | undefined {
    return this.consume(chatId, approvalId);
  }
}
