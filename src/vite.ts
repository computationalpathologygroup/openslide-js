/**
 * vite.ts — Vite plugin helper.
 *
 * Vite already resolves `new URL('<export>', import.meta.url)` and emits the worker /
 * glue / `.wasm` assets, so the main friction is the **COOP/COEP headers** that
 * `SharedArrayBuffer` (and therefore pthreads) require. This plugin sets them on the
 * dev server and the preview server:
 *
 * ```ts
 * // vite.config.ts
 * import { openslide } from '@computationalpathologygroup/openslide-js/vite';
 * export default { plugins: [openslide()] };
 * ```
 *
 * You must still send the same headers from your production host. Typed structurally
 * so the package does not depend on `vite` at build time.
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

export interface OpenSlideVitePlugin {
  name: string;
  config: () => {
    server: { headers: Record<string, string> };
    preview: { headers: Record<string, string> };
  };
}

export function openslide(): OpenSlideVitePlugin {
  return {
    name: 'openslide-js',
    config() {
      return {
        server: { headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS } },
        preview: { headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS } },
      };
    },
  };
}
