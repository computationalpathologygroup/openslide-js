import { IoBroker } from '../../src/io/broker.js';
import {
  CTRL_STATUS, CTRL_SEQ, CTRL_BYTES,
  HEADER_BYTES, STATUS_OK, STATUS_ERROR, STATUS_PENDING,
  DEFAULT_IO_CONFIG,
} from '../../src/io/protocol.js';
import type { IoConfig, IoReply } from '../../src/io/protocol.js';

const BLOCK = 16;
const config: IoConfig = { ...DEFAULT_IO_CONFIG, blockSize: BLOCK, readAhead: 0 };

interface PortStub {
  sent: IoReply[];
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: (msg: IoReply) => void;
}

function makeChannel(broker: IoBroker) {
  const port: PortStub = {
    sent: [],
    onmessage: null,
    postMessage(msg: IoReply) { port.sent.push(msg); },
  };
  const sab = new SharedArrayBuffer(HEADER_BYTES + BLOCK);
  broker.attachChannel(port as unknown as MessagePort, sab);
  const ctrl = new Int32Array(sab, 0, HEADER_BYTES / 4);
  const data = new Uint8Array(sab, HEADER_BYTES);
  const send = (msg: unknown) => port.onmessage!({ data: msg });
  return { port, ctrl, data, send };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Waits until the channel status leaves PENDING (replies are async). */
async function awaitStatus(ctrl: Int32Array): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const s = Atomics.load(ctrl, CTRL_STATUS);
    if (s !== STATUS_PENDING) return s;
    await flush();
  }
  throw new Error('broker never replied');
}

function fakeFile(bytes: Uint8Array): File {
  // Node 20 has File; slice().arrayBuffer() is what the broker uses.
  return new File([bytes.buffer as ArrayBuffer], 'fake.svs');
}

describe('IoBroker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves registered local files block-wise through the SAB', async () => {
    const broker = new IoBroker(config);
    const { ctrl, data, send } = makeChannel(broker);

    const bytes = new Uint8Array(40);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    send({ type: 'register-files', files: [{ fileKey: 'f', file: fakeFile(bytes), size: bytes.length }] });

    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 1, fileKey: 'f', blockIndex: 2 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_OK);
    expect(Atomics.load(ctrl, CTRL_SEQ)).toBe(1);
    expect(Atomics.load(ctrl, CTRL_BYTES)).toBe(8); // EOF clamp: 40 - 32
    expect([...data.subarray(0, 8)]).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
  });

  it('reports errors for unknown files via STATUS_ERROR', async () => {
    const broker = new IoBroker(config);
    const { ctrl, send } = makeChannel(broker);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 1, fileKey: 'nope', blockIndex: 0 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_ERROR);
  });

  it('drops replies for abandoned reads (newer seq seen)', async () => {
    const broker = new IoBroker(config);
    const { ctrl, data, send } = makeChannel(broker);

    const bytes = new Uint8Array(2 * BLOCK).fill(7);
    send({ type: 'register-files', files: [{ fileKey: 'f', file: fakeFile(bytes), size: bytes.length }] });

    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 1, fileKey: 'f', blockIndex: 0 });
    send({ type: 'read', seq: 2, fileKey: 'f', blockIndex: 1 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_OK);
    await flush();
    // Only the latest request may write the SAB.
    expect(Atomics.load(ctrl, CTRL_SEQ)).toBe(2);
    expect(data[0]).toBe(7);
  });

  it('stats URLs via a range probe and answers the rpc with the size', async () => {
    const broker = new IoBroker(config);
    const { port, send } = makeChannel(broker);

    global.fetch = jest.fn().mockResolvedValue({
      status: 206,
      ok: true,
      headers: new Map([['Content-Range', 'bytes 0-0/123456']]) as unknown as Headers,
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Response);

    send({ type: 'register-url', rpcId: 1, fileKey: 'url:x', url: 'https://x/s.svs' });
    await flush();
    expect(port.sent[0]).toEqual({ type: 'rpc', rpcId: 1, ok: true, size: 123456 });
    expect(global.fetch).toHaveBeenCalledWith('https://x/s.svs', { headers: { Range: 'bytes=0-0' } });
  });

  it('buffers the whole body when the server ignores Range', async () => {
    const broker = new IoBroker(config);
    const { port, ctrl, data, send } = makeChannel(broker);

    const body = new Uint8Array(24);
    for (let i = 0; i < body.length; i++) body[i] = 100 + i;
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map() as unknown as Headers,
      arrayBuffer: () => Promise.resolve(body.buffer.slice(0)),
    } as unknown as Response);

    send({ type: 'register-url', rpcId: 1, fileKey: 'url:x', url: 'https://x/s.svs' });
    await flush();
    expect(port.sent[0]).toEqual({ type: 'rpc', rpcId: 1, ok: true, size: 24 });

    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 1, fileKey: 'url:x', blockIndex: 1 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_OK);
    expect(Atomics.load(ctrl, CTRL_BYTES)).toBe(8);
    expect([...data.subarray(0, 8)]).toEqual([116, 117, 118, 119, 120, 121, 122, 123]);
    // No further network call for the read itself.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('release drops a file once its refcount reaches zero', async () => {
    const broker = new IoBroker(config);
    const { ctrl, send } = makeChannel(broker);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const bytes = new Uint8Array(BLOCK).fill(1);
    // Registered twice (e.g. two workers) …
    send({ type: 'register-files', files: [{ fileKey: 'f', file: fakeFile(bytes), size: bytes.length }] });
    send({ type: 'register-files', files: [{ fileKey: 'f', file: fakeFile(bytes), size: bytes.length }] });

    send({ type: 'release', fileKeys: ['f'] });
    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 1, fileKey: 'f', blockIndex: 0 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_OK); // still registered (1 ref left)

    send({ type: 'release', fileKeys: ['f'] });
    Atomics.store(ctrl, CTRL_STATUS, STATUS_PENDING);
    send({ type: 'read', seq: 2, fileKey: 'f', blockIndex: 0 });
    expect(await awaitStatus(ctrl)).toBe(STATUS_ERROR); // gone
  });
});
