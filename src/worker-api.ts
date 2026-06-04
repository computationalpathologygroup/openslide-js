/**
 * worker-api.ts
 *
 * Low-level bridge between JavaScript and the OpenSlide WASM module.
 * Runs inside a Web Worker. Handles cwrap binding, memory management,
 * virtual filesystem mounting, and pixel format conversion.
 */

import type { OpenSlideWasmModule, SlideInfo, Dimensions, VirtualFile } from './types.js';

/** Wrapped C functions callable from JS. */
interface WasmBindings {
  open: (path: string) => Promise<number>;
  close: (handle: number) => Promise<void>;
  getLevelCount: (handle: number) => Promise<number>;
  getLevelDimensions: (handle: number, level: number) => Promise<number>;
  getLevelDownsample: (handle: number, level: number) => Promise<number>;
  getBestLevelForDownsample: (handle: number, ds: number) => Promise<number>;
  readRegion: (handle: number, x: bigint, y: bigint, level: number, w: bigint, h: bigint) => Promise<number>;
  freeResult: (ptr: number) => Promise<void>;
  getPropertyNames: (handle: number) => Promise<number>;
  getPropertyValue: (handle: number, name: string) => Promise<number>;
  getAssociatedImageNames: (handle: number) => Promise<number>;
  getAssociatedImageDimensions: (handle: number, name: string) => Promise<number>;
  readAssociatedImage: (handle: number, name: string) => Promise<number>;
  getError: (handle: number) => Promise<number>;
  getVersion: () => Promise<number>;
  detectVendor: (path: string) => Promise<number>;
  getIccProfileSize: (handle: number) => Promise<bigint>;
  readIccProfile: (handle: number) => Promise<number>;
}

export class WorkerApi {
  private mod: OpenSlideWasmModule;
  private fn: WasmBindings;

  constructor(mod: OpenSlideWasmModule) {
    this.mod = mod;
    const cw = (name: string, ret: string | null, args: string[]) =>
      mod.cwrap(name, ret, args, { async: true }) as (...a: unknown[]) => Promise<unknown>;

    this.fn = {
      open:                      cw('os_open', 'number', ['string']) as WasmBindings['open'],
      close:                     cw('os_close', null, ['number']) as WasmBindings['close'],
      getLevelCount:             cw('os_get_level_count', 'number', ['number']) as WasmBindings['getLevelCount'],
      getLevelDimensions:        cw('os_get_level_dimensions', 'number', ['number', 'number']) as WasmBindings['getLevelDimensions'],
      getLevelDownsample:        cw('os_get_level_downsample', 'number', ['number', 'number']) as WasmBindings['getLevelDownsample'],
      getBestLevelForDownsample: cw('os_get_best_level_for_downsample', 'number', ['number', 'number']) as WasmBindings['getBestLevelForDownsample'],
      readRegion:                cw('os_read_region', 'number', ['number', 'bigint', 'bigint', 'number', 'bigint', 'bigint']) as WasmBindings['readRegion'],
      freeResult:                cw('os_free_result', null, ['number']) as WasmBindings['freeResult'],
      getPropertyNames:          cw('os_get_property_names', 'number', ['number']) as WasmBindings['getPropertyNames'],
      getPropertyValue:          cw('os_get_property_value', 'number', ['number', 'string']) as WasmBindings['getPropertyValue'],
      getAssociatedImageNames:   cw('os_get_associated_image_names', 'number', ['number']) as WasmBindings['getAssociatedImageNames'],
      getAssociatedImageDimensions: cw('os_get_associated_image_dimensions', 'number', ['number', 'string']) as WasmBindings['getAssociatedImageDimensions'],
      readAssociatedImage:       cw('os_read_associated_image', 'number', ['number', 'string']) as WasmBindings['readAssociatedImage'],
      getError:                  cw('os_get_error', 'number', ['number']) as WasmBindings['getError'],
      getVersion:                cw('os_get_version', 'number', []) as WasmBindings['getVersion'],
      detectVendor:              cw('os_detect_vendor', 'number', ['string']) as WasmBindings['detectVendor'],
      getIccProfileSize:         cw('os_get_icc_profile_size', 'bigint', ['number']) as WasmBindings['getIccProfileSize'],
      readIccProfile:            cw('os_read_icc_profile', 'number', ['number']) as WasmBindings['readIccProfile'],
    };
  }

  /** Check for an OpenSlide error after a call and throw if present. */
  private async checkError(handle: number): Promise<void> {
    const errPtr = await this.fn.getError(handle);
    if (errPtr) {
      const msg = this.mod.UTF8ToString(errPtr);
      throw new Error(msg);
    }
  }

