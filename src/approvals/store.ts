import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import path from "node:path";

export interface PendingApproval {
  id: string;
  chatId: string;
  kind: "shell_command";
  command: string;
  cwd: string;
  createdAt: string;
}

function createApprovalId(): string {
  return randomBytes(4).toString("hex");
}

function toDatabasePath(databasePath: string): string {
  return databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
}

export class ApprovalStore {
  private readonly database: Database.Database;

  constructor(databasePath = ":memory:") {
    this.database = new Database(toDatabasePath(databasePath));
    this.database.pragma("journal_mode = WAL");
    this.createSchema();
  }

  close(): void {
    this.database.close();
  }

  createShellApproval(chatId: string, command: string, cwd: string): PendingApproval {
    const approval: PendingApproval = {
      id: createApprovalId(),
      chatId,
      kind: "shell_command",
      command,
      cwd,
      createdAt: new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO pending_approvals (id, chat_id, kind, command, cwd, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(approval.id, approval.chatId, approval.kind, approval.command, approval.cwd, approval.createdAt);

    return approval;
  }

  listPending(chatId: string): PendingApproval[] {
    return this.database
      .prepare(
        `
          SELECT id, chat_id AS chatId, kind, command, cwd, created_at AS createdAt
          FROM pending_approvals
          WHERE chat_id = ?
          ORDER BY rowid ASC
        `
      )
      .all(chatId) as PendingApproval[];
  }

  countPending(chatId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM pending_approvals
          WHERE chat_id = ?
        `
      )
      .get(chatId) as { count: number };

    return row.count;
  }

  peek(chatId: string, approvalId?: string): PendingApproval | undefined {
    if (approvalId) {
      return this.database
        .prepare(
          `
            SELECT id, chat_id AS chatId, kind, command, cwd, created_at AS createdAt
            FROM pending_approvals
            WHERE chat_id = ?
              AND id = ?
            LIMIT 1
          `
        )
        .get(chatId, approvalId) as PendingApproval | undefined;
    }

    return this.database
      .prepare(
        `
          SELECT id, chat_id AS chatId, kind, command, cwd, created_at AS createdAt
          FROM pending_approvals
          WHERE chat_id = ?
          ORDER BY rowid DESC
          LIMIT 1
        `
      )
      .get(chatId) as PendingApproval | undefined;
  }

  consume(chatId: string, approvalId?: string): PendingApproval | undefined {
    const approval = this.peek(chatId, approvalId);
    if (!approval) {
      return undefined;
    }

    this.database
      .prepare(
        `
          DELETE FROM pending_approvals
          WHERE chat_id = ?
            AND id = ?
        `
      )
      .run(chatId, approval.id);

    return approval;
  }

  deny(chatId: string, approvalId?: string): PendingApproval | undefined {
    return this.consume(chatId, approvalId);
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}
