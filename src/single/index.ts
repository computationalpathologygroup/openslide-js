/**
 * single/index.ts
 *
 * Entry point for the **single-file** build variant. The public API is identical to
 * the main entry — the only difference is the matching `@.../single/worker` export,
 * whose worker loads an Emscripten glue with the `.wasm` base64-inlined
 * (`-sSINGLE_FILE=1`). That removes the separate `.wasm` asset, so consumers need
 * no `.wasm` bundler rule and no `wasmBinary` plumbing:
 *
 * ```ts
 * import { OpenSlide } from '@computationalpathologygroup/openslide-js/single';
 *
 * const openslide = await OpenSlide.initialize({
 *   workerFactory: () =>
 *     new Worker(new URL('@computationalpathologygroup/openslide-js/single/worker', import.meta.url), { type: 'module' }),
 * });
 * ```
 *
 * Trade-off: ~33% larger glue and slower cold start (no streaming compilation). See
 * INTEGRATION.md.
 */
export * from '../index.js';
