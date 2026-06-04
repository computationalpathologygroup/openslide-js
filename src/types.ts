/** Width and height in pixels. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/** Complete metadata returned when a slide is opened. */
export interface SlideInfo {
  readonly levelCount: number;
  readonly levelDimensions: readonly Dimensions[];
  readonly levelDownsamples: readonly number[];
  readonly properties: ReadonlyMap<string, string>;
  readonly associatedImageNames: readonly string[];
}

/** Deep Zoom Image descriptor info. */
export interface DziInfo {
  readonly tileSize: number;
  readonly overlap: number;
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

/** Options for OpenSlide.initialize(). */
export interface OpenSlideOptions {
  /** Number of Web Workers to spawn (default: navigator.hardwareConcurrency or 4). */
  workerCount?: number;
  /** Custom URL to the WASM module loader JS file. */
  wasmUrl?: string;
  /** Custom URL to the worker JS file (required for CJS/non-ESM environments). */
  workerUrl?: string;
}

/** Source that can be opened as a slide. */
export type SlideSource = File | File[] | VirtualFile[] | URL | string;

/** A file with a relative path, used for multi-file formats (MIRAX, VMS, DICOM). */
export interface VirtualFile {
  readonly path: string;
  readonly file: File;
}

/**
 * Messages sent from the main thread to a worker.
 * Each command has a unique `id` so responses can be matched.
 */
export type WorkerCommand =
  | { id: number; cmd: 'init'; wasmUrl?: string }
  | { id: number; cmd: 'open'; mountId: string }
  | { id: number; cmd: 'close'; handle: number }
  | { id: number; cmd: 'getSlideInfo'; handle: number }
  | { id: number; cmd: 'readRegion'; handle: number; x: number; y: number; level: number; w: number; h: number }
  | { id: number; cmd: 'readAssociatedImage'; handle: number; name: string }
  | { id: number; cmd: 'getAssociatedImageDimensions'; handle: number; name: string }
  | { id: number; cmd: 'detectVendor'; mountId: string }
  | { id: number; cmd: 'getVersion' }
  | { id: number; cmd: 'getIccProfile'; handle: number }
  | { id: number; cmd: 'mountFile'; files: File[]; mountId: string }
  | { id: number; cmd: 'mountDir'; entries: VirtualFile[]; indexFile: string; mountId: string }
  | { id: number; cmd: 'mountUrl'; url: string; mountId: string }
  | { id: number; cmd: 'unmount'; mountId: string };

/** Messages sent from a worker back to the main thread. */
export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/**
 * Emscripten module shape we expect after createOpenSlideModule() resolves.
 * Only the parts we use are typed here.
 */
export interface OpenSlideWasmModule {
  cwrap: (name: string, returnType: string | null, argTypes: string[], opts?: { async?: boolean }) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number) => string;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAP64: BigInt64Array;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  FS: EmscriptenFS;
  MEMFS: unknown;
  WORKERFS: unknown;
}

export interface EmscriptenFS {
  mkdir: (path: string) => void;
  rmdir: (path: string) => void;
  unlink: (path: string) => void;
  mount: (type: unknown, opts: Record<string, unknown>, mountpoint: string) => unknown;
  unmount: (mountpoint: string) => void;
  readdir: (path: string) => string[];
  readFile: (path: string, opts?: { encoding?: string }) => Uint8Array;
  writeFile: (path: string, data: Uint8Array) => void;
  createLazyFile: (parent: string, name: string, url: string, canRead: boolean, canWrite: boolean) => unknown;
}
