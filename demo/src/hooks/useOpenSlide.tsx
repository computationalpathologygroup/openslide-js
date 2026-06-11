import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { OpenSlide } from '@computationalpathologygroup/openslide-js';
import type { ReactNode } from 'react';

/**
 * Size of the worker pool — one decode thread per logical core. Shared so the
 * per-slide handle pool (see OpenSlideViewer) never exceeds the worker count:
 * a single slide opens one handle per worker for maximum parallel tile decode.
 */
export const WORKER_COUNT = Math.max(
  1,
  (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) ?? 4,
);

interface OpenSlideContextValue {
  instance: OpenSlide | null;
  ready: boolean;
  error: string | null;
}

const OpenSlideContext = createContext<OpenSlideContextValue>({
  instance: null,
  ready: false,
  error: null,
});

export function OpenSlideProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenSlideContextValue>({
    instance: null,
    ready: false,
    error: null,
  });
  const osRef = useRef<OpenSlide | null>(null);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const workerUrl = new URL(
          '@computationalpathologygroup/openslide-js/worker',
          import.meta.url,
        );
        const wasmJsUrl = new URL(
          '@computationalpathologygroup/openslide-js/wasm/openslide.js',
          import.meta.url,
        ).href;
        const wasmBinaryUrl = new URL(
          '@computationalpathologygroup/openslide-js/wasm/openslide.wasm',
          import.meta.url,
        );

        const os = await OpenSlide.initialize({
          // One worker = one decode lane (≤4 concurrent reads each). A single
          // slide opens one handle per worker, so the whole pool serves it in
          // parallel; extra panes share workers across the same pool.
          workerCount: WORKER_COUNT,
          workerFactory: () => new Worker(workerUrl, { type: 'module' }),
          wasmUrl: wasmJsUrl,
          wasmBinary: await (await fetch(wasmBinaryUrl)).arrayBuffer(),
        });

        if (disposed) {
          os.terminate();
          return;
        }

        osRef.current = os;
        setState({ instance: os, ready: true, error: null });
      } catch (err) {
        const msg =
          err instanceof Error
            ? `OpenSlide init failed: ${err.message}`
            : 'OpenSlide init failed (unknown error)';
        console.error(msg, err);
        if (!disposed) setState({ instance: null, ready: false, error: msg });
      }
    })();

    return () => {
      disposed = true;
      osRef.current?.terminate();
      osRef.current = null;
    };
  }, []);

  return (
    <OpenSlideContext.Provider value={state}>{children}</OpenSlideContext.Provider>
  );
}

export function useOpenSlide() {
  return useContext(OpenSlideContext);
}
