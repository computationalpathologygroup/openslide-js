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

    let workerUrl: URL;
    if (options?.workerUrl) {
      workerUrl = new URL(options.workerUrl);
    } else {
      // @ts-ignore - import.meta.url is valid in ESM; CJS users must pass workerUrl
      workerUrl = new URL('./worker.js', import.meta.url);
    }

    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const worker = new Worker(workerUrl, { type: 'module' });
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
        // Reject all pending requests on this worker
        for (const [, req] of managed.pending) {
          req.reject(new OpenSlideError(`Worker error: ${e.message}`));
        }
        managed.pending.clear();
        managed.activeTasks = 0;
      };

      instance.workers.push(managed);
      initPromises.push(
        instance.sendTo(managed, { cmd: 'init', wasmUrl: options?.wasmUrl }) as Promise<unknown> as Promise<void>
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
