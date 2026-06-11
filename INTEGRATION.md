# Integrating openslide-js

openslide-js runs its WASM in a pool of Web Workers, and the WASM is compiled with pthreads
(`USE_PTHREADS=1`). This guide covers how to install it and load the worker + WASM in every
environment: plain ESM, webpack/Next.js, and Vite.

> **Required headers (all setups).** The WASM uses `SharedArrayBuffer`, so the page serving your
> app must be cross-origin isolated:
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
> Check `crossOriginIsolated === true` in the browser console. If it's `false`, workers cannot boot.

## TL;DR

- **No bundler (plain ESM):** `await OpenSlide.initialize()` — zero config.
- **Any bundler (webpack/Next.js, Vite, Rollup):** wire the worker + WASM **explicitly** with the
  subpath exports and `initialize()` options (recipe below), **or** use the
  [`/single` variant](#single-file-variant) for the least config.
- **Helpers:** `@.../next` (`withOpenSlide`) injects the `.wasm` rule; `@.../vite` (`openslide()`)
  sets dev/preview headers.

---

## Installing

```bash
npm install @computationalpathologygroup/openslide-js
```

All imports use the package name `@computationalpathologygroup/openslide-js`.

---

## Why bundlers need explicit wiring

The package deliberately resolves its default worker and WASM glue through **non-literal** paths:

```ts
const workerPath = './worker.js';
new Worker(new URL(workerPath, import.meta.url), { type: 'module' }); // not a string literal
```

Webpack 5 and Vite only auto-emit/trace a worker or asset when the argument is a **string
literal**. A literal `new Worker(new URL('./worker.js', import.meta.url))` makes the bundler treat
the worker as an *entry* and statically trace its imports — which pulls in the Emscripten glue and
its `em-pthread` chunk, producing a circular dependency with the framework runtime (under Next.js
this crashes with `Cannot read properties of undefined (reading 'call')`). Using a variable
bypasses that tracing entirely; native ESM still resolves it at runtime, and bundler consumers
provide the assets themselves as plain, untraced files.

## Plain ESM / no bundler

Serve the package files as-is and import the ESM entry. The worker and glue resolve relative to
each other at runtime — nothing to copy:

```ts
import { OpenSlide } from '@computationalpathologygroup/openslide-js';

const openslide = await OpenSlide.initialize();
```

Just send the COOP/COEP headers above.

## webpack 5 / Next.js / Vite — explicit recipe

Reference the package's subpath exports with your own **literal** `new URL(..., import.meta.url)`.
Each one emits exactly one untraced asset (the worker JS, the glue JS, the `.wasm` binary). Then
pass those URLs into `initialize()` as variables, so nothing gets force-traced:

```ts
import { OpenSlide } from '@computationalpathologygroup/openslide-js';

const workerUrl     = new URL('@computationalpathologygroup/openslide-js/worker', import.meta.url);
const wasmJsUrl     = new URL('@computationalpathologygroup/openslide-js/wasm/openslide.js', import.meta.url).href;
const wasmBinaryUrl = new URL('@computationalpathologygroup/openslide-js/wasm/openslide.wasm', import.meta.url);

const openslide = await OpenSlide.initialize({
  // workerCount defaults to navigator.hardwareConcurrency. Set it explicitly if you want.
  workerCount: 4,
  // Variable URL → bundler does not trace the worker's imports.
  workerFactory: () => new Worker(workerUrl, { type: 'module' }),
  // Makes the worker load the glue from this URL instead of the package-relative default.
  wasmUrl: wasmJsUrl,
  // Hands the worker the WASM bytes, so Emscripten skips its own openslide.wasm
  // fetch — removes any sibling-file layout requirement.
  wasmBinary: await (await fetch(wasmBinaryUrl)).arrayBuffer(),
});
```

> **Relative URLs just work.** `wasmUrl` is resolved against `document.baseURI` *inside*
> `initialize()` before it is sent to the worker. Bundlers that emit relative asset URLs
> (Next.js `assetPrefix: '.'`, some Vite/Rollup configs) therefore need no special handling — a
> relative `wasmUrl` is absolutised on the main thread, so it can't mis-resolve against the
> worker's own base URL.

> **Worker boot is self-contained.** The published `worker.js` is bundled (it inlines its own
> helpers), so the asset-module pattern `new URL('@.../worker', import.meta.url)` — which copies
> the worker verbatim without bundling its imports — no longer dies on a missing sibling file. If
> a worker still fails to boot, the rejected `OpenSlideError` reports the filename/line and the
> `crossOriginIsolated` state (a missing COOP/COEP setup is the usual cause) instead of
> `Worker error: undefined`.

> **Multiple workers.** `workerCount` is unchanged: the pool calls your `workerFactory` once per
> slot, each `new Worker(...)` loading the same self-contained `worker.js`. Each worker holds an
> independent WASM instance.

> **One extra worker: the I/O broker.** Unless `io: { enabled: false }` is passed, `initialize()`
> calls your `workerFactory` **one additional time** to spawn the shared I/O broker — the same
> `worker.js`, switched into broker mode by its first message. It never loads the WASM (no
> `wasmBinary` is sent to it); it owns the block cache shared by all decode workers and performs
> all local-file and HTTP-range reads asynchronously. No wiring changes are needed.

## I/O tuning

The shared I/O layer is on by default and needs no configuration. Knobs, with defaults:

```ts
const openslide = await OpenSlide.initialize({
  // ...worker/wasm wiring as above...
  io: {
    enabled: true,                          // false → legacy per-worker I/O (createLazyFile/WORKERFS)
    blockSize: 1024 * 1024,                 // bytes per cached block / per HTTP range request
    brokerCacheBytes: 256 * 1024 * 1024,    // shared LRU cache budget
    readAhead: 2,                           // blocks prefetched ahead of sequential reads
    maxConcurrentReads: 4,                  // concurrent readRegion calls per decode worker
  },
});
```

`Slide.readRegion()` and `DeepZoomGenerator.getTile()` also accept a trailing
`{ signal?: AbortSignal }`: aborting cancels the read while it is still queued in the worker
(rejecting with `OpenSlideAbortError`, `name === 'AbortError'`); a read that already entered the
WASM runs to completion. Viewers should abort tiles that scroll out of view during pan/zoom.

## Next.js

### Config — `.wasm` rule + required headers

webpack does not treat `.wasm` as an asset by default. Wrap your config in `withOpenSlide` to inject
the rule (it composes with any `webpack` function you already have) and add the COOP/COEP headers:

```js
// next.config.js
const { withOpenSlide } = require('@computationalpathologygroup/openslide-js/next');

module.exports = withOpenSlide({
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    }];
  },
});
```

ESM config (`next.config.mjs`) is the same with
`import { withOpenSlide } from '@computationalpathologygroup/openslide-js/next'`.

<details>
<summary>Equivalent manual rule (if you'd rather not use the helper)</summary>

```js
module.exports = {
  webpack: (config) => {
    config.module.rules.push({ test: /\.wasm$/, type: 'asset/resource' });
    return config;
  },
  // ...same headers() as above
};
```
</details>

> **Use the webpack build, not Turbopack.** The `new URL(..., import.meta.url)` asset emission and
> the `.wasm` rule are webpack features — run `next dev` / `next build` without `--turbo` (or test
> Turbopack separately). Using the [`/single` variant](#single-file-variant)? You don't need the
> `.wasm` rule at all.

### A client component

WASM + workers are browser-only — keep this in a `'use client'` component, initialize inside an
effect, and terminate on unmount:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { OpenSlide } from '@computationalpathologygroup/openslide-js';

export default function SlideViewer() {
  const osRef = useRef<OpenSlide | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    let disposed = false;

    (async () => {
      const workerUrl     = new URL('@computationalpathologygroup/openslide-js/worker', import.meta.url);
      const wasmJsUrl     = new URL('@computationalpathologygroup/openslide-js/wasm/openslide.js', import.meta.url).href;
      const wasmBinaryUrl = new URL('@computationalpathologygroup/openslide-js/wasm/openslide.wasm', import.meta.url);

      const os = await OpenSlide.initialize({
        workerCount: 4,
        workerFactory: () => new Worker(workerUrl, { type: 'module' }),
        wasmUrl: wasmJsUrl,
        wasmBinary: await (await fetch(wasmBinaryUrl)).arrayBuffer(),
      });

      if (disposed) { os.terminate(); return; }
      osRef.current = os;
      setVersion(await os.getVersion());
    })().catch((err) => {
      // Worker boot failures report filename/line and crossOriginIsolated=...
      console.error('OpenSlide init failed:', err);
    });

    return () => {
      disposed = true;
      osRef.current?.terminate();
      osRef.current = null;
    };
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !osRef.current) return;
    const slide = await osRef.current.open(file);
    console.log('levels:', slide.levelCount, slide.levelDimensions);
    // const region = await slide.readRegion(x, y, level, width, height); // returns ImageData (RGBA)
    await slide.close();
  }

  return (
    <div>
      <p>OpenSlide version: {version || 'initializing…'}</p>
      <input type="file" onChange={onFile} />
    </div>
  );
}
```

Render it with SSR disabled so it only runs in the browser:

```tsx
// app/page.tsx
import dynamic from 'next/dynamic';
const SlideViewer = dynamic(() => import('./SlideViewer'), { ssr: false });

export default function Page() {
  return <SlideViewer />;
}
```

> **Static export (`output: 'export'`):** Next's `headers()` does **not** apply to statically
> exported files. Set COOP/COEP at your static host instead (e.g. a `_headers` file on
> Netlify/Cloudflare Pages, or your nginx/CDN config).

## Vite

Vite resolves the same `new URL('<export>', import.meta.url)` form and emits the assets. Append
`?url` if your config needs an explicit asset URL (e.g. `'@.../wasm/openslide.wasm?url'`). The main
thing to wire is the dev/preview COOP/COEP headers — the bundled plugin sets them for you:

```ts
// vite.config.ts
import { openslide } from '@computationalpathologygroup/openslide-js/vite';

export default {
  plugins: [openslide()],
};
```

<details>
<summary>Equivalent manual headers</summary>

```ts
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
};
```
</details>

> The plugin only sets the dev/preview headers — your production host must send the same headers.

## Single-file variant

The `/single` export is built with Emscripten `SINGLE_FILE`, inlining the `.wasm` as base64 into the
glue JS. This removes the separate `.wasm` asset entirely, so consumers need **no `.wasm` bundler
rule and no `wasmBinary` plumbing** — just the worker and the COOP/COEP headers:

```ts
import { OpenSlide } from '@computationalpathologygroup/openslide-js/single';

