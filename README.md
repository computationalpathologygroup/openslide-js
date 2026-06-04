# openslide-js

Client-side whole-slide image library powered by [OpenSlide](https://openslide.org) and WebAssembly.

Runs entirely in the browser — no server required.

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

```typescript
import { DeepZoomGenerator } from '@computationalpathologygroup/openslide-js';

const dz = new DeepZoomGenerator(slide);
const tile = await dz.getTile(level, col, row);  // returns ImageData
const xml = dz.getDzi('jpeg');
```

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

> **Test coverage:** 292 integration tests across 15 formats (10 single-file + 5 multi-file), running in headless Chromium via Playwright.
> Run locally with `npm run test:integration` or containerized with `npm run test:integration:docker`.

## Requirements

The WASM module uses `SharedArrayBuffer` and requires the following HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

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
