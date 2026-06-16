import { useCallback, useState } from 'react';
import type { VirtualFile } from '@computationalpathologygroup/openslide-js';
import type { ScannedFolder, SlideEntry } from '../types';
import { groupFilesIntoSlides, type ScannedFile } from '../lib/fileGrouper';
import { SINGLE_FILE_EXTENSIONS, getFormatLabel } from '../lib/wsiExtensions';

/** Whether the File System Access API (showDirectoryPicker) is available */
export const isDirectoryPickerSupported =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let counter = 0;
function makeId() {
  return `slide-${Date.now()}-${counter++}`;
}

function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

/**
 * Max directories enumerated concurrently. Sibling subdirectories used to be
 * scanned strictly one-by-one, which serialized into minutes on large trees /
 * network shares; a bounded pool keeps many reads in flight without flooding a
 * slow share with thousands of simultaneous handle reads.
 */
const SCAN_CONCURRENCY = 12;

/**
 * Counting semaphore. A directory holds a slot only while *enumerating* its own
 * entries (the bounded-cost part) and releases before recursing into children,
 * so a parent never blocks waiting on children it is gating — no deadlock.
 */
class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // hand the slot directly to the next waiter
    else this.active--;
  }
}

/**
 * Recursively scan a directory tree (File System Access API), emitting
 * SlideEntry records that hold **handles**, not bytes. Nothing is read until a
 * slide is opened (see resolveSlideSource). Detects:
 *   - single-file formats (.svs, .ndpi, .scn, .tiff…)
 *   - .mrxs + its companion directory (same base name, case-insensitive)
 *   - DICOM folders (subdirectories containing ≥1 .dcm)
 *   - .vms + same-directory companions (read eagerly; rare format)
 *
 * Results are streamed via `emit` as they are discovered so the UI can show
 * progress instead of waiting for the whole tree, and each directory is
 * enumerated exactly **once** (DICOM is detected from the directory's own files
 * rather than a separate pre-count pass over every child).
 */
async function scanDir(
  dirHandle: FileSystemDirectoryHandle,
  pathPrefix: string,
  errors: string[],
  emit: (slides: SlideEntry[]) => void,
  sem: Semaphore,
): Promise<void> {
  const fileHandles = new Map<string, FileSystemFileHandle>();
  const dirHandles = new Map<string, FileSystemDirectoryHandle>();

  await sem.acquire();
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') fileHandles.set(entry.name, entry as FileSystemFileHandle);
      else dirHandles.set(entry.name, entry as FileSystemDirectoryHandle);
    }
  } finally {
    sem.release();
  }

  // DICOM folder: a non-root directory that directly contains ≥1 .dcm is one
  // slide; don't descend into it or list its files individually. (The root is
  // scanned normally — never collapsed into a single DICOM slide.)
  if (pathPrefix !== '') {
    let dcmCount = 0;
    for (const name of fileHandles.keys()) {
      if (name.toLowerCase().endsWith('.dcm')) dcmCount++;
    }
    if (dcmCount > 0) {
      const dirName = pathPrefix.slice(pathPrefix.lastIndexOf('/') + 1);
      emit([
        {
          kind: 'multi',
          id: makeId(),
          name: `${dirName} (DICOM, ${dcmCount} files)`,
          path: pathPrefix,
          format: 'DCM',
          source: { mode: 'dcmHandle', dcmDirHandle: dirHandle },
        },
      ]);
      return;
    }
  }

  // Case-insensitive directory lookup for MRXS companion matching
  const dirByLower = new Map<string, FileSystemDirectoryHandle>();
  for (const [n, h] of dirHandles) dirByLower.set(n.toLowerCase(), h);

  const consumedDirs = new Set<string>(); // lowercased companion dir names
  const localSlides: SlideEntry[] = [];

  for (const [name, fileHandle] of fileHandles) {
    const ext = extOf(name);
    const displayPath = pathPrefix ? `${pathPrefix}/${name}` : name;

    if (SINGLE_FILE_EXTENSIONS.has(ext)) {
      localSlides.push({
        kind: 'single',
        id: makeId(),
        name,
        path: displayPath,
        format: getFormatLabel(ext),
        source: { mode: 'fileHandle', handle: fileHandle },
      });
    } else if (ext === '.mrxs') {
      const companionDirHandle = dirByLower.get(baseName(name).toLowerCase());
      if (companionDirHandle) {
        consumedDirs.add(companionDirHandle.name.toLowerCase());
        localSlides.push({
          kind: 'multi',
          id: makeId(),
          name,
          path: displayPath,
          format: 'MRXS',
          source: {
            mode: 'mrxsHandles',
            indexName: name,
            indexHandle: fileHandle,
            companionDirHandle,
          },
        });
      } else {
        errors.push(`${displayPath}: no companion directory "${baseName(name)}/" found — skipped`);
      }
    } else if (ext === '.vms') {
      const stem = baseName(name);
      const entries: VirtualFile[] = [{ path: name, file: await fileHandle.getFile() }];
      for (const [sName, sHandle] of fileHandles) {
        if (sName === name) continue;
        if (sName.startsWith(stem) || sName.toLowerCase().endsWith('.jpg')) {
          entries.push({ path: sName, file: await sHandle.getFile() });
        }
      }
      localSlides.push({
        kind: 'multi',
        id: makeId(),
        name,
        path: displayPath,
        format: 'VMS',
        source: { mode: 'entries', entries },
      });
    }
  }

  if (localSlides.length > 0) emit(localSlides);

  // Recurse into the remaining subdirectories concurrently (bounded by the
  // shared semaphore). Order doesn't matter — the tree view sorts for display.
  const childScans: Promise<void>[] = [];
  for (const [dirName, subHandle] of dirHandles) {
    if (consumedDirs.has(dirName.toLowerCase())) continue; // mrxs companion dir
    const subPrefix = pathPrefix ? `${pathPrefix}/${dirName}` : dirName;
    childScans.push(scanDir(subHandle, subPrefix, errors, emit, sem));
  }
  await Promise.all(childScans);
}

