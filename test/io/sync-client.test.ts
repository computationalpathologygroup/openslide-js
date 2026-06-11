import { SyncIo, SyncIoError } from '../../src/io/sync-client.js';
import type { WaitFn } from '../../src/io/sync-client.js';
import {
  CTRL_STATUS, CTRL_SEQ, CTRL_BYTES, CTRL_ERRNO,
  HEADER_BYTES, STATUS_PENDING, STATUS_OK, STATUS_ERROR,
  DEFAULT_IO_CONFIG, EIO,
} from '../../src/io/protocol.js';
import type { IoConfig, IoRequest } from '../../src/io/protocol.js';

const BLOCK = 16;

const config: IoConfig = { ...DEFAULT_IO_CONFIG, blockSize: BLOCK, readTimeoutMs: 1000 };

interface PortStub {
  posted: IoRequest[];
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: (msg: IoRequest) => void;
}

function makePort(onPost?: (msg: IoRequest) => void): PortStub {
  const stub: PortStub = {
    posted: [],
    onmessage: null,
    postMessage(msg: IoRequest) {
      stub.posted.push(msg);
      onPost?.(msg);
    },
  };
  return stub;
}

/** Simulates the broker's SAB reply protocol: data → BYTES → SEQ → STATUS. */
function brokerReply(sab: SharedArrayBuffer, seq: number, bytes: Uint8Array, status = STATUS_OK, errno = 0): void {
  const ctrl = new Int32Array(sab, 0, HEADER_BYTES / 4);
  const data = new Uint8Array(sab, HEADER_BYTES);
  data.set(bytes);
  Atomics.store(ctrl, CTRL_BYTES, bytes.length);
  Atomics.store(ctrl, CTRL_ERRNO, errno);
  Atomics.store(ctrl, CTRL_SEQ, seq);
  Atomics.store(ctrl, CTRL_STATUS, status);
}

function makeSab(): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER_BYTES + BLOCK);
}

describe('SyncIo', () => {
  it('reads a block when the broker replies synchronously', () => {
    const sab = makeSab();
    const port = makePort((msg) => {
      if (msg.type === 'read') {
        brokerReply(sab, msg.seq, new Uint8Array([1, 2, 3, 4]));
      }
    });
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    const block = io.readBlockSync('f', 0);
    expect([...block]).toEqual([1, 2, 3, 4]);
    expect(port.posted).toEqual([{ type: 'read', seq: 1, fileKey: 'f', blockIndex: 0 }]);
  });

  it('serves the L1 cache without re-requesting', () => {
    const sab = makeSab();
    const port = makePort((msg) => {
      if (msg.type === 'read') brokerReply(sab, msg.seq, new Uint8Array([9]));
    });
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    io.readBlockSync('f', 3);
    io.readBlockSync('f', 3);
    expect(port.posted.length).toBe(1);
  });

  it('replies via the injected wait when the broker is slower', () => {
    const sab = makeSab();
    const port = makePort();
    let waits = 0;
    const wait: WaitFn = () => {
      waits++;
      // Broker delivers while we are "parked".
      brokerReply(sab, 1, new Uint8Array([7, 8]));
      return 'ok';
    };
    const io = new SyncIo(port as unknown as MessagePort, sab, config, wait);

    const block = io.readBlockSync('f', 0);
    expect([...block]).toEqual([7, 8]);
    expect(waits).toBe(1);
  });

  it('ignores a stale reply and re-arms for the real one', () => {
    const sab = makeSab();
    const port = makePort();
    let calls = 0;
    const wait: WaitFn = () => {
      calls++;
      if (calls === 1) {
        brokerReply(sab, 999, new Uint8Array([0xde, 0xad])); // stale seq
      } else {
        brokerReply(sab, 1, new Uint8Array([42])); // the real reply
      }
      return 'ok';
    };
    const io = new SyncIo(port as unknown as MessagePort, sab, config, wait);

    const block = io.readBlockSync('f', 0);
    expect([...block]).toEqual([42]);
    expect(calls).toBe(2);
  });

  it('throws SyncIoError with the broker errno on error status', () => {
    const sab = makeSab();
    const port = makePort((msg) => {
      if (msg.type === 'read') brokerReply(sab, msg.seq, new Uint8Array(0), STATUS_ERROR, EIO);
    });
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    expect(() => io.readBlockSync('f', 0)).toThrow(SyncIoError);
    try {
      io.readBlockSync('f', 1);
    } catch (err) {
      expect((err as SyncIoError).errno).toBe(EIO);
    }
  });

  it('times out with EIO when the broker never replies', () => {
    const sab = makeSab();
    const port = makePort();
    const wait: WaitFn = () => 'timed-out';
    const io = new SyncIo(port as unknown as MessagePort, sab, { ...config, readTimeoutMs: 1 }, wait);

    const start = Date.now();
    while (Date.now() - start < 5) { /* let the 1ms deadline lapse */ }
    expect(() => io.readBlockSync('f', 0)).toThrow(SyncIoError);
  });

  it('readInto assembles multi-block ranges and clamps at EOF', () => {
    const sab = makeSab();
    const fileSize = 40; // blocks: 16 + 16 + 8
    const port = makePort((msg) => {
      if (msg.type !== 'read') return;
      const start = msg.blockIndex * BLOCK;
      const len = Math.min(BLOCK, fileSize - start);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (start + i) % 256;
      brokerReply(sab, msg.seq, bytes);
    });
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    // Read 20 bytes from position 10: spans blocks 0 and 1.
    const out = new Uint8Array(64);
    const n = io.readInto('f', fileSize, 10, 20, out, 4);
    expect(n).toBe(20);
    for (let i = 0; i < 20; i++) expect(out[4 + i]).toBe(10 + i);

    // Read past EOF: clamps.
    const n2 = io.readInto('f', fileSize, 35, 100, out, 0);
    expect(n2).toBe(5);
    for (let i = 0; i < 5; i++) expect(out[i]).toBe(35 + i);
  });

  it('resolves registerUrl through the rpc reply path', async () => {
    const sab = makeSab();
    const port = makePort();
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    const promise = io.registerUrl('url:x', 'https://x/slide.svs');
    expect(port.posted[0]).toEqual({ type: 'register-url', rpcId: 1, fileKey: 'url:x', url: 'https://x/slide.svs' });

    port.onmessage!({ data: { type: 'rpc', rpcId: 1, ok: true, size: 12345 } });
    await expect(promise).resolves.toBe(12345);
  });

  it('rejects registerUrl on rpc error', async () => {
    const sab = makeSab();
    const port = makePort();
    const io = new SyncIo(port as unknown as MessagePort, sab, config);

    const promise = io.registerUrl('url:x', 'https://x/slide.svs');
    port.onmessage!({ data: { type: 'rpc', rpcId: 1, ok: false, error: 'HTTP 404' } });
    await expect(promise).rejects.toThrow('HTTP 404');
  });
});
