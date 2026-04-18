import type { ChatTaskQueue } from "../agent/queue.js";
import type { Logger } from "../logging/logger.js";
import { isAuthorizedUser } from "./auth.js";

export const TEXT_ONLY_MESSAGE = "Level 1 supports text messages only.";

interface MessageContext {
  from?: { id: number };
  chat?: { id: number | string | bigint };
  message?: {
    message_id?: number;
    text?: string;
  };
  api: {
    sendChatAction(chatId: number | string | bigint, action: "typing"): Promise<unknown>;
  };
  reply(text: string): Promise<unknown>;
}

interface MessageHandlerDependencies {
  allowedUserId: string;
  agentLoop: {
    run(userInput: string): Promise<string>;
  };
  queue: ChatTaskQueue;
  logger: Logger;
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

      dependencies.logger.info("telegram.message.received", {
        chatId,
        userId: String(context.from?.id)
      });

      await context.api.sendChatAction(chat.id, "typing");
      const replyText = await dependencies.agentLoop.run(context.message.text);
      await context.reply(replyText);

      dependencies.logger.info("telegram.message.replied", {
        chatId,
        userId: String(context.from?.id)
      });
    });
  };
}
