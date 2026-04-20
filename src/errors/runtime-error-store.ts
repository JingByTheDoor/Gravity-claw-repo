import Database from "better-sqlite3";
import path from "node:path";

const SECRET_PATTERN = /((api[_ -]?key|token|secret|password|authorization)\s*[=:]\s*)([^\s,;]+)/gi;

export interface RuntimeErrorEntry {
  chatId: string;
  scope: string;
  message: string;
  createdAt: string;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(SECRET_PATTERN, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function toDatabasePath(databasePath: string): string {
  return databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
}

export class RuntimeErrorStore {
  private readonly database: Database.Database;

  constructor(databasePath = ":memory:") {
    this.database = new Database(toDatabasePath(databasePath));
    this.database.pragma("journal_mode = WAL");
    this.createSchema();
  }

  close(): void {
    this.database.close();
  }

  record(chatId: string, scope: string, message: string): RuntimeErrorEntry {
    const entry: RuntimeErrorEntry = {
      chatId,
      scope,
      message: sanitizeErrorMessage(message),
      createdAt: new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO runtime_errors (chat_id, scope, message, created_at)
          VALUES (?, ?, ?, ?)
        `
      )
      .run(entry.chatId, entry.scope, entry.message, entry.createdAt);

    return entry;
  }

  getLast(chatId: string): RuntimeErrorEntry | undefined {
    return this.database
      .prepare(
        `
          SELECT chat_id AS chatId, scope, message, created_at AS createdAt
          FROM runtime_errors
          WHERE chat_id = ?
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get(chatId) as RuntimeErrorEntry | undefined;
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}
