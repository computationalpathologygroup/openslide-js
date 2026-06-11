import { Group, Panel, Separator } from 'react-resizable-panels';
import { SlidePane } from './SlidePane';
import type { OpenSlide } from '../types';

interface Props {
  openSlides: OpenSlide[];
  onClose: (id: string) => void;
}

export function SlideGrid({ openSlides, onClose }: Props) {
  if (openSlides.length === 0) {
    return (
      <div className="slide-grid slide-grid--empty">
        <div className="slide-grid__empty-state">
          <p className="slide-grid__empty-icon">🔬</p>
          <p>No slides open</p>
          <p className="slide-grid__empty-hint">
            Use the sidebar to browse and open whole-slide images
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="slide-grid">
      <Group orientation="horizontal" className="slide-grid__panels">
        {openSlides.map((s, i) => (
          <>
            <Panel key={s.id} minSize={15} className="slide-grid__panel">
              <SlidePane entry={s.entry} onClose={onClose} />
            </Panel>
            {i < openSlides.length - 1 && (
              <Separator
                key={`resize-${s.id}`}
                className="slide-grid__resize-handle"
              />
            )}
          </>
        ))}
      </Group>
    </div>
  );
}
