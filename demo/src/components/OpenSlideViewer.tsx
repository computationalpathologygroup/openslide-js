import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { DeepZoomGenerator } from '@computationalpathologygroup/openslide-js';
import type { Slide } from '@computationalpathologygroup/openslide-js';
import { useOpenSlide, WORKER_COUNT } from '../hooks/useOpenSlide';
import { createOpenSlideTileSource } from '../lib/openslideSource';
import { resolveSlideSource } from '../lib/resolveSlideSource';
import { associatedImageToUrl } from '../lib/associatedImage';
import type { SlideEntry, SlideMeta } from '../types';

interface Props {
  entry: SlideEntry;
  className?: string;
  onSlideReady?: (meta: SlideMeta) => void;
}

function friendlyError(msg: string, kind: SlideEntry['kind']): string {
  // The WASM reports "Failed to open slide: /mnt/<id>/root" which is opaque.
  // Replace with something actionable.
  if (msg.startsWith('Failed to open slide:') || msg.includes('/mnt/')) {
    if (kind === 'url') {
      return 'Remote slide could not be opened — see technical details below.';
    }
    if (kind === 'multi') {
      return 'OpenSlide could not read this multi-file slide. Companion files may be missing, or could not be read from the folder (this can happen with slow or interrupted network/samba shares).';
    }
    return 'OpenSlide could not read this file. The format may not be supported, or companion files may be missing.';
  }
  return msg;
}

