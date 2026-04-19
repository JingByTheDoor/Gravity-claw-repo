import Database from "better-sqlite3";
import path from "node:path";
import type { AgentMessage } from "../agent/types.js";
import type { LLMClient } from "../llm/client.js";
import type { Logger } from "../logging/logger.js";

interface MessageRow {
  id: number;
  role: AgentMessage["role"];
  content: string;
}

export interface MemoryFact {
  key: string;
  value: string;
}

export interface MemoryPromptContext {
  coreFacts: MemoryFact[];
  latestSummary?: string;
  recentMessages: AgentMessage[];
}

interface MemorySearchResult {
  coreFacts: MemoryFact[];
  latestSummary?: string;
  messageMatches: Array<{
    role: string;
    content: string;
    createdAt: string;
  }>;
}

export interface MemoryStoreLike {
  getPromptContext(chatId: string, recentLimit: number): MemoryPromptContext;
  rememberFact(chatId: string, key: string, value: string): MemoryFact;
  listFacts(chatId: string): MemoryFact[];
  saveConversationTurn(chatId: string, userInput: string, assistantReply: string): void;
  compactConversation(chatId: string, llmClient: LLMClient): Promise<void>;
  resetConversation(chatId: string): void;
}

const COMPACTION_TRIGGER_COUNT = 30;
const COMPACTION_KEEP_COUNT = 20;

function toAbsoluteDatabasePath(databasePath: string): string {
  return path.isAbsolute(databasePath) ? databasePath : path.resolve(databasePath);
}

function buildFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, "").trim())
    .filter((term) => term.length > 0);

  return terms.map((term) => `"${term}"`).join(" OR ");
}

export class MemoryStore implements MemoryStoreLike {
  private readonly database: Database.Database;

