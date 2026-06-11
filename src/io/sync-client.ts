/**
 * io/sync-client.ts
 *
 * Decode-worker side of the broker channel. The synchronous read path is
 * called from inside an Emscripten FS stream_ops.read while the WASM call is
 * on the stack: the thread posts a request message (delivery does not need
 * this thread's event loop) and parks in Atomics.wait until the broker
 * fills the SAB. Async RPCs (registration) are only used while unblocked.
 */

import {
  CTRL_STATUS, CTRL_SEQ, CTRL_BYTES, CTRL_ERRNO,
  HEADER_BYTES, STATUS_PENDING, STATUS_ERROR, EIO,
} from './protocol.js';
import type { IoConfig, IoReply } from './protocol.js';

/** Error carrying an Emscripten-compatible errno for the FS layer. */
export class SyncIoError extends Error {
  constructor(readonly errno: number, message: string) {
    super(message);
    this.name = 'SyncIoError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Injectable so the blocking state machine is unit-testable in Node. */
export type WaitFn = (ctrl: Int32Array, index: number, value: number, timeoutMs: number) =>
  'ok' | 'not-equal' | 'timed-out';

const atomicsWait: WaitFn = (ctrl, index, value, timeoutMs) =>
  Atomics.wait(ctrl, index, value, timeoutMs);

interface PendingRpc {
  resolve: (size: number) => void;
  reject: (err: Error) => void;
}

/** Blocks the tiny L1 holds; its job is making the thousands of small
 *  sequential header reads OpenSlide issues free, not bulk caching. */
const L1_MAX_BLOCKS = 8;

export class SyncIo {
  private readonly port: MessagePort;
  private readonly config: IoConfig;
  private readonly wait: WaitFn;
  private readonly ctrl: Int32Array;
  private readonly data: Uint8Array;
  private seq = 0;
  private rpcId = 0;
  private pendingRpcs = new Map<number, PendingRpc>();
  /** Per-worker L1 block cache (LRU via Map insertion order). */
  private l1 = new Map<string, Uint8Array>();

  constructor(port: MessagePort, sab: SharedArrayBuffer, config: IoConfig, wait: WaitFn = atomicsWait) {
    this.port = port;
    this.config = config;
    this.wait = wait;
    this.ctrl = new Int32Array(sab, 0, HEADER_BYTES / 4);
    this.data = new Uint8Array(sab, HEADER_BYTES);
    port.onmessage = (e: MessageEvent<IoReply>) => this.onReply(e.data);
  }

  get blockSize(): number {
    return this.config.blockSize;
  }

  /** Register a remote URL with the broker; resolves with the file size. */
  registerUrl(fileKey: string, url: string): Promise<number> {
    const rpcId = ++this.rpcId;
    return new Promise<number>((resolve, reject) => {
      this.pendingRpcs.set(rpcId, { resolve, reject });
      this.port.postMessage({ type: 'register-url', rpcId, fileKey, url });
    });
  }

  /**
   * Hand local Files to the broker. Fire-and-forget: port messages are
   * delivered in order, so the registration always precedes the first read.
   */
  registerFiles(files: Array<{ fileKey: string; file: File; size: number }>): void {
    this.port.postMessage({ type: 'register-files', files });
  }

  /** Drop the broker's references and cache for these files. */
  release(fileKeys: string[]): void {
    this.port.postMessage({ type: 'release', fileKeys });
  }

  /**
   * Synchronously read one block. Must only be called while this thread may
   * block (i.e. from inside an FS read) — no awaits anywhere on this path.
   */
  readBlockSync(fileKey: string, blockIndex: number): Uint8Array {
    const key = `${fileKey}:${blockIndex}`;
    const hit = this.l1.get(key);
    if (hit) {
      this.l1.delete(key);
      this.l1.set(key, hit);
      return hit;
    }

    const seq = ++this.seq;
    Atomics.store(this.ctrl, CTRL_STATUS, STATUS_PENDING);
    this.port.postMessage({ type: 'read', seq, fileKey, blockIndex });

    const deadline = Date.now() + this.config.readTimeoutMs;
    for (;;) {
      const status = Atomics.load(this.ctrl, CTRL_STATUS);
      if (status === STATUS_PENDING) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new SyncIoError(EIO, `broker read timed out after ${this.config.readTimeoutMs}ms`);
        }
        this.wait(this.ctrl, CTRL_STATUS, STATUS_PENDING, remaining);
        continue;
      }
      if (Atomics.load(this.ctrl, CTRL_SEQ) !== seq) {
        // Stale reply from an abandoned (timed-out) request: re-arm and keep
        // waiting for ours.
        Atomics.store(this.ctrl, CTRL_STATUS, STATUS_PENDING);
        continue;
      }
      if (status === STATUS_ERROR) {
        const errno = Atomics.load(this.ctrl, CTRL_ERRNO) || EIO;
        throw new SyncIoError(errno, `broker read failed (errno ${errno})`);
      }
      const bytes = Atomics.load(this.ctrl, CTRL_BYTES);
      // slice() copies out of the SAB into a regular (cacheable) buffer.
      const block = this.data.slice(0, bytes);
      this.l1.set(key, block);
      if (this.l1.size > L1_MAX_BLOCKS) {
        this.l1.delete(this.l1.keys().next().value as string);
      }
      return block;
    }
  }

  /**
   * Synchronous multi-block read into `out` at `outOffset`. Returns the
   * number of bytes written (clamped at EOF).
   */
  readInto(
    fileKey: string,
    fileSize: number,
    position: number,
    length: number,
    out: Uint8Array,
    outOffset: number,
  ): number {
    const blockSize = this.config.blockSize;
    const len = Math.min(length, Math.max(0, fileSize - position));
    let written = 0;
    while (written < len) {
      const pos = position + written;
      const blockIndex = Math.floor(pos / blockSize);
      const block = this.readBlockSync(fileKey, blockIndex);
      const start = pos - blockIndex * blockSize;
      const n = Math.min(block.byteLength - start, len - written);
      if (n <= 0) break; // unexpected EOF
      out.set(block.subarray(start, start + n), outOffset + written);
      written += n;
    }
    return written;
  }

  private onReply(msg: IoReply): void {
    if (msg.type !== 'rpc') return;
    const pending = this.pendingRpcs.get(msg.rpcId);
    if (!pending) return;
    this.pendingRpcs.delete(msg.rpcId);
    if (msg.ok) {
      pending.resolve(msg.size);
    } else {
      pending.reject(new Error(msg.error));
    }
  }
}
