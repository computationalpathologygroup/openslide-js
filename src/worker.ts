/**
 * worker.ts
 *
 * Web Worker entry point. Loads the WASM module and processes commands
 * from the main thread via postMessage.
 */

import { WorkerApi } from './worker-api.js';
import { ReadQueue, ReadCancelledError } from './read-queue.js';
import { IoBroker } from './io/broker.js';
import { SyncIo } from './io/sync-client.js';
import type { WorkerCommand, WorkerResponse, OpenSlideWasmModule } from './types.js';

/**
 * Build-time constant injected by esbuild (`--define`) when this worker is bundled.
 * Selects which Emscripten glue the worker loads by default — `./wasm/openslide.js`
 * for the standard build, the sibling inlined glue for the single-file build.
 * Undefined in the raw tsc output (a `typeof` guard handles that fallback).
 */
declare const __OPENSLIDE_GLUE_PATH__: string | undefined;

let api: WorkerApi | null = null;

/** Set when this worker was started in broker mode ('init-broker'). */
let broker: IoBroker | null = null;

/** Concurrency limiter for readRegion to prevent memory exhaustion. */
let readQueue = new ReadQueue(4);

function reply(msg: WorkerResponse): void {
  if (msg.ok && msg.result instanceof ArrayBuffer) {
    (self as unknown as Worker).postMessage(msg, [msg.result]);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
}

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  try {
    let result: unknown;

    switch (cmd.cmd) {
      case 'init-broker': {
        // Broker mode: this worker only serves I/O for the others. The WASM
        // glue is never loaded here.
        broker = new IoBroker(cmd.ioConfig);
        result = true;
        break;
      }

      case 'attach-channel': {
        if (!broker) throw new Error('Worker is not in broker mode');
        broker.attachChannel(cmd.port, cmd.sab);
        result = true;
        break;
      }

      case 'init': {
        // Load the Emscripten module factory.
        type CreateModule = (opts?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<OpenSlideWasmModule>;
        let createModule: CreateModule;
        if (cmd.wasmUrl) {
          // Explicit override: resolve at runtime, hidden from bundlers.
          ({ default: createModule } = await import(/* webpackIgnore: true */ cmd.wasmUrl) as {
            default: CreateModule;
          });
        } else {
          // Non-literal specifier defeats webpack's static `import('<lit>')` tracing, which
          // would otherwise pull the emscripten glue + USE_PTHREADS support into the bundle
          // (em-pthread circular dep under Next.js). Native ESM still resolves this relative
          // to worker.js at runtime. Bundler consumers should pass `wasmUrl` instead.
          //
          // `__OPENSLIDE_GLUE_PATH__` is substituted at our own build time (esbuild
          // `--define`): the default bundle points at `./wasm/openslide.js`; the single-file
          // bundle points at its sibling inlined glue. The `typeof` guard keeps the raw
          // (un-bundled) tsc output working too. esbuild keeps this import *external*, so the
          // glue is never inlined into the worker.
          const gluePath = typeof __OPENSLIDE_GLUE_PATH__ !== 'undefined'
            ? __OPENSLIDE_GLUE_PATH__
            : './wasm/openslide.js';
          ({ default: createModule } = await import(gluePath) as { default: CreateModule });
        }
        const mod = await createModule(cmd.wasmBinary ? { wasmBinary: cmd.wasmBinary } : undefined);
        // Wire the shared I/O channel when the main thread attached one.
        const syncIo = cmd.ioPort && cmd.ioSab && cmd.ioConfig
          ? new SyncIo(cmd.ioPort, cmd.ioSab, cmd.ioConfig)
          : null;
        if (cmd.ioConfig) {
          readQueue = new ReadQueue(cmd.ioConfig.maxConcurrentReads);
        }
        api = new WorkerApi(mod, syncIo);
        // Ensure /mnt exists for file mounting
        try { mod.FS.mkdir('/mnt'); } catch { /* may exist */ }
        result = true;
        break;
      }

      case 'mountFile': {
        if (!api) throw new Error('Worker not initialized');
        result = api.mountFiles(cmd.files, cmd.mountId);
        break;
      }

      case 'mountDir': {
        if (!api) throw new Error('Worker not initialized');
        result = api.mountDir(cmd.entries, cmd.indexFile, cmd.mountId);
        break;
      }

      case 'mountUrl': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.mountUrl(cmd.url, cmd.mountId);
        break;
      }

      case 'unmount': {
        if (!api) throw new Error('Worker not initialized');
        api.unmount(cmd.mountId);
        result = true;
        break;
      }

      case 'open': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.open(cmd.mountId);
        break;
      }

      case 'close': {
        if (!api) throw new Error('Worker not initialized');
        await api.close(cmd.handle);
        result = true;
        break;
      }

      case 'getSlideInfo': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.getSlideInfo(cmd.handle);
        break;
      }

      case 'readRegion': {
        if (!api) throw new Error('Worker not initialized');
        await readQueue.acquire(cmd.id);
        try {
          result = await api.readRegion(cmd.handle, cmd.x, cmd.y, cmd.level, cmd.w, cmd.h);
        } finally {
          readQueue.release();
        }
        break;
      }

      case 'readAssociatedImage': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.readAssociatedImage(cmd.handle, cmd.name);
        break;
      }

      case 'getAssociatedImageDimensions': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.getAssociatedImageDimensions(cmd.handle, cmd.name);
        break;
      }

      case 'detectVendor': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.detectVendor(cmd.mountId);
        break;
      }

      case 'getVersion': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.getVersion();
        break;
      }

      case 'getIccProfile': {
        if (!api) throw new Error('Worker not initialized');
        result = await api.getIccProfile(cmd.handle);
        break;
      }

      case 'cancel': {
        // Drop the target read if it is still waiting for a slot; its own
        // acquire() rejects and replies with code 'cancelled'. Reads that
        // already entered the WASM cannot be cancelled.
        result = readQueue.cancel(cmd.targetId);
        break;
      }

      default:
        throw new Error(`Unknown command: ${(cmd as WorkerCommand).cmd}`);
    }

    reply({ id: cmd.id, ok: true, result });
  } catch (err) {
    if (err instanceof ReadCancelledError) {
      reply({ id: cmd.id, ok: false, error: err.message, code: err.code });
      return;
    }
    let errMsg: string;
    if (err instanceof Error) {
      errMsg = err.message || err.toString();
    } else if (typeof err === 'string') {
      errMsg = err;
    } else if (err && typeof err === 'object') {
      // Emscripten FS errors are plain objects with errno/code properties
      const parts: string[] = [];
      if ('errno' in err) parts.push(`errno=${(err as Record<string, unknown>).errno}`);
      if ('code' in err) parts.push(`code=${(err as Record<string, unknown>).code}`);
      if ('message' in err) parts.push(`message=${(err as Record<string, unknown>).message}`);
      errMsg = parts.length > 0 ? parts.join(', ') : JSON.stringify(err);
    } else {
      errMsg = String(err);
    }
    reply({ id: cmd.id, ok: false, error: errMsg });
  }
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  handleCommand(e.data);
};
