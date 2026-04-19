import fs from "node:fs/promises";
import { InputFile } from "grammy";
import type { AgentRunResult } from "../agent/loop.js";
import type { ChatTaskQueue } from "../agent/queue.js";
import type { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import type { MemoryStoreLike } from "../memory/store.js";
import type { ShellRunner } from "../tools/shell-runner.js";
import { describeAccessiblePath, type PathAccessPolicy } from "../tools/workspace.js";
import { isAuthorizedUser } from "./auth.js";

export const TEXT_ONLY_MESSAGE = "Level 1 supports text messages only.";
export const NEW_CHAT_MESSAGE =
  "Started a new chat. I kept your durable memory facts and cleared recent conversation history.";

function isNewCommand(text: string): boolean {
  return /^\/new(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isApproveCommand(text: string): boolean {
  return /^\/approve(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function isDenyCommand(text: string): boolean {
  return /^\/deny(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}

function parseCommandArgument(text: string): string | undefined {
  const [, argument] = text.trim().split(/\s+/, 2);
  return argument?.trim() || undefined;
}

interface MessageContext {
  from?: { id: number };
  chat?: { id: number | string | bigint };
  message?: {
    message_id?: number;
    text?: string;
  };
  api: {
    sendChatAction(chatId: number | string | bigint, action: "typing"): Promise<unknown>;
    sendPhoto?(
      chatId: number | string | bigint,
      photo: unknown,
      other?: { caption?: string }
    ): Promise<unknown>;
  };
  reply(text: string): Promise<unknown>;
}

interface CommandContext {
  from?: { id: number } | undefined;
  chat?: { id: number | string | bigint } | undefined;
  reply(text: string): Promise<unknown>;
}

interface MessageHandlerDependencies {
  allowedUserId: string;
  agentLoop: {
    run(chatId: string, userInput: string): Promise<AgentRunResult>;
  };
  queue: ChatTaskQueue;
  logger: Logger;
}

async function sendImageAttachments(
  context: MessageContext,
  chatId: number | string | bigint,
  result: AgentRunResult,
  logger: Logger,
  internalChatId: string
): Promise<void> {
  if (!context.api.sendPhoto || result.attachments.length === 0) {
    return;
  }

  for (const attachment of result.attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    try {
      await fs.stat(attachment.path);
      await context.api.sendPhoto(chatId, new InputFile(attachment.path));
    } catch (error) {
      logger.warn("telegram.message.attachment_failed", {
        chatId: internalChatId,
        attachmentPath: attachment.path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function createMessageHandler(dependencies: MessageHandlerDependencies) {
  return async (context: MessageContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat || !context.message) {
      return;
    }

    const chatId = String(context.chat.id);
    const chat = context.chat;

    await dependencies.queue.run(chatId, async () => {
      if (typeof context.message?.text !== "string" || context.message.text.trim().length === 0) {
        await context.reply(TEXT_ONLY_MESSAGE);
        return;
      }

      if (
        isNewCommand(context.message.text) ||
        isApproveCommand(context.message.text) ||
        isDenyCommand(context.message.text)
      ) {
        return;
      }

      dependencies.logger.info("telegram.message.received", {
        chatId,
        userId: String(context.from?.id)
      });

      await context.api.sendChatAction(chat.id, "typing");
      const agentResult = await dependencies.agentLoop.run(chatId, context.message.text);
      await context.reply(agentResult.replyText);
      await sendImageAttachments(context, chat.id, agentResult, dependencies.logger, chatId);

      dependencies.logger.info("telegram.message.replied", {
        chatId,
        userId: String(context.from?.id)
      });
    });
  };
}

interface NewCommandDependencies {
  allowedUserId: string;
  memoryStore: MemoryStoreLike;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createNewCommandHandler(dependencies: NewCommandDependencies) {
  return async (context: CommandContext): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      dependencies.memoryStore.resetConversation(chatId);
      dependencies.logger.info("telegram.command.new", {
        chatId,
        userId: String(context.from?.id)
      });
      await context.reply(NEW_CHAT_MESSAGE);
    });
  };
}

interface ApprovalCommandDependencies {
  allowedUserId: string;
  approvalStore: ApprovalStore;
  shellRunner: ShellRunner;
  pathAccessPolicy: PathAccessPolicy;
  queue: ChatTaskQueue;
  logger: Logger;
}

export function createApproveCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const approvalId = rawArgument ? parseCommandArgument(`/approve ${rawArgument}`) : undefined;
      const approval = dependencies.approvalStore.consume(chatId, approvalId);

      if (!approval) {
        await context.reply("No pending approval found for this chat.");
        return;
      }

      dependencies.logger.info("telegram.command.approve", {
        chatId,
        approvalId: approval.id
      });

      const result = await dependencies.shellRunner.executeApproval(approval);
      const cwd = describeAccessiblePath(dependencies.pathAccessPolicy, approval.cwd);
      const replyLines = [
        `Approved command ${approval.id}.`,
        `cwd: ${cwd}`,
        `exitCode: ${String(result.exitCode ?? "null")}`
      ];

      if (result.stdout) {
        replyLines.push(`stdout:\n${result.stdout}`);
      }

      if (result.stderr) {
        replyLines.push(`stderr:\n${result.stderr}`);
      }

      await context.reply(replyLines.join("\n"));
    });
  };
}

export function createDenyCommandHandler(dependencies: ApprovalCommandDependencies) {
  return async (context: CommandContext, rawArgument?: string): Promise<void> => {
    if (!context.from || !isAuthorizedUser(context.from.id, dependencies.allowedUserId)) {
      return;
    }

    if (!context.chat) {
      return;
    }

    const chatId = String(context.chat.id);
    await dependencies.queue.run(chatId, async () => {
      const approvalId = rawArgument ? parseCommandArgument(`/deny ${rawArgument}`) : undefined;
      const approval = dependencies.approvalStore.deny(chatId, approvalId);

      if (!approval) {
        await context.reply("No pending approval found for this chat.");
        return;
      }

      dependencies.logger.info("telegram.command.deny", {
        chatId,
        approvalId: approval.id
      });

      await context.reply(`Denied command ${approval.id}.`);
    });
  };
}
