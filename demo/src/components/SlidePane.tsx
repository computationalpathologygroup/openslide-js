import { useState } from 'react';
import { OpenSlideViewer } from './OpenSlideViewer';
import { SlideInfoPanel } from './SlideInfoPanel';
import type { SlideEntry, SlideMeta } from '../types';

interface Props {
  entry: SlideEntry;
  onClose: (id: string) => void;
}

export function SlidePane({ entry, onClose }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const [meta, setMeta] = useState<SlideMeta | null>(null);

  return (
    <div className="slide-pane">
      <div className="slide-pane__header">
        <span className="slide-pane__name" title={entry.path}>
          {entry.name}
        </span>
        <span className="slide-pane__format">{entry.format}</span>
        <button
          className={`slide-pane__icon-btn${showInfo ? ' slide-pane__icon-btn--active' : ''}`}
          onClick={() => setShowInfo((v) => !v)}
          title={showInfo ? 'Hide metadata' : 'Show metadata'}
          disabled={!meta}
          aria-pressed={showInfo}
        >
          <IconInfo />
        </button>
        <button
          className="slide-pane__close"
          onClick={() => onClose(entry.id)}
          title="Close slide"
          aria-label={`Close ${entry.name}`}
        >
          ✕
        </button>
      </div>

      <div className="slide-pane__body">
        <OpenSlideViewer
          entry={entry}
          onSlideReady={setMeta}
          className="slide-pane__viewer-area"
        />
        {showInfo && meta && (
          <SlideInfoPanel meta={meta} />
        )}
      </div>
    </div>
  );
}

function IconInfo() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm6.5-.25A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>
    </svg>
  );
}