  constructor(
    databasePath: string,
    private readonly logger: Logger
  ) {
    const resolvedPath = toAbsoluteDatabasePath(databasePath);
    this.database = new Database(resolvedPath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.createSchema();
    this.logger.info("memory.db.ready", { databasePath: resolvedPath });
  }

  close(): void {
    this.database.close();
  }

  getPromptContext(chatId: string, recentLimit: number): MemoryPromptContext {
    const coreFacts = this.listFacts(chatId);
    const latestSummary = this.getLatestSummary(chatId);
    const recentMessages = this.database
      .prepare(
        `
          SELECT role, content
          FROM messages
          WHERE chat_id = ?
            AND role IN ('user', 'assistant')
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(chatId, recentLimit) as Array<{ role: AgentMessage["role"]; content: string }>;

    return {
      coreFacts,
      ...(latestSummary ? { latestSummary } : {}),
      recentMessages: recentMessages.reverse().map((message) => ({
        role: message.role,
        content: message.content
      }))
    };
  }

  rememberFact(chatId: string, key: string, value: string): MemoryFact {
    this.database
      .prepare(
        `
          INSERT INTO core_memory (chat_id, key, value, created_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(chat_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        `
      )
      .run(chatId, key, value);

    return { key, value };
  }

  listFacts(chatId: string): MemoryFact[] {
    return this.database
      .prepare(
        `
          SELECT key, value
          FROM core_memory
          WHERE chat_id = ?
          ORDER BY updated_at DESC, key ASC
        `
      )
      .all(chatId) as MemoryFact[];
  }

  recallMemory(chatId: string, query: string, limit = 5): MemorySearchResult {
    const trimmedQuery = query.trim();
    const latestSummary = this.getLatestSummary(chatId);

    const coreFacts = trimmedQuery
      ? (this.database
          .prepare(
            `
              SELECT key, value
              FROM core_memory
              WHERE chat_id = ?
                AND (key LIKE ? OR value LIKE ?)
              ORDER BY updated_at DESC
              LIMIT ?
            `
          )
          .all(chatId, `%${trimmedQuery}%`, `%${trimmedQuery}%`, limit) as MemoryFact[])
      : this.listFacts(chatId).slice(0, limit);

    let messageMatches: MemorySearchResult["messageMatches"] = [];
    const ftsQuery = buildFtsQuery(trimmedQuery);
    if (ftsQuery) {
      messageMatches = this.database
        .prepare(
          `
            SELECT messages.role, messages.content, messages.created_at AS createdAt
            FROM messages_fts
            JOIN messages ON messages_fts.rowid = messages.id
            WHERE messages.chat_id = ?
              AND messages.role IN ('user', 'assistant')
              AND messages_fts MATCH ?
            ORDER BY bm25(messages_fts), messages.id DESC
            LIMIT ?
          `
        )
        .all(chatId, ftsQuery, limit) as MemorySearchResult["messageMatches"];
    }

    return {
      coreFacts,
      ...(latestSummary ? { latestSummary } : {}),
      messageMatches
    };
  }

  saveConversationTurn(chatId: string, userInput: string, assistantReply: string): void {
    const transaction = this.database.transaction(() => {
      this.insertMessage(chatId, "user", userInput);
      this.insertMessage(chatId, "assistant", assistantReply);
    });

    transaction();
  }

  resetConversation(chatId: string): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare(`DELETE FROM summaries WHERE chat_id = ?`).run(chatId);
      this.database.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
    });

    transaction();
    this.logger.info("memory.conversation.reset", { chatId });
  }

  async compactConversation(chatId: string, llmClient: LLMClient): Promise<void> {
    const conversationCount = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM messages
          WHERE chat_id = ?
            AND role IN ('user', 'assistant')
        `
      )
      .get(chatId) as { count: number };

    if (conversationCount.count <= COMPACTION_TRIGGER_COUNT) {
      return;
    }

    const rowsToCompact = this.database
      .prepare(
        `
          SELECT id, role, content
          FROM messages
          WHERE chat_id = ?
            AND role IN ('user', 'assistant')
          ORDER BY id ASC
          LIMIT ?
        `
      )
      .all(chatId, conversationCount.count - COMPACTION_KEEP_COUNT) as MessageRow[];

    if (rowsToCompact.length === 0) {
      return;
    }

    const previousSummary = this.getLatestSummary(chatId);
    const transcript = rowsToCompact
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n");

    const response = await llmClient.runStep({
      messages: [
        {
          role: "system",
          content:
            "Summarize older conversation context. Keep durable facts, preferences, decisions, ongoing tasks, and unresolved items. Plain text only. Six bullets max."
        },
        {
          role: "user",
          content: `Existing summary:\n${previousSummary ?? "None"}\n\nOlder transcript:\n${transcript}`
        }
      ],
      tools: []
    });

    const newSummary = response.message.content.trim() || previousSummary || "No summary available.";
    const deleteIds = rowsToCompact.map((row) => row.id);

    const transaction = this.database.transaction(() => {
      this.database.prepare(`DELETE FROM summaries WHERE chat_id = ?`).run(chatId);
      this.database
        .prepare(
          `
            INSERT INTO summaries (chat_id, summary, created_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
          `
        )
        .run(chatId, newSummary);

      const deleteStatement = this.database.prepare(`DELETE FROM messages WHERE id = ?`);
      for (const id of deleteIds) {
        deleteStatement.run(id);
      }
    });

    transaction();
    this.logger.info("memory.compaction.complete", {
      chatId,
      compactedMessages: deleteIds.length
    });
  }

  private insertMessage(chatId: string, role: AgentMessage["role"], content: string): void {
    this.database
      .prepare(
        `
          INSERT INTO messages (chat_id, role, content, created_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `
      )
      .run(chatId, role, content);
  }

  private getLatestSummary(chatId: string): string | undefined {
    const row = this.database
      .prepare(
        `
          SELECT summary
          FROM summaries
          WHERE chat_id = ?
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get(chatId) as { summary: string } | undefined;

    return row?.summary;
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS core_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, key)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        chat_id UNINDEXED,
        role UNINDEXED,
        content='messages',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, chat_id, role)
        VALUES (new.id, new.content, new.chat_id, new.role);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, chat_id, role)
        VALUES ('delete', old.id, old.content, old.chat_id, old.role);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, chat_id, role)
        VALUES ('delete', old.id, old.content, old.chat_id, old.role);
        INSERT INTO messages_fts(rowid, content, chat_id, role)
        VALUES (new.id, new.content, new.chat_id, new.role);
      END;
    `);
  }
}