const openslide = await OpenSlide.initialize({
  workerFactory: () =>
    new Worker(new URL('@computationalpathologygroup/openslide-js/single/worker', import.meta.url), { type: 'module' }),
  // no wasmUrl, no wasmBinary
});
```

The single-file worker loads its inlined glue as a sibling asset, so the only files emitted are the
worker and the glue (two assets, versus the standard variant's worker + glue + `.wasm`).

**Trade-off:** the glue is ~33% larger and cold start is slower (no streaming compilation, since the
binary is base64 in JS rather than a standalone `.wasm`). Prefer the standard variant when bundle
size and startup latency matter; prefer `/single` for the simplest possible bundler integration.

> COOP/COEP headers are still required — `SharedArrayBuffer`/pthreads are unchanged.

## Subpath exports

| Export | Points to |
|---|---|
| `@computationalpathologygroup/openslide-js` | main ESM/CJS entry |
| `@computationalpathologygroup/openslide-js/worker` | the worker JS (self-contained bundle) |
| `@computationalpathologygroup/openslide-js/wasm/openslide.js` | the Emscripten glue |
| `@computationalpathologygroup/openslide-js/wasm/openslide.wasm` | the WASM binary |
| `@computationalpathologygroup/openslide-js/single` | single-file variant entry (WASM inlined) |
| `@computationalpathologygroup/openslide-js/single/worker` | single-file variant worker |
| `@computationalpathologygroup/openslide-js/next` | `withOpenSlide(nextConfig)` helper |
| `@computationalpathologygroup/openslide-js/vite` | `openslide()` Vite plugin |
| `@computationalpathologygroup/openslide-js/package.json` | package manifest |

## pthreads note

The glue spawns internal pthread workers from its own `import.meta.url` at runtime. Serving the glue
via the `./wasm/openslide.js` export (an emitted asset with a stable URL) lets those resolve, and
`wasmBinary` avoids the separate `.wasm` fetch. If you still see pthread-worker load errors,
double-check the COOP/COEP headers — `SharedArrayBuffer` is required for pthreads.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `OpenSlideError: Worker error: … crossOriginIsolated=false` | COOP/COEP headers not applied. Verify `crossOriginIsolated` in the console; for Next.js static export set headers at the host. |
| `Worker error: … module-load failure (check the network tab)` | An asset 404'd. Confirm the `new URL(...)` imports resolve (Network tab) and you're on the webpack build, not Turbopack. |
| `.wasm` request 404 / "module parse failed" | The `.wasm` asset rule is missing — wrap `next.config.js` in `withOpenSlide(...)`, or switch to `/single`. |
| Next.js crash `Cannot read properties of undefined (reading 'call')` | A literal `new Worker(new URL('…'))` force-traced the pthread glue. Use `workerFactory` with a **variable** URL as shown above. |
