import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDirectoryScanner, isDirectoryPickerSupported } from '../hooks/useDirectoryScanner';
import { wrapFileList } from '../lib/fileGrouper';
import { ALL_WSI_EXTENSIONS } from '../lib/wsiExtensions';
import { buildSlideTree, flattenVisible } from '../lib/buildSlideTree';
import type { SlideEntry } from '../types';

interface Props {
  onOpenSlide: (entry: SlideEntry) => void;
  openSlideIds: Set<string>;
}

let urlCounter = 0;

/** Fixed row height (px) — uniform rows keep the virtualizer config simple. */
const ROW_HEIGHT = 28;
const PICKED_KEY = 'picked';

/** A single rendered line in the (virtualized) explorer list. */
type Row =
  | { type: 'folderHeader'; key: string; folderId: string; name: string; count: number; scanning: boolean; collapsed: boolean }
  | { type: 'pickedHeader'; key: string; count: number; collapsed: boolean }
  | { type: 'dir'; key: string; collapseKey: string; depth: number; name: string; collapsed: boolean }
  | { type: 'slide'; key: string; depth: number; entry: SlideEntry }
  | { type: 'message'; key: string; text: string };

export function FileExplorer({ onOpenSlide, openSlideIds }: Props) {
  const { folders, pickAndScan, pickFolderViaInput, removeFolder, clearAll } = useDirectoryScanner();
  const [pickedSlides, setPickedSlides] = useState<SlideEntry[]>([]);
  const [query, setQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const folderInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scanning = folders.some((f) => f.scanning);
  const allErrors = folders.flatMap((f) => f.errors);
  const totalCount = folders.reduce((n, f) => n + f.slides.length, 0) + pickedSlides.length;

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Build the flat, currently-visible row list across every folder + the
  // picked-files group, honoring collapse state and the active filter.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const isFiltering = q.length > 0;
    const match = (s: SlideEntry) =>
      s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q);

    const out: Row[] = [];

    for (const folder of folders) {
      const folderCollapsed = collapsed.has(folder.id);
      out.push({
        type: 'folderHeader',
        key: `fh-${folder.id}`,
        folderId: folder.id,
        name: folder.rootName,
        count: folder.slides.length,
        scanning: folder.scanning,
        collapsed: folderCollapsed,
      });
      if (folderCollapsed) continue;

      const slides = isFiltering ? folder.slides.filter(match) : folder.slides;
      if (slides.length === 0) {
        const text = folder.scanning
          ? 'Scanning…'
          : isFiltering
            ? 'No matches'
            : 'No slides found';
        out.push({ type: 'message', key: `msg-${folder.id}`, text });
        continue;
      }

      const tree = buildSlideTree(slides);
      const flat = flattenVisible(tree, collapsed, `${folder.id}/`, isFiltering);
      for (const { node, depth } of flat) {
        if (node.type === 'dir') {
          const collapseKey = `${folder.id}/${node.key}`;
          out.push({
            type: 'dir',
            key: `dir-${folder.id}-${node.key}`,
            collapseKey,
            depth: depth + 1,
            name: node.name,
            collapsed: !isFiltering && collapsed.has(collapseKey),
          });
        } else {
          out.push({ type: 'slide', key: node.entry.id, depth: depth + 1, entry: node.entry });
        }
      }
    }

    if (pickedSlides.length > 0) {
      const pickedCollapsed = collapsed.has(PICKED_KEY);
      out.push({
        type: 'pickedHeader',
        key: 'ph',
        count: pickedSlides.length,
        collapsed: pickedCollapsed,
      });
      if (!pickedCollapsed) {
        const picked = isFiltering ? pickedSlides.filter(match) : pickedSlides;
        if (picked.length === 0) {
          out.push({ type: 'message', key: 'msg-picked', text: 'No matches' });
        } else {
          for (const entry of picked) {
            out.push({ type: 'slide', key: entry.id, depth: 1, entry });
          }
        }
      }
    }

    return out;
  }, [folders, pickedSlides, collapsed, query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => rows[i].key,
  });

  function handleOpenFolder() {
    if (isDirectoryPickerSupported) {
      pickAndScan();
    } else {
      folderInputRef.current?.click();
    }
  }

  function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    pickFolderViaInput(files);
    e.target.value = '';
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const entries = wrapFileList(files);
    setPickedSlides((prev) => {
      const newIds = new Set(entries.map((entry) => entry.id));
      return [...prev.filter((p) => !newIds.has(p.id)), ...entries];
    });
    e.target.value = '';
  }

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setUrlError('Not a valid URL.');
      return;
    }

    const filename =
      parsed.pathname.split('/').filter(Boolean).pop() || 'remote-slide';
    const ext = filename.includes('.')
      ? filename.split('.').pop()!.toLowerCase()
      : '';
    const format = ext ? ext.toUpperCase() : 'Remote';

    const entry: SlideEntry = {
      kind: 'url',
      id: `url-${Date.now()}-${urlCounter++}`,
      name: filename,
      path: trimmed,
      format,
      source: { mode: 'url', url: trimmed },
    };

    setPickedSlides((prev) => [...prev, entry]);
    setUrlInput('');
  }

  function handleClear() {
    clearAll();
    setPickedSlides([]);
    setQuery('');
    setUrlInput('');
    setUrlError(null);
    setCollapsed(new Set());
  }

  const acceptedExts = Array.from(ALL_WSI_EXTENSIONS).join(',');

  function renderRow(row: Row) {
    switch (row.type) {
      case 'folderHeader':
        return (
          <div className="fe-tree__folder">
            <button
              type="button"
              className="fe-tree__twisty"
              onClick={() => toggleCollapse(row.folderId)}
              aria-label={row.collapsed ? 'Expand folder' : 'Collapse folder'}
            >
              <Chevron open={!row.collapsed} />
            </button>
            <FolderIcon size={13} />
            <span className="fe-tree__folder-name" title={row.name}>{row.name}</span>
            {row.scanning ? (
              <span className="fe-tree__badge fe-tree__badge--busy">scanning…</span>
            ) : (
              <span className="fe-tree__badge">{row.count}</span>
            )}
            <button
              type="button"
              className="fe-tree__remove"
              onClick={() => removeFolder(row.folderId)}
              title="Remove folder"
              aria-label={`Remove folder ${row.name}`}
            >
              <CloseIcon />
            </button>
          </div>
        );
      case 'pickedHeader':
        return (
          <div className="fe-tree__folder">
            <button
              type="button"
              className="fe-tree__twisty"
              onClick={() => toggleCollapse(PICKED_KEY)}
              aria-label={row.collapsed ? 'Expand' : 'Collapse'}
            >
              <Chevron open={!row.collapsed} />
            </button>
            <FileIcon size={13} />
            <span className="fe-tree__folder-name">Files &amp; URLs</span>
            <span className="fe-tree__badge">{row.count}</span>
          </div>
        );
      case 'dir':
        return (
          <button
            type="button"
            className="fe-tree__dir"
            style={{ paddingLeft: 8 + row.depth * 14 }}
            onClick={() => toggleCollapse(row.collapseKey)}
          >
            <Chevron open={!row.collapsed} />
            <FolderIcon size={12} />
            <span className="fe-tree__dir-name" title={row.name}>{row.name}</span>
          </button>
        );
      case 'slide': {
        const isOpen = openSlideIds.has(row.entry.id);
        return (
          <button
            className={['fe-tree__slide', isOpen ? 'fe-tree__slide--open' : ''].join(' ')}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            onClick={() => onOpenSlide(row.entry)}
            title={row.entry.path}
          >
            <span className="fe-tree__slide-name">{row.entry.name}</span>
            <span className="fe-tree__slide-right">
              <span className="fe-tree__slide-format">{row.entry.format}</span>
              {isOpen && <span className="fe-tree__slide-dot" aria-label="open" />}
            </span>
          </button>
        );
      }
      case 'message':
        return <div className="fe-tree__message">{row.text}</div>;
    }
  }

  return (
    <aside className="file-explorer">
      <div className="file-explorer__header">
        <span className="file-explorer__title">Slides</span>
        {totalCount > 0 && (
          <span className="file-explorer__count">{totalCount}</span>
        )}
      </div>

      {/* ── File / folder picking ── */}
      <div className="file-explorer__actions">
        <button
          className="fe-btn fe-btn--primary fe-btn--full"
          onClick={handleOpenFolder}
        >
          <FolderIcon />
          Open Folder
        </button>

        <label className="fe-btn fe-btn--secondary fe-btn--full">
          <FileIcon />
          Pick File(s)
          <input
            type="file"
            multiple
            accept={acceptedExts}
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </label>

        {/* webkitdirectory fallback for Firefox / Safari */}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in React's HTMLInputElement type but is widely supported
          webkitdirectory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleFolderInput}
        />

        <p className="file-explorer__hint">
          Multi-file formats (MRXS, VMS, DICOM) require Open Folder. Open several folders to compare.
        </p>

        {totalCount > 0 && (
          <button className="fe-btn fe-btn--ghost fe-btn--full" onClick={handleClear}>
            Clear all
          </button>
        )}
      </div>

      {/* ── URL / HTTP range request loading ── */}
      <div className="file-explorer__url-section">
        <p className="file-explorer__section-label">Load from URL</p>
        <form className="file-explorer__url-form" onSubmit={handleUrlSubmit}>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
            placeholder="https://example.com/slide.svs"
            className="file-explorer__url-input"
            spellCheck={false}
          />
          <button
            type="submit"
            className="fe-btn fe-btn--secondary file-explorer__url-submit"
            disabled={!urlInput.trim()}
          >
            Load
          </button>
        </form>
        {urlError && <p className="file-explorer__url-error">{urlError}</p>}
        <p className="file-explorer__hint">
          Server must support HTTP range requests (<code>Accept-Ranges: bytes</code>).
        </p>
      </div>

      {/* ── Filter ── */}
      {totalCount > 5 && (
        <div className="file-explorer__search">
          <input
            type="search"
            placeholder="Filter slides…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="file-explorer__search-input"
          />
        </div>
      )}

      {/* ── Scan errors ── */}
      {allErrors.length > 0 && (
        <details className="file-explorer__errors">
          <summary>{allErrors.length} scan error{allErrors.length !== 1 ? 's' : ''}</summary>
          <ul>
            {allErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ── Slide tree (virtualized) ── */}
      {rows.length > 0 ? (
        <div ref={scrollRef} className="file-explorer__scroll">
          <div
            className="file-explorer__virtual"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                className="fe-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_HEIGHT,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {renderRow(rows[vi.index])}
              </div>
            ))}
          </div>
        </div>
      ) : (
        !scanning && (
          <p className="file-explorer__empty">
            Open a folder, pick files, or load from a URL.
          </p>
        )
      )}
    </aside>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`fe-tree__chevron ${open ? 'fe-tree__chevron--open' : ''}`}
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4V4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5L6.177 1.677A.25.25 0 0 0 6 1.61H1.75z" />
    </svg>
  );
}

function FileIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
    </svg>
  );
}
