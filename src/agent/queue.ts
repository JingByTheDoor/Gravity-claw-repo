export class ChatTaskQueue {
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly activeRuns = new Set<string>();
  private readonly steeringMessages = new Map<string, string[]>();

  run<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(chatId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const settled = next.finally(() => {
      if (this.lanes.get(chatId) === settled) {
        this.lanes.delete(chatId);
      }
    });

    this.lanes.set(chatId, settled);
    return next;
  }

  beginActiveRun(chatId: string): void {
    if (this.activeRuns.has(chatId)) {
      throw new Error(`An active run is already registered for chat ${chatId}.`);
    }

    this.activeRuns.add(chatId);
    this.steeringMessages.delete(chatId);
  }

  endActiveRun(chatId: string): void {
    this.activeRuns.delete(chatId);
    this.steeringMessages.delete(chatId);
  }

  isActiveRun(chatId: string): boolean {
    return this.activeRuns.has(chatId);
  }

  captureSteeringMessage(chatId: string, message: string): boolean {
    if (!this.activeRuns.has(chatId)) {
      return false;
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return false;
    }

    const existingMessages = this.steeringMessages.get(chatId) ?? [];
    existingMessages.push(trimmedMessage);
    this.steeringMessages.set(chatId, existingMessages);
    return true;
  }

  consumeSteeringMessages(chatId: string): string[] {
    const messages = this.steeringMessages.get(chatId);
    if (!messages || messages.length === 0) {
      return [];
    }

    this.steeringMessages.delete(chatId);
    return [...messages];
  }
}
