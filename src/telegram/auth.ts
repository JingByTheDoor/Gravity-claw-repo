export interface AuthorizedChatRef {
  id: number | string | bigint;
  type?: string;
}

export function isAuthorizedUser(userId: number | undefined, allowedUserId: string): boolean {
  return userId !== undefined && String(userId) === allowedUserId;
}

export function isAuthorizedChat(
  chat: AuthorizedChatRef | undefined,
  allowedChatIds: string[]
): boolean {
  if (!chat || chat.type !== "private") {
    return false;
  }

  const chatId = String(chat.id);
  return allowedChatIds.length === 0 || allowedChatIds.includes(chatId);
}

export function isAuthorizedContext(
  userId: number | undefined,
  allowedUserId: string,
  chat: AuthorizedChatRef | undefined,
  allowedChatIds: string[]
): boolean {
  return isAuthorizedUser(userId, allowedUserId) && isAuthorizedChat(chat, allowedChatIds);
}
