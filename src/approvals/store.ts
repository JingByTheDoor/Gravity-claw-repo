import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import path from "node:path";

export interface PendingApproval {
  id: string;
  chatId: string;
  kind: "shell_command" | "external_action";
  taskId?: string;
  title: string;
  details: string;
  command?: string;
  cwd?: string;
  payloadJson?: string;
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

  createShellApproval(
    chatId: string,
    command: string,
    cwd: string,
    taskId?: string
  ): PendingApproval {
    const approval: PendingApproval = {
      id: createApprovalId(),
      chatId,
      ...(taskId ? { taskId } : {}),
      kind: "shell_command",
      title: "Shell command approval",
      details: command,
      command,
      cwd,
      createdAt: new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO pending_approvals (
            id,
            chat_id,
            task_id,
            kind,
            title,
            details,
            command,
            cwd,
            payload_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        approval.id,
        approval.chatId,
        approval.taskId ?? null,
        approval.kind,
        approval.title,
        approval.details,
        approval.command ?? null,
        approval.cwd ?? null,
        approval.payloadJson ?? null,
        approval.createdAt
      );

    return approval;
  }

  createExternalActionApproval(
    chatId: string,
    title: string,
    details: string,
    taskId?: string,
    payload?: Record<string, unknown>
  ): PendingApproval {
    const approval: PendingApproval = {
      id: createApprovalId(),
      chatId,
      ...(taskId ? { taskId } : {}),
      kind: "external_action",
      title,
      details,
      ...(payload ? { payloadJson: JSON.stringify(payload) } : {}),
      createdAt: new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO pending_approvals (
            id,
            chat_id,
            task_id,
            kind,
            title,
            details,
            command,
            cwd,
            payload_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        approval.id,
        approval.chatId,
        approval.taskId ?? null,
        approval.kind,
        approval.title,
        approval.details,
        null,
        null,
        approval.payloadJson ?? null,
        approval.createdAt
      );

    return approval;
  }

  listPending(chatId: string): PendingApproval[] {
    return this.database
      .prepare(
        `
          SELECT
            id,
            chat_id AS chatId,
            task_id AS taskId,
            kind,
            title,
            details,
            command,
            cwd,
            payload_json AS payloadJson,
            created_at AS createdAt
          FROM pending_approvals
          WHERE chat_id = ?
          ORDER BY rowid ASC
        `
      )
      .all(chatId) as PendingApproval[];
  }

  listPendingForTask(taskId: string): PendingApproval[] {
    return this.database
      .prepare(
        `
          SELECT
            id,
            chat_id AS chatId,
            task_id AS taskId,
            kind,
            title,
            details,
            command,
            cwd,
            payload_json AS payloadJson,
            created_at AS createdAt
          FROM pending_approvals
          WHERE task_id = ?
          ORDER BY rowid ASC
        `
      )
      .all(taskId) as PendingApproval[];
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
            SELECT
              id,
              chat_id AS chatId,
              task_id AS taskId,
              kind,
              title,
              details,
              command,
              cwd,
              payload_json AS payloadJson,
              created_at AS createdAt
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
          SELECT
            id,
            chat_id AS chatId,
            task_id AS taskId,
            kind,
            title,
            details,
            command,
            cwd,
            payload_json AS payloadJson,
            created_at AS createdAt
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
        task_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL,
        command TEXT,
        cwd TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
    `);

    const columns = this.database
      .prepare(`PRAGMA table_info(pending_approvals)`)
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has("task_id")) {
      this.database.exec(`ALTER TABLE pending_approvals ADD COLUMN task_id TEXT;`);
    }
    if (!columnNames.has("title")) {
      this.database.exec(`ALTER TABLE pending_approvals ADD COLUMN title TEXT;`);
      this.database.exec(`UPDATE pending_approvals SET title = 'Shell command approval' WHERE title IS NULL;`);
    }
    if (!columnNames.has("details")) {
      this.database.exec(`ALTER TABLE pending_approvals ADD COLUMN details TEXT;`);
      this.database.exec(`UPDATE pending_approvals SET details = COALESCE(command, '') WHERE details IS NULL;`);
    }
    if (!columnNames.has("payload_json")) {
      this.database.exec(`ALTER TABLE pending_approvals ADD COLUMN payload_json TEXT;`);
    }
  }
}
