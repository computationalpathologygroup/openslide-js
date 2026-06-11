import type { VirtualFile } from '@computationalpathologygroup/openslide-js';

/**
 * Describes how to obtain the bytes for a slide. Resolved lazily into a
 * `File | VirtualFile[] | string` by `resolveSlideSource()` at open time.
 *
 * Handle-based modes (`fileHandle`, `mrxsHandles`, `dcmHandle`) are produced by
 * the File System Access scan and read nothing until the slide is opened.
 * Eager modes (`file`, `entries`) come from the webkitdirectory / file-picker
 * fallback where only `File` objects are available. `url` is a remote slide
 * served over HTTP range requests.
 */
export type OpenSlideSource =
  | { mode: 'file'; file: File }
  | { mode: 'fileHandle'; handle: FileSystemFileHandle }
  | { mode: 'entries'; entries: VirtualFile[] }
  | {
      mode: 'mrxsHandles';
      indexName: string;
      indexHandle: FileSystemFileHandle;
      companionDirHandle: FileSystemDirectoryHandle;
    }
  | { mode: 'dcmHandle'; dcmDirHandle: FileSystemDirectoryHandle }
  | { mode: 'url'; url: string };

/**
 * A slide listed in the explorer. `kind` drives display only (icon/label);
 * the actual bytes are obtained from `source`.
 */
export interface SlideEntry {
  /** 'single' = one file · 'multi' = file + companions · 'url' = remote */
  kind: 'single' | 'multi' | 'url';
  id: string;
  name: string;
  path: string;
  format: string;
  source: OpenSlideSource;
}

/** State of a slide pane currently open in the viewer */
export interface OpenSlide {
  id: string;
  entry: SlideEntry;
}

export interface DirectoryScanResult {
  slides: SlideEntry[];
  errors: string[];
}

/** An associated image (thumbnail, macro, label) read from a slide */
export interface AssociatedImage {
  name: string;
  /** Object URL (OffscreenCanvas blob) or data URL — revoke object URLs on cleanup */
  dataUrl: string;
  width: number;
  height: number;
}

/** Metadata extracted from an open slide — safe to retain after slide.close() */
export interface SlideMeta {
  dimensions: { width: number; height: number };
  levelCount: number;
  levelDimensions: ReadonlyArray<{ width: number; height: number }>;
  levelDownsamples: ReadonlyArray<number>;
  /** Copy of slide.properties — remains valid after slide is closed */
  properties: ReadonlyMap<string, string>;
  associatedImages: AssociatedImage[];
}
