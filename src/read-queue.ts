/**
 * read-queue.ts
 *
 * FIFO concurrency limiter for readRegion calls inside a worker. Caps how
 * many reads hold WASM result buffers at once (memory exhaustion guard) and
 * lets still-queued reads be cancelled before they start executing.
 */

/** Rejection used when a queued read is cancelled before it runs. */
export class ReadCancelledError extends Error {
  readonly code = 'cancelled';

  constructor() {
    super('cancelled');
    this.name = 'ReadCancelledError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface Waiter {
  id: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class ReadQueue {
  private readonly maxConcurrent: number;
  private active = 0;
  private waiters: Waiter[] = [];

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  /**
   * Wait for a read slot. Resolves when the caller may start the read;
   * rejects with ReadCancelledError if cancelled while still queued.
   */
  acquire(id: number): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ id, resolve, reject });
    });
  }

  /** Release a slot acquired via acquire(). */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve();
    } else {
      this.active--;
    }
  }

  /**
   * Cancel a read that is still waiting for a slot. Returns true if the
   * entry was found and rejected; false if it already started (or finished).
   */
  cancel(id: number): boolean {
    const idx = this.waiters.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    const [waiter] = this.waiters.splice(idx, 1);
    waiter.reject(new ReadCancelledError());
    return true;
  }
}
