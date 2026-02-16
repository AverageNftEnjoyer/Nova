import { acquireLock } from "../session/lock.js";

type QueueProcessor = (sessionKey: string, message: string, signal: AbortSignal) => Promise<string>;

export class AgentMessageQueue {
  private readonly tails = new Map<string, Promise<string>>();
  private readonly controllers = new Map<string, AbortController>();
  private processor: QueueProcessor;

  public constructor(processor?: QueueProcessor) {
    this.processor =
      processor ??
      (async () => {
        throw new Error("Queue processor is not configured.");
      });
  }

  public setProcessor(processor: QueueProcessor): void {
    this.processor = processor;
  }

  public async queueMessage(sessionKey: string, message: string): Promise<string> {
    const tail = this.tails.get(sessionKey) ?? Promise.resolve("");
    const run = async () => {
      const controller = new AbortController();
      this.controllers.set(sessionKey, controller);
      const release = await acquireLock(sessionKey);
      try {
        return await this.processor(sessionKey, message, controller.signal);
      } finally {
        release();
        this.controllers.delete(sessionKey);
      }
    };

    const next = tail.then(run, run);
    this.tails.set(sessionKey, next.finally(() => {
      if (this.tails.get(sessionKey) === next) {
        this.tails.delete(sessionKey);
      }
    }) as Promise<string>);

    return next;
  }

  public abortRun(sessionKey: string): void {
    this.controllers.get(sessionKey)?.abort();
  }

  public isRunActive(sessionKey: string): boolean {
    return this.controllers.has(sessionKey);
  }
}
