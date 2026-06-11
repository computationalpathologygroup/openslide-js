import { ReadQueue, ReadCancelledError } from '../src/read-queue.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ReadQueue', () => {
  it('grants slots immediately up to the limit', async () => {
    const q = new ReadQueue(2);
    await q.acquire(1);
    await q.acquire(2);
    // Both resolved without releases — no assertion needed beyond not hanging.
  });

  it('queues beyond the limit and resumes FIFO on release', async () => {
    const q = new ReadQueue(1);
    await q.acquire(1);

    const order: number[] = [];
    const p2 = q.acquire(2).then(() => order.push(2));
    const p3 = q.acquire(3).then(() => order.push(3));

    await tick();
    expect(order).toEqual([]);

    q.release();
    await p2;
    expect(order).toEqual([2]);

    q.release();
    await p3;
    expect(order).toEqual([2, 3]);
  });

  it('cancels a queued entry', async () => {
    const q = new ReadQueue(1);
    await q.acquire(1);

    const p2 = q.acquire(2);
    expect(q.cancel(2)).toBe(true);
    await expect(p2).rejects.toThrow(ReadCancelledError);

    // Cancelled entry must not consume the slot handed over on release.
    const p3 = q.acquire(3);
    q.release();
    await expect(p3).resolves.toBeUndefined();
  });

  it('returns false when cancelling a running or unknown id', async () => {
    const q = new ReadQueue(1);
    await q.acquire(1);
    expect(q.cancel(1)).toBe(false); // already running
    expect(q.cancel(99)).toBe(false); // never seen
  });

  it('tags cancellations with code "cancelled"', async () => {
    const q = new ReadQueue(1);
    await q.acquire(1);
    const p2 = q.acquire(2);
    q.cancel(2);
    await p2.catch((err: ReadCancelledError) => {
      expect(err.code).toBe('cancelled');
    });
  });
});
