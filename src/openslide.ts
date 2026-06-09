/**
 * openslide.ts
 *
 * Main entry point for the library. Manages a pool of Web Workers,
 * each running an independent WASM instance. Distributes work
 * across workers for parallel tile reads.
 */

import type {
  OpenSlideOptions,
  SlideSource,
  VirtualFile,
  SlideInfo,
  WorkerResponse,
} from './types.js';
import { OpenSlideError } from './errors.js';
import { Slide } from './slide.js';
import type { SendCommand } from './slide.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface ManagedWorker {
  worker: Worker;
  pending: Map<number, PendingRequest>;
  activeTasks: number;
}

export class OpenSlide {
  private workers: ManagedWorker[] = [];
  private nextId = 1;
  private terminated = false;

  private constructor() {}

  /**
   * Create and initialize an OpenSlide instance with a worker pool.
   *
   * @param options.workerCount - Number of workers (default: hardwareConcurrency or 4).
   * @param options.wasmUrl - Custom URL to the WASM module JS loader.
   */
  static async initialize(options?: OpenSlideOptions): Promise<OpenSlide> {
    const instance = new OpenSlide();
    const count = options?.workerCount ?? (
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4
    ) ?? 4;

    const makeWorker = (): Worker => {
      if (options?.workerFactory) return options.workerFactory();
      if (options?.workerUrl) {
        // @ts-ignore - import.meta.url is valid in ESM; CJS users must pass workerUrl/workerFactory
        return new Worker(new URL(options.workerUrl, import.meta.url), { type: 'module' });
      }
      // Non-literal path defeats webpack 5 / Vite's syntactic
      // `new Worker(new URL('<lit>', import.meta.url))` detection, which under Next.js
      // force-traces the pthreaded WASM glue and creates an em-pthread chunk circular
      // dep with the runtime. Plain-ESM consumers still resolve this at runtime; bundler
      // consumers MUST pass `workerFactory` or `workerUrl` (see INTEGRATION.md).
      const workerPath = './worker.js';
      // @ts-ignore - import.meta.url is valid in ESM; CJS/bundler users pass workerUrl/workerFactory
      return new Worker(new URL(workerPath, import.meta.url), { type: 'module' });
    };

    // Absolutise the WASM glue URL once, on the main thread, before posting it to
    // the workers. Bundlers (Next.js `assetPrefix: '.'`, Vite/Rollup) routinely
    // hand back *relative* asset URLs; a relative URL posted to the worker would
    // resolve against the worker's base and double-prefix into a 404. Resolving it
    // here against `document.baseURI` (or the worker/global base) means relative
    // bundler asset URLs just work. Already-absolute URLs pass through unchanged.
    const wasmUrl = options?.wasmUrl
      ? new URL(
          options.wasmUrl,
          typeof document !== 'undefined' ? document.baseURI : self.location.href
        ).href
      : undefined;

    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const worker = makeWorker();
      const managed: ManagedWorker = { worker, pending: new Map(), activeTasks: 0 };

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resp = e.data;
        const req = managed.pending.get(resp.id);
        if (!req) return;
        managed.pending.delete(resp.id);
        managed.activeTasks--;
        if (resp.ok) {
          req.resolve(resp.result);
        } else {
          req.reject(new OpenSlideError(resp.error));
        }
      };

      worker.onerror = (e) => {
        // Surface every field the ErrorEvent gives us, plus the
        // cross-origin-isolated state (a missing COOP/COEP setup is the most
        // common cause). `e.message` is `undefined` for cross-origin module-load
        // failures and opaque worker boot deaths — the two most common bundler
        // integration failure modes — so a bare message is the least useful thing
        // we could report.
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (e.filename) parts.push(`at ${e.filename}${e.lineno ? `:${e.lineno}` : ''}`);
        if (typeof self !== 'undefined' && 'crossOriginIsolated' in self) {
          parts.push(`crossOriginIsolated=${self.crossOriginIsolated}`);
        }
        if (parts.length === 0) {
          parts.push(
            'worker died without a message — most often a module-load failure ' +
            '(check the network tab) or missing COOP/COEP headers ' +
            '(SharedArrayBuffer unavailable)'
          );
        }
        const msg = `Worker error: ${parts.join(' | ')}`;
        // Reject all pending requests on this worker
        for (const [, req] of managed.pending) {
          req.reject(new OpenSlideError(msg));
        }
        managed.pending.clear();
        managed.activeTasks = 0;
      };