export function useDirectoryScanner() {
  const [folders, setFolders] = useState<ScannedFolder[]>([]);

  const pickAndScan = useCallback(async (): Promise<void> => {
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (
        window as typeof window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker();
    } catch (err: unknown) {
      // User cancelled the picker — not an error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      const id = makeId();
      setFolders((prev) => [
        ...prev,
        { id, rootName: 'Folder', slides: [], errors: [msg], scanning: false },
      ]);
      return;
    }

    const folderId = makeId();
    setFolders((prev) => [
      ...prev,
      { id: folderId, rootName: dirHandle.name, slides: [], errors: [], scanning: true },
    ]);

    // Stream discovered slides into state, batched (~one render / 50ms) so a
    // large scan stays responsive instead of re-rendering per file.
    const all: SlideEntry[] = [];
    const errors: string[] = [];
    let buffer: SlideEntry[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const flush = () => {
      flushTimer = null;
      if (done || buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, slides: [...f.slides, ...batch] } : f)),
      );
    };
    const emit = (slides: SlideEntry[]) => {
      all.push(...slides);
      buffer.push(...slides);
      if (flushTimer === null) flushTimer = setTimeout(flush, 50);
    };

    try {
      const sem = new Semaphore(SCAN_CONCURRENCY);
      await scanDir(dirHandle, '', errors, emit, sem);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
    } finally {
      done = true;
      if (flushTimer !== null) clearTimeout(flushTimer);
      all.sort((a, b) => a.path.localeCompare(b.path));
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId ? { ...f, slides: all, errors, scanning: false } : f,
        ),
      );
    }
  }, []);

  /** Process files from a <input webkitdirectory> element — Firefox/Safari fallback */
  const pickFolderViaInput = useCallback((fileList: FileList) => {
    const rawFiles: ScannedFile[] = Array.from(fileList).map((f) => ({
      path: f.webkitRelativePath || f.name,
      name: f.name,
      file: f,
    }));
    const slides = groupFilesIntoSlides(rawFiles);
    slides.sort((a, b) => a.path.localeCompare(b.path));
    const rootName = fileList[0]?.webkitRelativePath?.split('/')[0] ?? 'Folder';
    setFolders((prev) => [
      ...prev,
      { id: makeId(), rootName, slides, errors: [], scanning: false },
    ]);
  }, []);

  const removeFolder = useCallback((id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFolders([]);
  }, []);

  return {
    folders,
    pickAndScan,
    pickFolderViaInput,
    removeFolder,
    clearAll,
    isSupported: isDirectoryPickerSupported,
  };
}
