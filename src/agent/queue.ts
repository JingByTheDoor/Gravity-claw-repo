export class ChatTaskQueue {
  private readonly lanes = new Map<string, Promise<unknown>>();

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
}
