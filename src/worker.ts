/**
 * worker.ts
 *
 * Web Worker entry point. Loads the WASM module and processes commands
 * from the main thread via postMessage.
 */

import { WorkerApi } from './worker-api.js';
import type { WorkerCommand, WorkerResponse, OpenSlideWasmModule } from './types.js';

let api: WorkerApi | null = null;

/** Concurrency limiter for readRegion to prevent memory exhaustion. */
const MAX_CONCURRENT_READS = 4;
let activeReads = 0;
const readQueue: Array<() => void> = [];

function acquireReadSlot(): Promise<void> {
  if (activeReads < MAX_CONCURRENT_READS) {
    activeReads++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    readQueue.push(resolve);
  });
}

function releaseReadSlot(): void {
  activeReads--;
  const next = readQueue.shift();
  if (next) {
    activeReads++;
    next();
  }
}

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
      case 'init': {
        // Dynamic import of the Emscripten module factory
        const wasmUrl = cmd.wasmUrl ?? new URL('./wasm/openslide.js', import.meta.url).href;
        const { default: createModule } = await import(/* webpackIgnore: true */ wasmUrl) as {
          default: () => Promise<OpenSlideWasmModule>;
        };
        const mod = await createModule();
        api = new WorkerApi(mod);
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
        result = api.mountUrl(cmd.url, cmd.mountId);
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
        await acquireReadSlot();
        try {
          result = await api.readRegion(cmd.handle, cmd.x, cmd.y, cmd.level, cmd.w, cmd.h);
        } finally {
          releaseReadSlot();
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

      default:
        throw new Error(`Unknown command: ${(cmd as WorkerCommand).cmd}`);
    }

    reply({ id: cmd.id, ok: true, result });
  } catch (err) {
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
