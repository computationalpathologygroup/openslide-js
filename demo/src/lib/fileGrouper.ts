import type { VirtualFile } from '@computationalpathologygroup/openslide-js';
import type { SlideEntry } from '../types';
import {
  SINGLE_FILE_EXTENSIONS,
  MULTI_FILE_PRIMARY_EXTENSIONS,
  getFormatLabel,
} from './wsiExtensions';

let counter = 0;
function makeId() {
  return `slide-${Date.now()}-${counter++}`;
}

/** Flat record of all files in a scanned directory, keyed by their full path */
export interface ScannedFile {
  path: string; // full path relative to the root, e.g. "subdir/slide.mrxs"
  name: string; // filename only
  file: File;
}

/** Strip the extension, e.g. "slide.mrxs" → "slide". */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Group a flat list of scanned files (from the webkitdirectory / file-picker
 * fallback, where only `File` objects exist) into SlideEntry records with
 * **eager** `source` descriptors. The File System Access scanner uses a
 * separate handle-based path; this is only the fallback builder.
 *
 * Multi-file formats bundle their companion files as a `VirtualFile[]`. MRXS
 * companion paths are taken from the real directory segment of each file's
 * path (case-insensitive matching), guaranteeing `image/Slidedat.ini`.
 */
export function groupFilesIntoSlides(files: ScannedFile[]): SlideEntry[] {
  const slides: SlideEntry[] = [];
  const usedPaths = new Set<string>();

  // --- MRXS: .mrxs primary + sibling dir of same base name ---
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.mrxs')) continue;
    if (usedPaths.has(f.path)) continue;

    const parts = f.path.split('/');
    const parentParts = parts.slice(0, -1);
    const companion = baseName(f.name);
    // "<parent>/<base>/" — matched case-insensitively against companion files
    const companionPrefix = [...parentParts, companion, ''].join('/').toLowerCase();

    const companions = files.filter(
      (c) => c !== f && !usedPaths.has(c.path) && c.path.toLowerCase().startsWith(companionPrefix),
    );

    if (companions.length === 0) {
      // No companion dir → still list it so the user sees it (open will report
      // the missing companion directory clearly).
      usedPaths.add(f.path);
      slides.push({
        kind: 'multi',
        id: makeId(),
        name: f.name,
        path: f.path,
        format: 'MRXS',
        source: { mode: 'entries', entries: [{ path: f.name, file: f.file }] },
      });
      continue;
    }

    const entries: VirtualFile[] = [
      { path: f.name, file: f.file },
      ...companions.map((c) => ({
        // Path relative to the .mrxs parent. The companion directory is mounted
        // under the **index-derived base name** (`companion`), not its real
        // on-disk casing: OpenSlide's MIRAX reader strips ".mrxs" from the index
        // filename and looks for "<base>/Slidedat.ini" in the case-sensitive WASM
        // FS. A share whose folder casing differs (e.g. samba) would otherwise
        // 404 → "Failed to open slide". Tail after the companion dir is kept.
        path: [companion, ...c.path.split('/').slice(parentParts.length + 1)].join('/'),
        file: c.file,
      })),
    ];
    usedPaths.add(f.path);
    companions.forEach((c) => usedPaths.add(c.path));
    slides.push({
      kind: 'multi',
      id: makeId(),
      name: f.name,
      path: f.path,
      format: 'MRXS',
      source: { mode: 'entries', entries },
    });
  }

  // --- VMS: .vms primary + sibling files in same directory ---
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.vms')) continue;
    if (usedPaths.has(f.path)) continue;

    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
    const stem = baseName(f.name);

    const companions = files.filter(
      (c) =>
        c !== f &&
        !usedPaths.has(c.path) &&
        c.path.startsWith(dir) &&
        !c.path.slice(dir.length).includes('/') && // same directory level
        (c.name.startsWith(stem) || c.name.toLowerCase().endsWith('.jpg')),
    );

    const entries: VirtualFile[] = [
      { path: f.name, file: f.file },
      ...companions.map((c) => ({ path: c.name, file: c.file })),
    ];
    usedPaths.add(f.path);
    companions.forEach((c) => usedPaths.add(c.path));
    slides.push({
      kind: 'multi',
      id: makeId(),
      name: f.name,
      path: f.path,
      format: 'VMS',
      source: { mode: 'entries', entries },
    });
  }

  // --- DICOM: group .dcm files by their parent directory ---
  const dcmByDir = new Map<string, ScannedFile[]>();
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.dcm')) continue;
    if (usedPaths.has(f.path)) continue;
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const group = dcmByDir.get(dir) ?? [];
    group.push(f);
    dcmByDir.set(dir, group);
  }
  for (const [dir, dcmFiles] of dcmByDir) {
    dcmFiles.forEach((f) => usedPaths.add(f.path));
    const dirName = dir ? dir.split('/').pop()! : 'DICOM';
    const entries: VirtualFile[] = dcmFiles.map((f) => ({
      path: `${dirName}/${f.name}`,
      file: f.file,
    }));
    slides.push({
      kind: 'multi',
      id: makeId(),
      name: `${dirName} (DICOM, ${dcmFiles.length} files)`,
      path: dir,
      format: 'DCM',
      source: { mode: 'entries', entries },
    });
  }

  // --- Single-file formats ---
  for (const f of files) {
    if (usedPaths.has(f.path)) continue;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!SINGLE_FILE_EXTENSIONS.has(ext) && !MULTI_FILE_PRIMARY_EXTENSIONS.has(ext)) continue;

    usedPaths.add(f.path);
    slides.push({
      kind: 'single',
      id: makeId(),
      name: f.name,
      path: f.path,
      format: getFormatLabel(ext),
      source: { mode: 'file', file: f.file },
    });
  }

  return slides;
}

/** Wrap manually selected File objects (from <input type="file">) into SlideEntry[] */
export function wrapFileList(fileList: FileList): SlideEntry[] {
  const scanned: ScannedFile[] = Array.from(fileList).map((f) => ({
    path: f.webkitRelativePath || f.name,
    name: f.name,
    file: f,
  }));
  return groupFilesIntoSlides(scanned);
}