type ViewerState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export function OpenSlideViewer({ entry, className, onSlideReady }: Props) {
  const { instance: openslide, ready, error: initError } = useOpenSlide();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const slidesRef = useRef<Slide[]>([]);
  const objectUrlsRef = useRef<string[]>([]);
  const [state, setState] = useState<ViewerState>({ status: 'loading' });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const zoomIn = useCallback(() => {
    viewerRef.current?.viewport.zoomBy(1.5, undefined, true);
    viewerRef.current?.viewport.applyConstraints();
  }, []);

  const zoomOut = useCallback(() => {
    viewerRef.current?.viewport.zoomBy(1 / 1.5, undefined, true);
    viewerRef.current?.viewport.applyConstraints();
  }, []);

  const goHome = useCallback(() => {
    viewerRef.current?.viewport.goHome(true);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!ready || !openslide || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        setState({ status: 'loading' });

        // For URL slides: preflight-check before handing the URL to the WASM.
        // This converts opaque "Failed to open slide: /mnt/…" errors into
        // actionable messages about CORS, range-request support, or reachability.
        if (entry.source.mode === 'url') {
          const url = entry.source.url;
          try {
            const resp = await fetch(url, {
              method: 'GET',
              headers: { Range: 'bytes=0-0' },
              signal: AbortSignal.timeout(8000),
            });
            // 206 Partial Content is ideal; 200 is also acceptable
            if (resp.status !== 206 && resp.status !== 200) {
              throw new Error(
                `Server returned HTTP ${resp.status}. ` +
                `Check that the URL is correct and the server is accessible.`,
              );
            }
            if (resp.headers.get('Accept-Ranges') === 'none') {
              throw new Error(
                'The server explicitly disables range requests ' +
                '(Accept-Ranges: none). HTTP range requests are required ' +
                'for remote slide loading.',
              );
            }
            await resp.body?.cancel();
          } catch (fetchErr) {
            if (fetchErr instanceof Error && fetchErr.name === 'TimeoutError') {
              throw new Error('Request timed out — the server may be unreachable.');
            }
            if (fetchErr instanceof TypeError) {
              // Network-level failure; in a cross-origin isolated context this is
              // almost always a missing CORS or CORP header on the slide server.
              throw new Error(
                'Cannot reach the slide URL. In this cross-origin isolated context ' +
                'the slide server must respond with:\n' +
                '  Access-Control-Allow-Origin: *\n' +
                '  Cross-Origin-Resource-Policy: cross-origin\n' +
                '  Accept-Ranges: bytes',
              );
            }
            throw fetchErr; // rethrow our own errors from above
          }
        }

        // Resolve the source descriptor lazily into File | VirtualFile[] | URL.
        // Handle-based slides read their bytes here, not during the scan.
        const slideArg = await resolveSlideSource(entry);
        if (cancelled) return;

        // Open one handle per worker for single-file slides — each open() lands
        // on a different worker (leastBusy), giving WORKER_COUNT parallel decode
        // lanes. Multi-file slides (MRXS/VMS/DICOM) are I/O-bound, especially on
        // network shares where WORKERFS does synchronous blocking reads: opening
        // WORKER_COUNT handles re-mounts and re-reads the index/metadata of every
        // companion file that many times, multiplying SMB reads and contending on
        // the connection (slow load, and read failures that surface as open
        // errors). One handle loads fast and reliably — decode parallelism gives
        // little benefit when the bytes arrive serially over the network anyway.
        const poolSize = entry.kind === 'multi' ? 1 : WORKER_COUNT;
        const slides = await Promise.all(
          Array.from({ length: poolSize }, () =>
            openslide.open(slideArg as Parameters<typeof openslide.open>[0]),
          ),
        );
        if (cancelled) {
          await Promise.all(slides.map((s) => s.close().catch(() => {})));
          return;
        }
        slidesRef.current = slides;

        const generators = slides.map((s) => new DeepZoomGenerator(s));
        const slide = slides[0]; // metadata source

        if (cancelled) return;

        viewerRef.current?.destroy();

        const tileSource = createOpenSlideTileSource(generators, entry.name);

        viewerRef.current = OpenSeadragon({
          element: containerRef.current!,
          tileSources: [tileSource],
          showNavigationControl: false,
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          navigatorHeight: '120px',
          navigatorWidth: '160px',
          visibilityRatio: 1,
          minZoomLevel: 0.5,
          defaultZoomLevel: 0,
          gestureSettingsMouse: { clickToZoom: true, dblClickToZoom: true },
          gestureSettingsTouch: { pinchToZoom: true },
          crossOriginPolicy: false,
          ajaxWithCredentials: false,
          // ── Performance & smoothness ──
          // 4 concurrent reads per worker × pool size → keep every lane full.
          imageLoaderLimit: poolSize * 4,
          // Large in-memory tile cache: revisiting a region doesn't re-decode.
          maxImageCacheCount: 1500,
          preload: true,
          // Paint the best-available (low-res) level instantly, then refine —
          // no white wait on open/zoom.
          immediateRender: true,
          // Fill not-yet-loaded tiles with a neutral gray instead of white.
          placeholderFillStyle: '#eaeef2',
          timeout: 120000,
          animationTime: 0.5,
          blendTime: 0.1,
        });

        if (!cancelled) setState({ status: 'ready' });

        // Collect metadata asynchronously after viewer is up — doesn't block rendering
        if (onSlideReady && !cancelled) {
          const meta: SlideMeta = {
            dimensions: { width: slide.dimensions.width, height: slide.dimensions.height },
            levelCount: slide.levelCount,
            levelDimensions: slide.levelDimensions.map((d) => ({ width: d.width, height: d.height })),
            levelDownsamples: [...slide.levelDownsamples],
            properties: new Map(slide.properties),
            associatedImages: [],
          };

          for (const name of slide.associatedImageNames) {
            if (cancelled) return;
            try {
              const imgData = await slide.readAssociatedImage(name);
              if (cancelled) return;
              // OffscreenCanvas → blob object URL when available (off main
              // thread), falling back to a data URL.
              const dataUrl = await associatedImageToUrl(imgData);
              if (dataUrl.startsWith('blob:')) objectUrlsRef.current.push(dataUrl);
              meta.associatedImages.push({
                name,
                dataUrl,
                width: imgData.width,
                height: imgData.height,
              });
            } catch {
              // skip unavailable associated image
            }
          }

          if (!cancelled) onSlideReady(meta);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ status: 'error', message: msg });
        }
      }
    })();

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      // Close every pooled handle so its worker frees the slide.
      slidesRef.current.forEach((s) => s.close().catch(() => {}));
      slidesRef.current = [];
      // Free associated-image blob URLs from the previous slide
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, openslide, entry.id]);

  if (initError) {
    return (
      <div className={`slide-viewer slide-viewer--error ${className ?? ''}`}>
        <p className="error-icon">⚠</p>
        <p>OpenSlide failed to initialise:</p>
        <pre>{initError}</pre>
        {!crossOriginIsolated && (
          <p className="error-hint">
            Missing COOP/COEP headers — <code>crossOriginIsolated</code> is{' '}
            <code>false</code>. The Vite dev server should set these automatically via
            the <code>openslide()</code> plugin.
          </p>
        )}
      </div>
    );
  }

  const controlsVisible = state.status === 'ready';

  return (
    <div
      ref={wrapperRef}
      className={`slide-viewer ${isFullscreen ? 'slide-viewer--fullscreen' : ''} ${className ?? ''}`}
    >
      {state.status === 'loading' && (
        <div className="slide-viewer__overlay">
          <span className="spinner" />
          <span>Opening slide…</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="slide-viewer__overlay slide-viewer__overlay--error">
          <p className="error-icon">⚠</p>
          <p className="error-summary">{friendlyError(state.message, entry.kind)}</p>
          {/* Most common root cause in remote/Docker context */}
          {!crossOriginIsolated && (
            <p className="error-hint error-hint--warn">
              <strong>crossOriginIsolated = false</strong> — the browser did not receive
              the required COOP/COEP headers. The pthreaded WASM cannot run without them.
              Check that no reverse proxy is stripping{' '}
              <code>Cross-Origin-Opener-Policy</code> /{' '}
              <code>Cross-Origin-Embedder-Policy</code> from responses, and that
              the connection is not downgraded from HTTPS to HTTP.
            </p>
          )}
          <details className="error-details">
            <summary>Technical details</summary>
            <pre className="error-pre">{state.message}</pre>
            <p className="error-details-meta">
              crossOriginIsolated: <code>{String(crossOriginIsolated)}</code>
            </p>
          </details>
        </div>
      )}

      {controlsVisible && (
        <div className="viewer-controls" aria-label="Viewer controls">
          <button className="viewer-controls__btn" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
            <IconZoomIn />
          </button>
          <button className="viewer-controls__btn" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
            <IconZoomOut />
          </button>
          <button className="viewer-controls__btn" onClick={goHome} title="Reset view" aria-label="Reset view">
            <IconHome />
          </button>
          <div className="viewer-controls__divider" />
          <button
            className="viewer-controls__btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
          </button>
        </div>
      )}

      <div ref={containerRef} className="slide-viewer__osd" />
    </div>
  );
}

/* ── Inline SVG icons ── */

function IconZoomIn() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="13.5" y1="13.5" x2="18" y2="18" />
      <line x1="8.5" y1="6" x2="8.5" y2="11" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}

function IconZoomOut() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="13.5" y1="13.5" x2="18" y2="18" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L10 3l7 6.5" />
      <path d="M5 8v8h4v-4h2v4h4V8" />
    </svg>
  );
}

function IconFullscreen() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V3h4" />
      <path d="M13 3h4v4" />
      <path d="M17 13v4h-4" />
      <path d="M7 17H3v-4" />
    </svg>
  );
}

function IconExitFullscreen() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v4H3" />
      <path d="M17 7h-4V3" />
      <path d="M13 17v-4h4" />
      <path d="M3 13h4v4" />
    </svg>
  );
}
