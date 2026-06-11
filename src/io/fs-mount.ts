/**
 * io/fs-mount.ts
 *
 * Broker-backed file nodes for the Emscripten FS, replacing createLazyFile's
 * sync-XHR/byte-at-a-time read path and WORKERFS's uncached FileReaderSync
 * reads. A node is created via FS.createLazyFile (never triggering its lazy
 * fetch), then its `contents` is swapped for a `{ length }` facade (the
 * non-configurable `usedBytes` getter reads it, keeping stat sizes right)
 * and its `stream_ops` replaced with bulk block-copy reads served by the
 * SyncIo channel. Nodes are read-only: created with canWrite=false and no
 * `write` stream op, exactly like the legacy mounts.
 */

import { EINVAL, EIO } from './protocol.js';
import { SyncIo, SyncIoError } from './sync-client.js';
import type { OpenSlideWasmModule, VirtualFile } from '../types.js';

interface FsNodeLike {
  contents: unknown;
  stream_ops: unknown;
}

interface FsStreamLike {
  position: number;
}

/** Key under which a local File is cached broker-side; equal Files coming
 *  from several workers (structured clones of the same pick) share it. */
export function fileKeyForFile(file: File): string {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

export function fileKeyForUrl(url: string): string {
  return `url:${url}`;
}

/** Create a read-only FS file node whose reads go through the broker. */
export function createBrokerFile(
  mod: OpenSlideWasmModule,
  parentPath: string,
  name: string,
  fileKey: string,
  size: number,
  io: SyncIo,
): void {
  const FS = mod.FS;
  const node = FS.createLazyFile(parentPath, name, `broker://${fileKey}`, true, false) as FsNodeLike;

  // The lazy node's non-configurable `usedBytes` getter returns
  // `this.contents.length`; the facade satisfies it without ever touching
  // the LazyUint8Array (whose first access would fire a sync XHR).
  node.contents = { length: size };

  node.stream_ops = {
    read(_stream: FsStreamLike, buffer: Uint8Array, offset: number, length: number, position: number): number {
      if (position >= size || length <= 0) return 0;
      try {
        return io.readInto(fileKey, size, position, length, buffer, offset);
      } catch (err) {
        throw new FS.ErrnoError(err instanceof SyncIoError ? err.errno : EIO);
      }
    },
    llseek(stream: FsStreamLike, offset: number, whence: number): number {
      let position = offset;
      if (whence === 1) {
        position += stream.position;
      } else if (whence === 2) {
        position += size;
      }
      if (position < 0) throw new FS.ErrnoError(EINVAL);
      return position;
    },
  };
}

/** Mount a remote URL through the broker. Async: stats the URL first. */
export async function mountUrlViaBroker(
  mod: OpenSlideWasmModule,
  url: string,
  mountId: string,
  io: SyncIo,
): Promise<{ path: string; fileKeys: string[] }> {
  const fileKey = fileKeyForUrl(url);
  const size = await io.registerUrl(fileKey, url);
  const dir = `/mnt/${mountId}`;
  mod.FS.mkdir(dir);
  mod.FS.mount(mod.MEMFS, {}, dir);
  createBrokerFile(mod, dir, 'remote', fileKey, size, io);
  return { path: `${dir}/remote`, fileKeys: [fileKey] };
}

/** Mount a flat list of local Files through the broker. */
export function mountFilesViaBroker(
  mod: OpenSlideWasmModule,
  files: File[],
  mountId: string,
  io: SyncIo,
): { path: string; fileKeys: string[] } {
  const dir = `/mnt/${mountId}`;
  mod.FS.mkdir(dir);
  mod.FS.mount(mod.MEMFS, {}, dir);

  const regs = files.map((file) => ({ fileKey: fileKeyForFile(file), file, size: file.size }));
  // Port messages are ordered, so the registration reaches the broker before
  // any read for these keys can.
  io.registerFiles(regs);
  for (const reg of regs) {
    createBrokerFile(mod, dir, reg.file.name, reg.fileKey, reg.size, io);
  }
  return { path: `${dir}/${files[0].name}`, fileKeys: regs.map((r) => r.fileKey) };
}

/**
 * Mount a multi-file slide (MRXS/VMS/DICOM) through the broker. Unlike the
 * WORKERFS version there is a single MEMFS mount: plain mkdir for the tree,
 * one broker-backed node per file — root files need no special-casing.
 */
export function mountDirViaBroker(
  mod: OpenSlideWasmModule,
  entries: VirtualFile[],
  indexFile: string,
  mountId: string,
  io: SyncIo,
): { path: string; fileKeys: string[] } {
  const base = `/mnt/${mountId}`;
  mod.FS.mkdir(base);
  mod.FS.mount(mod.MEMFS, {}, base);
  const root = `${base}/root`;
  mod.FS.mkdir(root);

  const made = new Set<string>();
  const regs = entries.map((entry) => ({ fileKey: fileKeyForFile(entry.file), file: entry.file, size: entry.file.size }));
  io.registerFiles(regs);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const lastSlash = entry.path.lastIndexOf('/');
    let parent = root;
    if (lastSlash > 0) {
      const parts = entry.path.slice(0, lastSlash).split('/');
      for (const part of parts) {
        parent += '/' + part;
        if (!made.has(parent)) {
          try { mod.FS.mkdir(parent); } catch { /* exists */ }
          made.add(parent);
        }
      }
    }
    const name = entry.path.slice(lastSlash + 1);
    createBrokerFile(mod, parent, name, regs[i].fileKey, regs[i].size, io);
  }

  return { path: `${root}/${indexFile}`, fileKeys: regs.map((r) => r.fileKey) };
}
