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

export class RuntimeErrorStore {
  private readonly errorsByChat = new Map<string, RuntimeErrorEntry>();

  record(chatId: string, scope: string, message: string): RuntimeErrorEntry {
    const entry: RuntimeErrorEntry = {
      chatId,
      scope,
      message: sanitizeErrorMessage(message),
      createdAt: new Date().toISOString()
    };

    this.errorsByChat.set(chatId, entry);
    return entry;
  }

  getLast(chatId: string): RuntimeErrorEntry | undefined {
    return this.errorsByChat.get(chatId);
  }
}
