import { useState, useCallback } from 'react';
import type { VirtualFile } from '@computationalpathologygroup/openslide-js';
import type { DirectoryScanResult, SlideEntry } from '../types';
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
 * Recursively scan a directory tree (File System Access API) into SlideEntry
 * records that hold **handles**, not bytes. Nothing is read until a slide is
 * opened (see resolveSlideSource). Detects:
 *   - single-file formats (.svs, .ndpi, .scn, .tiff…)
 *   - .mrxs + its companion directory (same base name, case-insensitive)
 *   - DICOM folders (subdirectories containing ≥1 .dcm)
 *   - .vms + same-directory companions (read eagerly; rare format)
 */
async function scanForSlides(
  dirHandle: FileSystemDirectoryHandle,
  pathPrefix: string,
  errors: string[],
): Promise<SlideEntry[]> {
  const fileHandles = new Map<string, FileSystemFileHandle>();
  const dirHandles = new Map<string, FileSystemDirectoryHandle>();

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') fileHandles.set(entry.name, entry as FileSystemFileHandle);
    else dirHandles.set(entry.name, entry as FileSystemDirectoryHandle);
  }

  // Case-insensitive directory lookup for MRXS companion matching
  const dirByLower = new Map<string, FileSystemDirectoryHandle>();
  for (const [n, h] of dirHandles) dirByLower.set(n.toLowerCase(), h);

  const slides: SlideEntry[] = [];
  const consumedDirs = new Set<string>(); // lowercased companion dir names

  for (const [name, fileHandle] of fileHandles) {
    const ext = extOf(name);
    const displayPath = pathPrefix ? `${pathPrefix}/${name}` : name;

    if (SINGLE_FILE_EXTENSIONS.has(ext)) {
      slides.push({
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
        slides.push({
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
      slides.push({
        kind: 'multi',
        id: makeId(),
        name,
        path: displayPath,
        format: 'VMS',
        source: { mode: 'entries', entries },
      });
    }
  }

  // Subdirectories: DICOM folders, then recurse into the rest
  for (const [dirName, subHandle] of dirHandles) {
    if (consumedDirs.has(dirName.toLowerCase())) continue; // mrxs companion dir

    // Count .dcm files (metadata only, no getFile)
    let dcmCount = 0;
    for await (const child of subHandle.values()) {
      if (child.kind === 'file' && child.name.toLowerCase().endsWith('.dcm')) dcmCount++;
    }

    if (dcmCount > 0) {
      const displayPath = pathPrefix ? `${pathPrefix}/${dirName}` : dirName;
      slides.push({
        kind: 'multi',
        id: makeId(),
        name: `${dirName} (DICOM, ${dcmCount} files)`,
        path: displayPath,
        format: 'DCM',
        source: { mode: 'dcmHandle', dcmDirHandle: subHandle },
      });
      continue; // don't recurse into DICOM folders
    }

    const subPrefix = pathPrefix ? `${pathPrefix}/${dirName}` : dirName;
    slides.push(...(await scanForSlides(subHandle, subPrefix, errors)));
  }

  return slides;
}

interface ScanState {
  scanning: boolean;
  slides: SlideEntry[];
  errors: string[];
  rootName: string | null;
}

export function useDirectoryScanner() {
  const [state, setState] = useState<ScanState>({
    scanning: false,
    slides: [],
    errors: [],
    rootName: null,
  });

  const pickAndScan = useCallback(async (): Promise<DirectoryScanResult> => {
    setState((s) => ({ ...s, scanning: true }));

    try {
      const dirHandle = await (
        window as typeof window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker();

      const errors: string[] = [];
      const slides = await scanForSlides(dirHandle, '', errors);
      slides.sort((a, b) => a.path.localeCompare(b.path));

      setState({ scanning: false, slides, errors, rootName: dirHandle.name });
      return { slides, errors };
    } catch (err: unknown) {
      // User cancelled the picker — not an error
      if (err instanceof DOMException && err.name === 'AbortError') {
        setState((s) => ({ ...s, scanning: false }));
        return { slides: [], errors: [] };
      }
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, scanning: false, errors: [msg] }));
      return { slides: [], errors: [msg] };
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
    const rootName = fileList[0]?.webkitRelativePath?.split('/')[0] ?? null;
    setState({ scanning: false, slides, errors: [], rootName });
  }, []);

  const clearSlides = useCallback(() => {
    setState({ scanning: false, slides: [], errors: [], rootName: null });
  }, []);

  return { ...state, pickAndScan, pickFolderViaInput, clearSlides, isSupported: isDirectoryPickerSupported };
}
