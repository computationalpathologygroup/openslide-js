import { useState, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { OpenSlideProvider } from './hooks/useOpenSlide';
import { FileExplorer } from './components/FileExplorer';
import { SlideGrid } from './components/SlideGrid';
import type { OpenSlide, SlideEntry } from './types';
import './App.css';

function AppShell() {
  const [openSlides, setOpenSlides] = useState<OpenSlide[]>([]);
  const openSlideIds = new Set(openSlides.map((s) => s.id));

  const handleOpenSlide = useCallback((entry: SlideEntry) => {
    setOpenSlides((prev) => {
      if (prev.some((s) => s.id === entry.id)) return prev;
      return [...prev, { id: entry.id, entry }];
    });
  }, []);

  const handleCloseSlide = useCallback((id: string) => {
    setOpenSlides((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">openslide-js slide viewer demo</h1>
        <div className="app__header-links">
          <a
            href="https://www.npmjs.com/package/@computationalpathologygroup/openslide-js"
            target="_blank"
            rel="noreferrer"
            className="app__header-link"
            title="npm package"
          >
            <NpmIcon />
          </a>
          <a
            href="https://github.com/computationalpathologygroup/openslide-js"
            target="_blank"
            rel="noreferrer"
            className="app__header-link"
            title="GitHub repository"
          >
            <GitHubIcon />
          </a>
        </div>
        {openSlides.length > 0 && (
          <span className="app__slide-count">
            {openSlides.length} slide{openSlides.length !== 1 ? 's' : ''} open
          </span>
        )}
      </header>

      <div className="app__body">
        <Group orientation="horizontal" className="app__body-group">
          <Panel
            defaultSize="280px"
            minSize="240px"
            maxSize="600px"
            className="app__sidebar-panel"
          >
            <FileExplorer
              onOpenSlide={handleOpenSlide}
              openSlideIds={openSlideIds}
            />
          </Panel>

          <Separator className="app__sidebar-resize-handle" />

          <Panel className="app__main-panel">
            <SlideGrid openSlides={openSlides} onClose={handleCloseSlide} />
          </Panel>
        </Group>
      </div>
    </div>
  );
}

function NpmIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="19" viewBox="0 0 128 128" fill="currentColor" aria-hidden="true">
      <path d="M2 38.5h124v43.71H64v7.29H36.44v-7.29H2zm6.89 36.43h13.78V53.07h6.89v21.86h6.89V45.79H8.89zm34.44-29.14v36.42h13.78v-7.28h13.78V45.79zm13.78 7.29H64v14.56h-6.89zm20.67-7.29v29.14h13.78V53.07h6.89v21.86h6.89V53.07h6.89v21.86h6.89V45.79z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
    </svg>
  );
}

export default function App() {
  return (
    <OpenSlideProvider>
      <AppShell />
    </OpenSlideProvider>
  );
}
