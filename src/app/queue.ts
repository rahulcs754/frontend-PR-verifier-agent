/**
 * Runs jobs one at a time. Browser runs are heavy, and running them in
 * parallel would also skew load-time comparisons. Jobs with the same key
 * that are still waiting are dropped (e.g. two "ready" events for one commit).
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly waiting = new Set<string>();
  private running = 0;

  constructor(private readonly onError: (err: unknown) => void = () => {}) {}

  /** Returns false when an identical job is already waiting. */
  push(key: string, job: () => Promise<unknown>): boolean {
    if (this.waiting.has(key)) return false;
    this.waiting.add(key);
    this.tail = this.tail.then(async () => {
      this.waiting.delete(key);
      this.running++;
      try {
        await job();
      } catch (err) {
        this.onError(err);
      } finally {
        this.running--;
      }
    });
    return true;
  }

  get size(): number {
    return this.waiting.size + this.running;
  }

  /** Resolves when everything queued so far has finished. */
  idle(): Promise<void> {
    return this.tail;
  }
}
