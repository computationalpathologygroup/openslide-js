# openslide-js

Client-side whole-slide image library powered by [OpenSlide](https://openslide.org) and WebAssembly.

Runs entirely in the browser — no server required.

**[▶ Live demo](https://computationalpathologygroup.github.io/openslide-js/)** — a browser-based
whole-slide viewer built on this library. Source and details in [`demo/`](demo/README.md).

> For native (Linux / Windows / macOS) usage, see [openslide-bin](https://github.com/openslide/openslide-bin) — the OpenSlide team's official binary distribution of the same C library used by openslide-python, openslide-java, and other native consumers. openslide-js is the WebAssembly sibling: same upstream OpenSlide and dependency pins (v4.0.0, GLib 2.88.1, Cairo 1.18.4, libdicom 1.0.5, etc.) compiled for the browser via Emscripten, with a TypeScript wrapper API on top.

## Install

```bash
npm install @computationalpathologygroup/openslide-js
```

## Usage

```typescript
import { OpenSlide } from '@computationalpathologygroup/openslide-js';

const openslide = await OpenSlide.initialize();
const slide = await openslide.open(file); // File | File[] | URL | string

console.log(slide.levelCount);
console.log(slide.properties);

const imageData = await slide.readRegion(x, y, level, width, height);
slide.close();
```

### Multi-file formats (MIRAX, VMS)

```typescript
import { OpenSlide, type VirtualFile } from '@computationalpathologygroup/openslide-js';

const entries: VirtualFile[] = [
  { path: 'slide.mrxs', file: mrxsFile },
  { path: 'slide/Slidedat.ini', file: datFile },
  // ... remaining files
];

const slide = await openslide.open(entries);
```

### Deep Zoom

Slides are read sparsely — only the byte ranges needed to decode the requested Deep Zoom tiles are accessed, via HTTP range requests for URLs (the origin must serve `Accept-Ranges: bytes`) or via the browser's File API for local files — so multi-gigabyte whole-slide images can be browsed in the viewport without ever loading the full file into memory.

All reads go through a shared I/O layer: one lightweight broker worker owns a
block cache (1 MiB blocks, 256 MiB LRU by default) shared by every decode
worker, dedupes identical range requests across workers, and prefetches ahead
of sequential access. Opening the same slide on several workers therefore
downloads (or reads) each byte once, not once per worker. Tunables — and an
escape hatch back to fully independent per-worker I/O — live on
`initialize({ io: { ... } })`; see [INTEGRATION.md](INTEGRATION.md#io-tuning).

```typescript
import { DeepZoomGenerator } from '@computationalpathologygroup/openslide-js';

const dz = new DeepZoomGenerator(slide);
const tile = await dz.getTile(level, col, row);  // returns ImageData
const xml = dz.getDzi('jpeg');
```

### Next.js

webpack doesn't emit `.wasm` as an asset by default. Wrap `next.config.js` in `withOpenSlide` (it
adds the rule) and send the cross-origin-isolation headers `SharedArrayBuffer` requires:

```js
// next.config.js
const { withOpenSlide } = require('@computationalpathologygroup/openslide-js/next');

module.exports = withOpenSlide({
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

Then wire the worker + WASM in a `'use client'` component. See **[INTEGRATION.md](INTEGRATION.md)**
for the full Next.js example (and Vite, plain ESM, and the `/single` variant).

## Format Support

openslide-js supports the same whole-slide image formats as [OpenSlide](https://openslide.org), running entirely client-side via WebAssembly. Some formats have limitations in the browser environment.

### Single-File Formats

| Vendor | Format | Extension | Compression | Support level |
|:-------|:-------|:----------|:------------|:------:|
| Aperio | SVS | `.svs` | JPEG | :white_check_mark: Full |
| Aperio | SVS | `.svs` | JPEG 2000 | :white_check_mark: Full |
| Generic | Tiled TIFF | `.tiff` | Mixed | :white_check_mark: Full |
| Hamamatsu | NDPI | `.ndpi` | JPEG | :white_check_mark: Full |
| Leica | SCN (brightfield) | `.scn` | JPEG | :white_check_mark: Full |
| Philips | TIFF | `.tiff` | JPEG | :white_check_mark: Full |

### Multi-File Formats

| Vendor | Format | Extension | Support level | Notes |
|:-------|:-------|:----------|:------:|:------|
| DICOM | WSI | `.dcm` | :white_check_mark: Full | Opened via `VirtualFile[]` directory mounting |
| Hamamatsu | VMS | `.vms` | :white_check_mark: Full | Opened via `VirtualFile[]` directory mounting |
| Mirax | MRXS | `.mrxs` | :white_check_mark: Full | Opened via `VirtualFile[]` directory mounting |
| Trestle | TIF | `.tif` | :white_check_mark: Full | Opened via `VirtualFile[]` directory mounting |

### Unsupported

| Vendor | Format | Extension | Support level | Limitation |
|:-------|:-------|:----------|:------:|:-----------|
| Leica | SCN (fluorescence) | `.scn` | :x: No | No main brightfield image in fluorescence-only files |
| Olympus | VSI | `.vsi` | :x: No | VSI opener cannot find companion ETS directory via WORKERFS |
| Ventana | BIF | `.bif` | :x: No | `LEFT` direction attribute not supported |
| Zeiss | CZI | `.czi` | :x: No | Vendor detection not in OpenSlide v4.0.0 (added upstream post-release); JPEG XR codec also not compiled |
| Zeiss | ZVI | `.zvi` | :x: No | OLE2 compound documents cannot be read via HTTP |

### Not Yet Tested

| Vendor | Format | Extension | Support level | Notes |
|:-------|:-------|:----------|:------|
| Sakura | SVSLIDE | `.svslide` | SQLite-based, needs filesystem access |

### Known limitations & failure modes

Beyond the per-format gaps above, these runtime conditions cause failures regardless of format:

| Condition | Symptom | Requirement / workaround |
|:----------|:--------|:-------------------------|
| **Missing COOP/COEP headers** | Workers fail to boot; `SharedArrayBuffer` is unavailable so pthreads can't start. The rejected `OpenSlideError` reports `crossOriginIsolated=false`. | Serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Required in **every** setup. |
| **Opening a `URL`/string source from a server without HTTP range support or CORS** | Open or region reads fail / 404 / CORS error. | The remote host must support HTTP range requests and permit cross-origin reads. Otherwise download the file and open it as a `File`. |
| **OLE2 compound-document formats over HTTP** (e.g. Zeiss `.zvi`) | Cannot be read via range requests; vendor detection also fails. | Not supported in the browser. |
| **Bundler integration without explicit wiring** (webpack/Next.js, Vite, Rollup) | Opaque worker boot error, or the WASM glue / `.wasm` 404s. | Wire the worker + WASM per **[INTEGRATION.md](INTEGRATION.md)** (`workerFactory` / `wasmUrl` / `wasmBinary`, plus the `.wasm` rule — or use the `/single` variant). Plain ESM needs no wiring. |
| **No bundler `.wasm` rule** (standard variant) | webpack/Next.js can't emit the `.wasm` asset. | Add the asset rule (or use `withOpenSlide` from `@.../openslide-js/next`); or switch to the `/single` variant, which inlines the binary. |

> **Test coverage:** 292 integration tests across 15 formats (10 single-file + 5 multi-file), running in headless Chromium via Playwright.
> Run locally with `npm run test:integration` or containerized with `npm run test:integration:docker`.

## Requirements

The WASM module uses `SharedArrayBuffer` and requires the following HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Integration

With **no bundler** (plain ESM), `await OpenSlide.initialize()` works with zero configuration.

Under a **bundler** (webpack/Next.js, Vite, Rollup), you wire the worker and WASM assets
**explicitly** — the package avoids literal `new Worker`/`import()` paths so bundlers don't
force-trace the pthreaded WASM graph (which crashes Next.js). See **[INTEGRATION.md](INTEGRATION.md)**
for the copy-paste recipe (subpath exports + `workerFactory`/`wasmUrl`/`wasmBinary`) and a full
Next.js client-component example.

Helpers to shrink that wiring:

- **`@.../openslide-js/next`** — `withOpenSlide(nextConfig)` injects the `.wasm` asset rule.
- **`@.../openslide-js/vite`** — `openslide()` plugin sets the dev/preview COOP/COEP headers.
- **`@.../openslide-js/single`** — single-file variant with the `.wasm` inlined: no `.wasm` rule
  and no `wasmBinary` needed (trade-off: ~33% larger, slower cold start).

## Building the WASM module

Requires Docker.

```bash
docker build -t openslide-js ./wasm
mkdir -p wasm/dist
docker run --rm -v "$(pwd)/wasm/dist:/output" openslide-js
```

Output: `wasm/dist/openslide.js` and `wasm/dist/openslide.wasm`.

## Building the TypeScript layer

```bash
npm run build:ts
```

## Test Data

Integration tests require whole-slide image files that are not bundled in this repository (they are git-ignored). Download them with:

```bash
npm run test:integration:fixtures
```

This runs `test/integration/download-fixtures.mjs`, which:

1. Fetches the [upstream index.json](https://openslide.cs.cmu.edu/download/openslide-testdata/index.json) and updates the local `test/data/index.json` if it has changed.
2. Downloads every file listed in the index into `test/data/`, preserving the subdirectory layout.
3. Verifies each file's SHA-256 hash. Files already present with a matching hash are skipped.
4. Extracts ZIP archives (multi-file formats) into sibling directories.

Re-running the script is safe and idempotent — only missing or stale files are re-downloaded. The total download size is roughly 20 GiB for the full index.

## Acknowledgements

The WASM build pipeline under `wasm/` incorporates work from two upstream projects, both MIT-licensed:

- [wasm-vips](https://github.com/kleisauke/wasm-vips) by Kleis Auke Wolthuizen (MIT) — the GLib WebAssembly patch series in `wasm/patches/glib.patch` (per-patch author lines preserved in the mailbox headers).
- [@conflux-xyz/openslide-wasm](https://github.com/conflux-xyz/openslide-wasm) (MIT, per its npm package) — informed the build strategy
- [discere-os/gdk-pixbuf.wasm](https://github.com/discere-os/gdk-pixbuf.wasm) and [discere-os/fontconfig.wasm](https://github.com/discere-os/fontconfig.wasm) by Isaac Johnston — informed (a) the patch-light gdk-pixbuf cross-build strategy (lean on upstream's conditional `USE_GMODULE` gating + `-Dbuiltin_loaders=all` rather than stripping C code) and (b) the choice to pin fontconfig at 2.17.1, where upstream's `cc.preprocess()` migration (May 2023) eliminates the need for any compiler-detection patch.
- [VitoVan/pango-cairo-wasm](https://github.com/VitoVan/pango-cairo-wasm) by Vito Van (WTFPL) — demonstrated that cairo cross-builds cleanly under Emscripten without any source patches; its meson invocation strategy informed dropping `wasm/patches/cairo.patch` entirely.

See [NOTICE](NOTICE) for the full third-party attribution, including every component statically linked into `wasm/dist/openslide.wasm` and LGPL-2.1 §6 source-availability information.

## Contributing

Patches welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it documents how openslide-js handles third-party code, the preferred order of fixes (upstream meson option → sed transform → minimal patch), and the attribution rules that keep the project legally clean.

## License

LGPL-2.1-only — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