  /** Read a NULL-terminated array of C strings from a pointer. */
  private readStringArray(ptr: number): string[] {
    const results: string[] = [];
    const ptrSize = 4; // wasm32
    let offset = ptr;
    while (true) {
      const strPtr = this.mod.HEAP32[offset >> 2];
      if (!strPtr) break;
      results.push(this.mod.UTF8ToString(strPtr));
      offset += ptrSize;
    }
    return results;
  }

  /**
   * Convert pre-multiplied ARGB (OpenSlide native) to straight RGBA.
   * Operates in-place on a Uint8ClampedArray.
   */
  private argbToRgba(buf: Uint8ClampedArray): void {
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3]; // In ARGB32 little-endian: byte order is B,G,R,A
      // Actually OpenSlide stores as 0xAARRGGBB in native endian.
      // On little-endian (wasm is LE): bytes are [B, G, R, A].
      // We want RGBA: [R, G, B, A].
      const b = buf[i];
      const g = buf[i + 1];
      const r = buf[i + 2];
      // a is buf[i + 3]

      if (a === 0) {
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        // buf[i + 3] already 0
      } else if (a === 255) {
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        // alpha stays 255
      } else {
        // Un-premultiply and swap channels
        buf[i]     = Math.min(255, (r * 255 / a) | 0);
        buf[i + 1] = Math.min(255, (g * 255 / a) | 0);
        buf[i + 2] = Math.min(255, (b * 255 / a) | 0);
        // alpha stays
      }
    }
  }

  // --- Public API ---

  async open(path: string): Promise<number> {
    const handle = await this.fn.open(path);
    if (!handle) throw new Error(`Failed to open slide: ${path}`);
    await this.checkError(handle);
    return handle;
  }

  async close(handle: number): Promise<void> {
    await this.fn.close(handle);
  }

  async getSlideInfo(handle: number): Promise<SlideInfo> {
    const levelCount = await this.fn.getLevelCount(handle);
    await this.checkError(handle);

    const levelDimensions: Dimensions[] = [];
    const levelDownsamples: number[] = [];

    for (let i = 0; i < levelCount; i++) {
      const dimPtr = await this.fn.getLevelDimensions(handle, i);
      const w = Number(this.mod.HEAP64[dimPtr >> 3]);
      const h = Number(this.mod.HEAP64[(dimPtr >> 3) + 1]);
      await this.fn.freeResult(dimPtr);
      levelDimensions.push({ width: w, height: h });

      const ds = await this.fn.getLevelDownsample(handle, i);
      levelDownsamples.push(ds);
    }

    // Properties
    const namesPtr = await this.fn.getPropertyNames(handle);
    const propNames = this.readStringArray(namesPtr);
    const properties = new Map<string, string>();
    for (const name of propNames) {
      const valPtr = await this.fn.getPropertyValue(handle, name);
      if (valPtr) {
        properties.set(name, this.mod.UTF8ToString(valPtr));
      }
    }

    // Associated images
    const assocPtr = await this.fn.getAssociatedImageNames(handle);
    const associatedImageNames = this.readStringArray(assocPtr);

    return { levelCount, levelDimensions, levelDownsamples, properties, associatedImageNames };
  }

  /**
   * Read a region and return the raw RGBA bytes as a transferable ArrayBuffer.
   */
  async readRegion(handle: number, x: number, y: number, level: number, w: number, h: number): Promise<ArrayBuffer> {
    const ptr = await this.fn.readRegion(handle, BigInt(x), BigInt(y), level, BigInt(w), BigInt(h));
    await this.checkError(handle);
    if (!ptr) throw new Error('readRegion returned null');

    const byteLength = w * h * 4;
    const rgba = new Uint8ClampedArray(byteLength);
    rgba.set(this.mod.HEAPU8.subarray(ptr, ptr + byteLength));
    await this.fn.freeResult(ptr);

    this.argbToRgba(rgba);
    return rgba.buffer;
  }

  async readAssociatedImage(handle: number, name: string): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    const dimPtr = await this.fn.getAssociatedImageDimensions(handle, name);
    const w = Number(this.mod.HEAP64[dimPtr >> 3]);
    const h = Number(this.mod.HEAP64[(dimPtr >> 3) + 1]);
    await this.fn.freeResult(dimPtr);

    const ptr = await this.fn.readAssociatedImage(handle, name);
    await this.checkError(handle);
    if (!ptr) throw new Error(`readAssociatedImage returned null for '${name}'`);

    const byteLength = w * h * 4;
    const rgba = new Uint8ClampedArray(byteLength);
    rgba.set(this.mod.HEAPU8.subarray(ptr, ptr + byteLength));
    await this.fn.freeResult(ptr);

    this.argbToRgba(rgba);
    return { buffer: rgba.buffer, width: w, height: h };
  }

  async getAssociatedImageDimensions(handle: number, name: string): Promise<Dimensions> {
    const dimPtr = await this.fn.getAssociatedImageDimensions(handle, name);
    const w = Number(this.mod.HEAP64[dimPtr >> 3]);
    const h = Number(this.mod.HEAP64[(dimPtr >> 3) + 1]);
    await this.fn.freeResult(dimPtr);
    return { width: w, height: h };
  }

  async detectVendor(path: string): Promise<string | null> {
    const ptr = await this.fn.detectVendor(path);
    return ptr ? this.mod.UTF8ToString(ptr) : null;
  }

  async getVersion(): Promise<string> {
    const ptr = await this.fn.getVersion();
    return ptr ? this.mod.UTF8ToString(ptr) : 'unknown';
  }

  async getIccProfile(handle: number): Promise<ArrayBuffer | null> {
    const size = await this.fn.getIccProfileSize(handle);
    if (size <= 0n) return null;

    const ptr = await this.fn.readIccProfile(handle);
    if (!ptr) return null;

    const numSize = Number(size);
    const data = new Uint8Array(numSize);
    data.set(this.mod.HEAPU8.subarray(ptr, ptr + numSize));
    await this.fn.freeResult(ptr);
    return data.buffer;
  }

  // --- Filesystem helpers ---

  mountFiles(files: File[], mountId: string): string {
    const dir = `/mnt/${mountId}`;
    this.mod.FS.mkdir(dir);
    this.mod.FS.mount(this.mod.WORKERFS, { files }, dir);
    return `${dir}/${files[0].name}`;
  }

  /**
   * Mount files with directory structure (for multi-file formats like MRXS).
   *
   * WORKERFS mounts are flat — each mount point gets a set of files with no
   * subdirectories. So we group files by parent directory and create a separate
   * WORKERFS mount for each group. The root dir must be created with mkdir
   * first, then subdirectories get their own WORKERFS mounts.
   *
   * Layout for MRXS "image_1.mrxs" + "image_1/Slidedat.ini" + "image_1/Data0001.dat":
   *   /mnt/<id>/root/       ← WORKERFS mount with [image_1.mrxs]
   *   /mnt/<id>/root/image_1/ ← WORKERFS mount with [Slidedat.ini, Data0001.dat, ...]
   */
  mountDir(entries: VirtualFile[], indexFile: string, mountId: string): string {
    const base = `/mnt/${mountId}`;
    this.mod.FS.mkdir(base);
    const root = `${base}/root`;
    this.mod.FS.mkdir(root);

    // Group files by their immediate parent directory
    const dirs = new Map<string, File[]>();
    for (const entry of entries) {
      const lastSlash = entry.path.lastIndexOf('/');
      const dir = lastSlash > 0 ? entry.path.slice(0, lastSlash) : '';
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(entry.file);
    }

    // First: create all subdirectory paths (before any WORKERFS mounts)
    for (const dir of dirs.keys()) {
      if (!dir) continue;
      const parts = dir.split('/');
      let current = root;
      for (const part of parts) {
        current += '/' + part;
        try { this.mod.FS.mkdir(current); } catch { /* exists */ }
      }
    }

    // Mount root-level files at /mnt/<id>/root/ only if there are root files
    // BUT: we can only WORKERFS-mount on an empty directory, and we just created
    // subdirs under root. So root-level files must be written via MEMFS instead.
    const rootFiles = dirs.get('');
    if (rootFiles) {
      for (const file of rootFiles) {
        // Write file content to MEMFS — we need to read the File synchronously,
        // but we're in sync context. Use a WORKERFS trick: mount in a temp dir.
        const tmpDir = `${base}/tmp_${Math.random().toString(36).slice(2, 6)}`;
        this.mod.FS.mkdir(tmpDir);
        this.mod.FS.mount(this.mod.WORKERFS, { files: [file] }, tmpDir);
        // Read from temp and write to target
        const data = this.mod.FS.readFile(`${tmpDir}/${file.name}`);
        this.mod.FS.writeFile(`${root}/${file.name}`, data);
        this.mod.FS.unmount(tmpDir);
        this.mod.FS.rmdir(tmpDir);
      }
    }

    // Mount each subdirectory group via WORKERFS
    for (const [dir, files] of dirs) {
      if (!dir) continue; // root files already handled
      const mountPoint = `${root}/${dir}`;
      this.mod.FS.mount(this.mod.WORKERFS, { files }, mountPoint);
    }

    return `${root}/${indexFile}`;
  }

  mountUrl(url: string, mountId: string): string {
    const dir = `/mnt/${mountId}`;
    this.mod.FS.mkdir(dir);
    this.mod.FS.mount(this.mod.MEMFS, {}, dir);
    this.mod.FS.createLazyFile(dir, 'remote', url, true, false);
    return `${dir}/remote`;
  }

  unmount(mountId: string): void {
    const dir = `/mnt/${mountId}`;
    try {
      this.mod.FS.unmount(dir);
      this.mod.FS.rmdir(dir);
    } catch {
      // May already be unmounted
    }
  }
}
