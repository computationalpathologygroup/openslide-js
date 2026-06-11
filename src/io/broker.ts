/**
 * io/broker.ts
 *
 * The I/O broker: runs in its own worker (spawned from the same worker.js
 * via an 'init-broker' first message — it never loads the WASM). It owns the
 * block cache shared by every decode worker and serves their synchronous
 * read requests: requests arrive as port messages, replies for a blocked
 * worker go exclusively through that worker's SAB channel (data → SEQ →
 * STATUS last → notify). Backends: HTTP range requests for URLs, File.slice
 * for local files — both async, parallel, and deduped.
 */

import { BlockStore } from './block-cache.js';
import {
  CTRL_STATUS, CTRL_SEQ, CTRL_BYTES, CTRL_ERRNO,
  HEADER_BYTES, STATUS_OK, STATUS_ERROR, EIO,
} from './protocol.js';
import type { IoConfig, IoRequest } from './protocol.js';

type FileEntry =
  | { kind: 'url'; url: string; size: number; refs: number; wholeBody?: Uint8Array }
  | { kind: 'file'; file: File; size: number; refs: number };

interface Channel {
  port: MessagePort;
  ctrl: Int32Array;
  data: Uint8Array;
  /** Highest seq received; replies for older (abandoned) reads are dropped. */
  latestSeq: number;
}

export class IoBroker {
  private readonly config: IoConfig;
  private readonly store: BlockStore;
  private files = new Map<string, FileEntry>();
  private statInflight = new Map<string, Promise<FileEntry>>();

  constructor(config: IoConfig) {
    this.config = config;
    this.store = new BlockStore({
      blockSize: config.blockSize,
      maxBytes: config.brokerCacheBytes,
      readAhead: config.readAhead,
      fetchRange: (fileKey, start, end) => this.fetchRange(fileKey, start, end),
    });
  }

  /** Wire one decode worker's channel (its MessagePort + SAB). */
  attachChannel(port: MessagePort, sab: SharedArrayBuffer): void {
    const channel: Channel = {
      port,
      ctrl: new Int32Array(sab, 0, HEADER_BYTES / 4),
      data: new Uint8Array(sab, HEADER_BYTES),
      latestSeq: 0,
    };
    port.onmessage = (e: MessageEvent<IoRequest>) => this.onRequest(channel, e.data);
  }

  private onRequest(channel: Channel, msg: IoRequest): void {
    switch (msg.type) {
      case 'read':
        channel.latestSeq = msg.seq;
        void this.handleRead(channel, msg.seq, msg.fileKey, msg.blockIndex);
        break;

      case 'register-url':
        void this.handleRegisterUrl(channel, msg.rpcId, msg.fileKey, msg.url);
        break;

      case 'register-files':
        for (const { fileKey, file, size } of msg.files) {
          const existing = this.files.get(fileKey);
          if (existing) {
            existing.refs++;
          } else {
            this.files.set(fileKey, { kind: 'file', file, size, refs: 1 });
            this.store.setFileSize(fileKey, size);
          }
        }
        break;

      case 'release':
        for (const fileKey of msg.fileKeys) {
          const entry = this.files.get(fileKey);
          if (!entry) continue;
          if (--entry.refs <= 0) {
            this.files.delete(fileKey);
            this.store.releaseFile(fileKey);
          }
        }
        break;
    }
  }

  private async handleRead(channel: Channel, seq: number, fileKey: string, blockIndex: number): Promise<void> {
    let block: Uint8Array;
    try {
      block = await this.store.getBlock(fileKey, blockIndex);
    } catch (err) {
      if (channel.latestSeq !== seq) return; // abandoned request — never touch the SAB
      console.error(`openslide-js broker: read failed for ${fileKey} block ${blockIndex}:`, err);
      Atomics.store(channel.ctrl, CTRL_ERRNO, EIO);
      Atomics.store(channel.ctrl, CTRL_SEQ, seq);
      Atomics.store(channel.ctrl, CTRL_STATUS, STATUS_ERROR);
      Atomics.notify(channel.ctrl, CTRL_STATUS);
      return;
    }
    if (channel.latestSeq !== seq) return; // abandoned request — never touch the SAB
    channel.data.set(block);
    Atomics.store(channel.ctrl, CTRL_BYTES, block.byteLength);
    Atomics.store(channel.ctrl, CTRL_SEQ, seq);
    Atomics.store(channel.ctrl, CTRL_STATUS, STATUS_OK);
    Atomics.notify(channel.ctrl, CTRL_STATUS);
  }

  private async handleRegisterUrl(channel: Channel, rpcId: number, fileKey: string, url: string): Promise<void> {
    try {
      let entry = this.files.get(fileKey);
      if (!entry) {
        // Dedupe concurrent registrations of the same URL from several workers.
        let pending = this.statInflight.get(fileKey);
        if (!pending) {
          pending = this.statUrl(url).finally(() => this.statInflight.delete(fileKey));
          this.statInflight.set(fileKey, pending);
        }
        const statted = await pending;
        entry = this.files.get(fileKey);
        if (!entry) {
          entry = statted;
          this.files.set(fileKey, entry);
          this.store.setFileSize(fileKey, entry.size);
        }
      }
      entry.refs++;
      channel.port.postMessage({ type: 'rpc', rpcId, ok: true, size: entry.size });
    } catch (err) {
      channel.port.postMessage({
        type: 'rpc',
        rpcId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Determine a remote file's size. Servers without range support get the
   * legacy createLazyFile treatment: the whole body is downloaded once and
   * served from memory.
   */
  private async statUrl(url: string): Promise<FileEntry> {
    const resp = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (resp.status === 206) {
      const contentRange = resp.headers.get('Content-Range');
      const match = contentRange && /\/(\d+)\s*$/.exec(contentRange);
      await resp.body?.cancel();
      if (match) {
        return { kind: 'url', url, size: parseInt(match[1], 10), refs: 0 };
      }
      throw new Error(`server sent 206 without a Content-Range total for ${url}`);
    }
    if (resp.ok) {
      // Range header ignored → no byte serving; buffer the entire file.
      const body = new Uint8Array(await resp.arrayBuffer());
      return { kind: 'url', url, size: body.byteLength, refs: 0, wholeBody: body };
    }
    throw new Error(`HTTP ${resp.status} opening ${url}`);
  }

  private async fetchRange(fileKey: string, start: number, end: number): Promise<Uint8Array> {
    const entry = this.files.get(fileKey);
    if (!entry) throw new Error(`unknown file: ${fileKey}`);

    if (entry.kind === 'file') {
      return new Uint8Array(await entry.file.slice(start, end).arrayBuffer());
    }
    if (entry.wholeBody) {
      return entry.wholeBody.subarray(start, end);
    }
    const resp = await fetch(entry.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (resp.status === 206) {
      return new Uint8Array(await resp.arrayBuffer());
    }
    if (resp.ok) {
      // Server stopped honouring ranges mid-session; fall back to full body.
      const body = new Uint8Array(await resp.arrayBuffer());
      entry.wholeBody = body;
      return body.subarray(start, end);
    }
    throw new Error(`HTTP ${resp.status} fetching bytes ${start}-${end - 1} of ${entry.url}`);
  }
}