      instance.workers.push(managed);
      initPromises.push(
        instance.sendTo(managed, { cmd: 'init', wasmUrl, wasmBinary: options?.wasmBinary }) as Promise<unknown> as Promise<void>
      );
    }

    await Promise.all(initPromises);
    return instance;
  }

  /**
   * Open a whole-slide image.
   *
   * Accepts:
   * - A single File (dropped or from file input)
   * - An array of Files (for multi-file formats like MIRAX)
   * - An array of VirtualFile objects (files with relative paths)
   * - A URL object or string URL (fetched via HTTP range requests)
   */
  async open(source: SlideSource): Promise<Slide> {
    this.ensureAlive();
    const worker = this.leastBusy();
    const send = this.createSendFn(worker);
    const mountId = this.generateMountId();

    let slidePath: string;

    if (typeof source === 'string') {
      slidePath = await send({ cmd: 'mountUrl', url: source, mountId }) as string;
    } else if (source instanceof URL) {
      slidePath = await send({ cmd: 'mountUrl', url: source.href, mountId }) as string;
    } else if (source instanceof File) {
      slidePath = await send({ cmd: 'mountFile', files: [source], mountId }) as string;
    } else if (Array.isArray(source)) {
      if (source.length > 0 && 'file' in source[0]) {
        // VirtualFile[] — multi-file format with directory structure
        const entries = source as VirtualFile[];
        // Find the index file (the .mrxs, .vms, etc.)
        const indexEntry = entries.find(e => !e.path.includes('/')) ?? entries[0];
        slidePath = await send({ cmd: 'mountDir', entries, indexFile: indexEntry.path, mountId }) as string;
      } else {
        // File[] — flat list of files
        slidePath = await send({ cmd: 'mountFile', files: source as File[], mountId }) as string;
      }
    } else {
      throw new OpenSlideError('Invalid slide source');
    }

    const handle = await send({ cmd: 'open', mountId: slidePath }) as number;
    const info = await send({ cmd: 'getSlideInfo', handle }) as SlideInfo;

    // Reconstruct the Map from the serialized data (postMessage turns Map into plain object)
    const props = info.properties instanceof Map
      ? info.properties
      : new Map(Object.entries(info.properties as unknown as Record<string, string>));
    const normalizedInfo: SlideInfo = { ...info, properties: props };

    return new Slide(send, handle, mountId, normalizedInfo);
  }

  /**
   * Detect the vendor of a slide file without fully opening it.
   * Returns the vendor string (e.g., "aperio", "hamamatsu") or null.
   */
  async detectVendor(source: SlideSource): Promise<string | null> {
    this.ensureAlive();
    const worker = this.leastBusy();
    const send = this.createSendFn(worker);
    const mountId = this.generateMountId();

    let slidePath: string;
    if (typeof source === 'string') {
      slidePath = await send({ cmd: 'mountUrl', url: source, mountId }) as string;
    } else if (source instanceof URL) {
      slidePath = await send({ cmd: 'mountUrl', url: source.href, mountId }) as string;
    } else if (source instanceof File) {
      slidePath = await send({ cmd: 'mountFile', files: [source], mountId }) as string;
    } else {
      throw new OpenSlideError('detectVendor requires a single file or URL');
    }

    const vendor = await send({ cmd: 'detectVendor', mountId: slidePath }) as string | null;
    await send({ cmd: 'unmount', mountId });
    return vendor;
  }

  /** Get the OpenSlide library version string. */
  async getVersion(): Promise<string> {
    this.ensureAlive();
    return await this.sendTo(this.workers[0], { cmd: 'getVersion' }) as string;
  }

  /** Terminate all workers. The instance cannot be used after this. */
  terminate(): void {
    this.terminated = true;
    for (const { worker, pending } of this.workers) {
      for (const [, req] of pending) {
        req.reject(new OpenSlideError('OpenSlide terminated'));
      }
      pending.clear();
      worker.terminate();
    }
    this.workers = [];
  }

  // --- Internal ---

  private leastBusy(): ManagedWorker {
    let best = this.workers[0];
    for (let i = 1; i < this.workers.length; i++) {
      if (this.workers[i].activeTasks < best.activeTasks) {
        best = this.workers[i];
      }
    }
    return best;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendTo(managed: ManagedWorker, cmd: Record<string, any>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      managed.pending.set(id, { resolve, reject });
      managed.activeTasks++;
      managed.worker.postMessage({ ...cmd, id });
    });
  }

  private createSendFn(managed: ManagedWorker): SendCommand {
    return (cmd) => this.sendTo(managed, cmd);
  }

  private generateMountId(): string {
    return `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private ensureAlive(): void {
    if (this.terminated) {
      throw new OpenSlideError('OpenSlide has been terminated');
    }
  }
}
