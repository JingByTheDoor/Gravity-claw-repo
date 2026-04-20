import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { ArtifactRef, RunEvent, RunEventType, Task, TaskStatus } from "./contracts.js";

interface TaskRow {
  id: string;
  chatId: string;
  userInput: string;
  status: TaskStatus;
  parentTaskId: string | null;
  replyText: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function toDatabasePath(databasePath: string): string {
  return databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
}

function createTaskId(): string {
  return randomBytes(8).toString("hex");
}

function normalizeTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    chatId: row.chatId,
    userInput: row.userInput,
    status: row.status,
    ...(row.parentTaskId ? { parentTaskId: row.parentTaskId } : {}),
    ...(row.replyText ? { replyText: row.replyText } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {})
  };
}

export class TaskStore {
  private readonly database: Database.Database;

  constructor(databasePath = ":memory:") {
    this.database = new Database(toDatabasePath(databasePath));
    this.database.pragma("journal_mode = WAL");
    this.createSchema();
  }

  close(): void {
    this.database.close();
  }

  createTask(chatId: string, userInput: string, parentTaskId?: string): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: createTaskId(),
      chatId,
      userInput,
      status: "queued",
      ...(parentTaskId ? { parentTaskId } : {}),
      createdAt: now,
      updatedAt: now
    };

    this.database
      .prepare(
        `
          INSERT INTO tasks (
            id,
            chat_id,
            user_input,
            status,
            parent_task_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        task.id,
        task.chatId,
        task.userInput,
        task.status,
        task.parentTaskId ?? null,
        task.createdAt,
        task.updatedAt
      );

    return task;
  }

  getTask(taskId: string): Task | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            chat_id AS chatId,
            user_input AS userInput,
            status,
            parent_task_id AS parentTaskId,
            reply_text AS replyText,
            error_message AS errorMessage,
            created_at AS createdAt,
            updated_at AS updatedAt,
            started_at AS startedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(taskId) as TaskRow | undefined;

    return row ? normalizeTaskRow(row) : undefined;
  }

  markRunning(taskId: string): Task {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE tasks
          SET status = 'running',
              updated_at = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = NULL,
              error_message = NULL
          WHERE id = ?
        `
      )
      .run(now, now, taskId);

    return this.requireTask(taskId);
  }

  markWaitingApproval(taskId: string, replyText: string): Task {
    return this.updateFinishedState(taskId, "waiting_approval", replyText);
  }

  markCompleted(taskId: string, replyText: string): Task {
    return this.updateFinishedState(taskId, "completed", replyText);
  }

  markFailed(taskId: string, errorMessage: string, replyText?: string): Task {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE tasks
          SET status = 'failed',
              reply_text = ?,
              error_message = ?,
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `
      )
      .run(replyText ?? null, errorMessage, now, now, taskId);

    return this.requireTask(taskId);
  }

  markCanceled(taskId: string, replyText: string): Task {
    return this.updateFinishedState(taskId, "canceled", replyText);
  }

  listOpenTasks(): Task[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            chat_id AS chatId,
            user_input AS userInput,
            status,
            parent_task_id AS parentTaskId,
            reply_text AS replyText,
            error_message AS errorMessage,
            created_at AS createdAt,
            updated_at AS updatedAt,
            started_at AS startedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE status IN ('queued', 'running', 'waiting_approval')
          ORDER BY created_at ASC
        `
      )
      .all() as TaskRow[];

    return rows.map((row) => normalizeTaskRow(row));
  }

  recoverInterruptedTasks(): Task[] {
    const interrupted = this.database
      .prepare(
        `
          SELECT
            id,
            chat_id AS chatId,
            user_input AS userInput,
            status,
            parent_task_id AS parentTaskId,
            reply_text AS replyText,
            error_message AS errorMessage,
            created_at AS createdAt,
            updated_at AS updatedAt,
            started_at AS startedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE status = 'running'
          ORDER BY created_at ASC
        `
      )
      .all() as TaskRow[];

    const now = new Date().toISOString();
    const update = this.database.prepare(
      `
        UPDATE tasks
        SET status = 'failed',
            error_message = ?,
            updated_at = ?,
            completed_at = ?,
            reply_text = COALESCE(reply_text, ?)
        WHERE id = ?
      `
    );

    for (const task of interrupted) {
      update.run(
        "Task interrupted by restart before it finished.",
        now,
        now,
        "The worker restarted before this task could finish.",
        task.id
      );
    }

    return interrupted.map((task) => ({
      ...normalizeTaskRow(task),
      status: "failed",
      errorMessage: "Task interrupted by restart before it finished.",
      replyText: task.replyText ?? "The worker restarted before this task could finish.",
      updatedAt: now,
      completedAt: now
    }));
  }

  appendEvent(event: Omit<RunEvent, "createdAt"> & { createdAt?: string }): RunEvent {
    const createdAt = event.createdAt ?? new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO task_events (
            task_id,
            chat_id,
            type,
            message,
            status,
            approval_id,
            approval_kind,
            approval_title,
            approval_details,
            artifact_kind,
            artifact_path,
            artifact_label,
            data_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.taskId,
        event.chatId,
        event.type,
        event.message,
        event.status ?? null,
        event.approval?.id ?? null,
        event.approval?.kind ?? null,
        event.approval?.title ?? null,
        event.approval?.details ?? null,
        event.artifact?.kind ?? null,
        event.artifact?.path ?? null,
        event.artifact?.label ?? null,
        event.data ? JSON.stringify(event.data) : null,
        createdAt
      );

    return {
      ...event,
      createdAt
    };
  }

  listEvents(taskId: string): RunEvent[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            task_id AS taskId,
            chat_id AS chatId,
            type,
            message,
            status,
            approval_id AS approvalId,
            approval_kind AS approvalKind,
            approval_title AS approvalTitle,
            approval_details AS approvalDetails,
            artifact_kind AS artifactKind,
            artifact_path AS artifactPath,
            artifact_label AS artifactLabel,
            data_json AS dataJson,
            created_at AS createdAt
          FROM task_events
          WHERE task_id = ?
          ORDER BY id ASC
        `
      )
      .all(taskId) as Array<{
        taskId: string;
        chatId: string;
        type: RunEventType;
        message: string;
        status: TaskStatus | null;
        approvalId: string | null;
        approvalKind: "shell_command" | "external_action" | null;
        approvalTitle: string | null;
        approvalDetails: string | null;
        artifactKind: "image" | "file" | "log" | null;
        artifactPath: string | null;
        artifactLabel: string | null;
        dataJson: string | null;
        createdAt: string;
      }>;

    return rows.map((row) => ({
      taskId: row.taskId,
      chatId: row.chatId,
      type: row.type,
      message: row.message,
      createdAt: row.createdAt,
      ...(row.status ? { status: row.status } : {}),
      ...(row.approvalId && row.approvalKind && row.approvalTitle && row.approvalDetails
        ? {
            approval: {
              id: row.approvalId,
              kind: row.approvalKind,
              chatId: row.chatId,
              taskId: row.taskId,
              title: row.approvalTitle,
              details: row.approvalDetails,
              createdAt: row.createdAt
            }
          }
        : {}),
      ...(row.artifactKind && row.artifactPath
        ? {
            artifact: {
              kind: row.artifactKind,
              path: row.artifactPath,
              ...(row.artifactLabel ? { label: row.artifactLabel } : {}),
              createdAt: row.createdAt
            }
          }
        : {}),
      ...(row.dataJson ? { data: JSON.parse(row.dataJson) as Record<string, unknown> } : {})
    }));
  }

  recordArtifact(taskId: string, artifact: Omit<ArtifactRef, "createdAt">): ArtifactRef {
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO task_artifacts (task_id, kind, path, label, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(taskId, artifact.kind, artifact.path, artifact.label ?? null, createdAt);

    return {
      ...artifact,
      createdAt
    };
  }

  listArtifacts(taskId: string): ArtifactRef[] {
    return this.database
      .prepare(
        `
          SELECT kind, path, label, created_at AS createdAt
          FROM task_artifacts
          WHERE task_id = ?
          ORDER BY id ASC
        `
      )
      .all(taskId) as ArtifactRef[];
  }

  countByStatus(chatId: string): Record<TaskStatus, number> {
    const rows = this.database
      .prepare(
        `
          SELECT status, COUNT(*) AS count
          FROM tasks
          WHERE chat_id = ?
          GROUP BY status
        `
      )
      .all(chatId) as Array<{ status: TaskStatus; count: number }>;

    const counts: Record<TaskStatus, number> = {
      queued: 0,
      running: 0,
      waiting_approval: 0,
      completed: 0,
      failed: 0,
      canceled: 0
    };

    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  private updateFinishedState(taskId: string, status: Extract<TaskStatus, "waiting_approval" | "completed" | "canceled">, replyText: string): Task {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE tasks
          SET status = ?,
              reply_text = ?,
              error_message = NULL,
              updated_at = ?,
              completed_at = CASE WHEN ? IN ('completed', 'canceled') THEN ? ELSE completed_at END
          WHERE id = ?
        `
      )
      .run(status, replyText, now, status, now, taskId);

    return this.requireTask(taskId);
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    return task;
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_input TEXT NOT NULL,
        status TEXT NOT NULL,
        parent_task_id TEXT,
        reply_text TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT,
        approval_id TEXT,
        approval_kind TEXT,
        approval_title TEXT,
        approval_details TEXT,
        artifact_kind TEXT,
        artifact_path TEXT,
        artifact_label TEXT,
        data_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }
}
