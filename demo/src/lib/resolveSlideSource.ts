import type { VirtualFile } from '@computationalpathologygroup/openslide-js';
import type { SlideEntry } from '../types';
import { baseName } from './fileGrouper';

/**
 * Resolve a slide's `source` descriptor into the value that
 * `openslide.open()` accepts: a single `File`, a `VirtualFile[]` (multi-file
 * formats), or a URL `string` (remote).
 *
 * Handle-based modes read their bytes here, lazily, at open time — nothing is
 * read during the directory scan. For MRXS the companion files are walked live
 * from the directory handle and prefixed with the **real directory name**
 * (`companionDirHandle.name`), guaranteeing paths like `image/Slidedat.ini`
 * that OpenSlide's MRXS reader expects.
 */
export async function resolveSlideSource(
  entry: SlideEntry,
): Promise<File | VirtualFile[] | string> {
  const src = entry.source;

  switch (src.mode) {
    case 'file':
      return src.file;

    case 'url':
      return src.url;

    case 'entries':
      return src.entries;

    case 'fileHandle':
      return src.handle.getFile();

    case 'mrxsHandles': {
      // Index file (e.g. "image.mrxs") at the root, then every companion file
      // under "<dirName>/…" so OpenSlide finds image/Slidedat.ini etc.
      const entries: VirtualFile[] = [
        { path: src.indexName, file: await src.indexHandle.getFile() },
      ];
      // Mount the companion directory under the **index-derived base name**, not
      // the real on-disk folder casing. OpenSlide's MIRAX reader strips ".mrxs"
      // from the index filename and looks for "<base>/Slidedat.ini" in the
      // case-sensitive WASM FS; a share whose folder casing differs (e.g. samba,
      // matched case-insensitively during the scan) would otherwise 404 →
      // "Failed to open slide: /mnt/…/root/…".
      const companionRoot = baseName(src.indexName);
      await collectCompanion(src.companionDirHandle, companionRoot, entries);
      return entries;
    }

    case 'dcmHandle': {
      const entries: VirtualFile[] = [];
      const dirName = src.dcmDirHandle.name;
      for await (const child of src.dcmDirHandle.values()) {
        if (child.kind === 'file' && child.name.toLowerCase().endsWith('.dcm')) {
          entries.push({
            path: `${dirName}/${child.name}`,
            file: await (child as FileSystemFileHandle).getFile(),
          });
        }
      }
      if (entries.length === 0) throw new Error('No .dcm files found in folder');
      return entries;
    }
  }
}

/** Recursively collect every file under a directory handle into `entries`. */
async function collectCompanion(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  entries: VirtualFile[],
): Promise<void> {
  for await (const child of dir.values()) {
    const childPath = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.kind === 'file') {
      entries.push({ path: childPath, file: await (child as FileSystemFileHandle).getFile() });
    } else if (child.kind === 'directory') {
      await collectCompanion(child as FileSystemDirectoryHandle, childPath, entries);
    }
  }
}
