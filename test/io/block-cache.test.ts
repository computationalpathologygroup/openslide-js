import { BlockStore } from '../../src/io/block-cache.js';

const BLOCK = 16;

/** fetchRange producing identifiable bytes: value = (start + i) % 256. */
function patternFetch(calls?: Array<[string, number, number]>) {
  return async (fileKey: string, start: number, end: number): Promise<Uint8Array> => {
    calls?.push([fileKey, start, end]);
    const out = new Uint8Array(end - start);
    for (let i = 0; i < out.length; i++) out[i] = (start + i) % 256;
    return out;
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('BlockStore', () => {
  it('fetches the requested range and clamps the last block at EOF', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 1024, readAhead: 0, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 40); // 2.5 blocks

    const b0 = await store.getBlock('f', 0);
    expect(b0.length).toBe(BLOCK);
    expect(calls[0]).toEqual(['f', 0, 16]);

    const b2 = await store.getBlock('f', 2);
    expect(b2.length).toBe(8); // EOF clamp
    expect(calls[1]).toEqual(['f', 32, 40]);
  });

  it('serves repeats from cache without refetching', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 1024, readAhead: 0, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 64);

    await store.getBlock('f', 1);
    await store.getBlock('f', 1);
    expect(calls.length).toBe(1);
  });

  it('dedupes concurrent fetches of the same block', async () => {
    let fetches = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = new BlockStore({
      blockSize: BLOCK,
      maxBytes: 1024,
      readAhead: 0,
      fetchRange: async () => {
        fetches++;
        await gate;
        return new Uint8Array(BLOCK);
      },
    });
    store.setFileSize('f', 64);

    const p1 = store.getBlock('f', 0);
    const p2 = store.getBlock('f', 0);
    release();
    await Promise.all([p1, p2]);
    expect(fetches).toBe(1);
  });

  it('evicts least-recently-used blocks beyond the byte budget', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 2 * BLOCK, readAhead: 0, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 6 * BLOCK);

    await store.getBlock('f', 0);
    await store.getBlock('f', 1);
    await store.getBlock('f', 0); // touch 0 → 1 is now LRU
    await store.getBlock('f', 5); // non-sequential → no read-ahead; evicts block 1
    expect(store.cachedBytes).toBe(2 * BLOCK);

    calls.length = 0;
    await store.getBlock('f', 0); // still cached
    expect(calls.length).toBe(0);
    await store.getBlock('f', 1); // was evicted → refetch
    expect(calls.length).toBe(1);
  });

  it('prefetches ahead on sequential access', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 1024, readAhead: 2, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 10 * BLOCK);

    await store.getBlock('f', 0);
    expect(calls.length).toBe(1); // first access is not "sequential" yet
    await store.getBlock('f', 1);
    await flush();
    // demand block 1 + read-ahead of blocks 2 and 3
    const starts = calls.map(([, s]) => s).sort((a, b) => a - b);
    expect(starts).toEqual([0, 16, 32, 48]);

    calls.length = 0;
    await store.getBlock('f', 2); // already prefetched — no demand fetch …
    expect(calls.some(([, s]) => s === 2 * BLOCK)).toBe(false);
    await flush();
    // … but it extends the read-ahead window (block 4; 3 is already cached).
    expect(calls.map(([, s]) => s)).toEqual([4 * BLOCK]);
  });

  it('does not prefetch past EOF', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 1024, readAhead: 4, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 3 * BLOCK);

    await store.getBlock('f', 1);
    await store.getBlock('f', 2);
    await flush();
    expect(calls.every(([, , end]) => end <= 3 * BLOCK)).toBe(true);
    expect(calls.length).toBe(2); // blocks 1 and 2; no block 3 exists
  });

  it('releaseFile drops the file from the cache', async () => {
    const calls: Array<[string, number, number]> = [];
    const store = new BlockStore({ blockSize: BLOCK, maxBytes: 1024, readAhead: 0, fetchRange: patternFetch(calls) });
    store.setFileSize('f', 64);
    store.setFileSize('g', 64);

    await store.getBlock('f', 0);
    await store.getBlock('g', 0);
    store.releaseFile('f');
    expect(store.cachedBytes).toBe(BLOCK); // only g's block remains

    calls.length = 0;
    await store.getBlock('g', 0);
    expect(calls.length).toBe(0);
  });
});
