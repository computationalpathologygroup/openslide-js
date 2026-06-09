/**
 * bundle-worker.js
 *
 * After `tsc` emits the ESM build, re-bundle the worker entry with esbuild so the
 * published `dist/esm/worker.js` is **self-contained** — it inlines `worker-api.js`
 * (and anything else it statically imports) and has zero sibling-file imports.
 *
 * Why: consumers that load the worker as an *asset module*
 * (`new URL('@.../worker', import.meta.url)`) get `worker.js` copied verbatim,
 * WITHOUT its imports bundled. A leftover `import './worker-api.js'` then 404s at
 * runtime → silent worker boot death. A self-contained bundle removes that trap.
 *
 * The Emscripten glue is kept **external** (`*openslide.js` / `*openslide.single.js`)
 * so it is never inlined — the worker still loads it via a runtime dynamic import,
 * preserving the deliberate "don't force-trace the pthreaded glue" design.
 *
 * Two outputs:
 *   - dist/esm/worker.js          → default glue `./wasm/openslide.js`
 *   - dist/esm/single/worker.js   → single-file glue `./openslide.single.js` (sibling)
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repoRoot, 'src', 'worker.ts');
const esmDir = join(repoRoot, 'dist', 'esm');

/** Keep the Emscripten glue out of the bundle (loaded at runtime instead). */
const external = ['*openslide.js', '*openslide.single.js'];

const common = {
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  external,
  legalComments: 'none',
};

await build({
  ...common,
  outfile: join(esmDir, 'worker.js'),
  define: { __OPENSLIDE_GLUE_PATH__: JSON.stringify('./wasm/openslide.js') },
});
console.log('Bundled dist/esm/worker.js (self-contained)');

// Single-file variant: glue sits as a sibling of the worker in dist/esm/single/.
await build({
  ...common,
  outfile: join(esmDir, 'single', 'worker.js'),
  define: { __OPENSLIDE_GLUE_PATH__: JSON.stringify('./openslide.single.js') },
});
console.log('Bundled dist/esm/single/worker.js (single-file variant)');
