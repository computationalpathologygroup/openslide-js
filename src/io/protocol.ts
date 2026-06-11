/**
 * io/protocol.ts
 *
 * Shared constants and message shapes for the I/O broker channel.
 *
 * Each decode worker gets one SharedArrayBuffer channel:
 *   [ 64-byte Int32 header | one block of data ]
 * Requests travel worker → broker as port messages; replies to a *blocked*
 * worker travel exclusively through the SAB (the worker cannot run its event
 * loop while parked in Atomics.wait). Async RPC replies (registration) use
 * normal port messages, which only happen while the worker is unblocked.
 */

// Int32Array header slot indices within a channel SharedArrayBuffer.
export const CTRL_STATUS = 0;
export const CTRL_SEQ = 1;
export const CTRL_BYTES = 2;
export const CTRL_ERRNO = 3;

/** Header length in bytes; keeps the data region 64-byte aligned. */
export const HEADER_BYTES = 64;

export const STATUS_PENDING = 0;
export const STATUS_OK = 1;
export const STATUS_ERROR = 2;

/** errno values mirrored from Emscripten's wasi errno table. */
export const EINVAL = 28;
export const EIO = 29;

/** Resolved I/O tuning; user-facing knobs live on OpenSlideOptions.io. */
export interface IoConfig {
  /** Bytes per cached block / per range request. */
  blockSize: number;
  /** Byte budget of the broker's shared LRU block cache. */
  brokerCacheBytes: number;
  /** Blocks to prefetch ahead of a sequential read pattern. */
  readAhead: number;
  /** Max concurrent readRegion calls per decode worker. */
  maxConcurrentReads: number;
  /** How long a blocked read waits for the broker before failing with EIO. */
  readTimeoutMs: number;
}

export const DEFAULT_IO_CONFIG: IoConfig = {
  blockSize: 1024 * 1024,
  brokerCacheBytes: 256 * 1024 * 1024,
  readAhead: 2,
  maxConcurrentReads: 4,
  readTimeoutMs: 120_000,
};

/** Worker → broker messages (over the per-worker MessagePort). */
export type IoRequest =
  | { type: 'read'; seq: number; fileKey: string; blockIndex: number }
  | { type: 'register-url'; rpcId: number; fileKey: string; url: string }
  | { type: 'register-files'; files: Array<{ fileKey: string; file: File; size: number }> }
  | { type: 'release'; fileKeys: string[] };

/** Broker → worker async RPC replies (only consumed while unblocked). */
export type IoReply =
  | { type: 'rpc'; rpcId: number; ok: true; size: number }
  | { type: 'rpc'; rpcId: number; ok: false; error: string };
