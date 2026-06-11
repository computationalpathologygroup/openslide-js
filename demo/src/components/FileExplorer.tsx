import { useRef, useState } from 'react';
import { useDirectoryScanner, isDirectoryPickerSupported } from '../hooks/useDirectoryScanner';
import { wrapFileList } from '../lib/fileGrouper';
import { ALL_WSI_EXTENSIONS } from '../lib/wsiExtensions';
import type { SlideEntry } from '../types';

interface Props {
  onOpenSlide: (entry: SlideEntry) => void;
  openSlideIds: Set<string>;
}

let urlCounter = 0;

export function FileExplorer({ onOpenSlide, openSlideIds }: Props) {
  const { slides: scannedSlides, scanning, errors, rootName, pickAndScan, pickFolderViaInput, clearSlides } =
    useDirectoryScanner();
  const [pickedSlides, setPickedSlides] = useState<SlideEntry[]>([]);
  const [query, setQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);

  const allSlides = [...scannedSlides, ...pickedSlides];

  const filtered = query.trim()
    ? allSlides.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.path.toLowerCase().includes(query.toLowerCase()),
      )
    : allSlides;

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
    setPickedSlides([]);
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
    clearSlides();
    setPickedSlides([]);
    setQuery('');
    setUrlInput('');
    setUrlError(null);
  }

  const acceptedExts = Array.from(ALL_WSI_EXTENSIONS).join(',');
  const totalCount = allSlides.length;

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
          disabled={scanning}
        >
          <FolderIcon />
          {scanning ? 'Scanning…' : 'Open Folder'}
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
          Multi-file formats (MRXS, VMS, DICOM) require Open Folder.
        </p>

        {totalCount > 0 && (
          <button className="fe-btn fe-btn--ghost fe-btn--full" onClick={handleClear}>
            Clear list
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

      {/* ── Root folder name ── */}
      {rootName && (
        <div className="file-explorer__root" title={rootName}>
          <FolderIcon size={12} />
          <span>{rootName}</span>
        </div>
      )}

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
      {errors.length > 0 && (
        <details className="file-explorer__errors">
          <summary>{errors.length} scan error{errors.length !== 1 ? 's' : ''}</summary>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ── Slide list ── */}
      <ul className="file-explorer__list">
        {filtered.map((entry) => {
          const isOpen = openSlideIds.has(entry.id);
          return (
            <li key={entry.id} className="file-explorer__item">
              <button
                className={[
                  'file-explorer__item-btn',
                  isOpen ? 'file-explorer__item-btn--open' : '',
                ].join(' ')}
                onClick={() => onOpenSlide(entry)}
                title={entry.path}
              >
                <span className="file-explorer__item-name">{entry.name}</span>
                <span className="file-explorer__item-right">
                  <span className="file-explorer__item-format">{entry.format}</span>
                  {isOpen && <span className="file-explorer__item-dot" aria-label="open" />}
                </span>
              </button>
            </li>
          );
        })}

        {filtered.length === 0 && totalCount > 0 && query && (
          <li className="file-explorer__no-results">
            No matches for &ldquo;{query}&rdquo;
          </li>
        )}
      </ul>

      {totalCount === 0 && !scanning && (
        <p className="file-explorer__empty">
          Open a folder, pick files, or load from a URL.
        </p>
      )}
    </aside>
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
