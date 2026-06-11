# openslide-js slide viewer demo

A browser-based whole-slide image (WSI) viewer built on
[`@computationalpathologygroup/openslide-js`](https://www.npmjs.com/package/@computationalpathologygroup/openslide-js)
and [OpenSeadragon](https://openseadragon.github.io/). It opens multi-gigabyte pathology slides
**entirely in the browser** — slides are read sparsely (only the tiles in view are decoded) and
**nothing is ever uploaded to a server**.

## What it can open

- **Single-file formats** — SVS, NDPI, SCN, TIFF, and the other OpenSlide single-file formats
  (use *Open Folder* or *Pick File(s)*).
- **Multi-file formats** — MIRAX (`.mrxs` + its companion directory), VMS, and DICOM folders
  (a directory of `.dcm` files). These require *Open Folder* so the companion files come along.
- **Remote URLs** — paste a slide URL to stream it via HTTP range requests. The host must serve
  `Accept-Ranges: bytes` and allow cross-origin reads (CORS).

Multiple slides can be open at once in a resizable grid.

## How it works

```
FileExplorer ──▶ useDirectoryScanner ──▶ SlideEntry (handles, no bytes read yet)
                                              │  user clicks a slide
                                              ▼
                                       resolveSlideSource ──▶ File | VirtualFile[] | URL
                                              │
                                              ▼
        OpenSlideProvider (pool of workers) ──▶ DeepZoomGenerator(s) per slide
                                              │
                                              ▼
                          createOpenSlideTileSource ──▶ OpenSeadragon
```

- **Scanning** (`src/hooks/useDirectoryScanner.ts`) walks a directory tree via the File System
  Access API (with a `webkitdirectory` fallback for Firefox/Safari) and records lightweight
  `SlideEntry` handles — **no file bytes are read** until a slide is actually opened. It detects
  single-file formats, pairs `.mrxs` files with their companion directory, and recognises DICOM
  folders.
- **Resolving** (`src/lib/resolveSlideSource.ts`) lazily turns the selected entry's source
  descriptor into what `openslide.open()` accepts: a `File`, a `VirtualFile[]` (multi-file
  formats, with the directory-prefixed paths OpenSlide expects), or a URL string.
- **Decoding** (`src/hooks/useOpenSlide.tsx`) boots one OpenSlide instance with a **pool of
  workers** — one decode lane per logical CPU core. A single slide opens one handle per worker so
  the whole pool decodes its tiles in parallel.
- **Tiling** (`src/lib/openslideSource.ts`) wraps those generators in a custom OpenSeadragon
  `TileSource`. Tiles are produced as `ImageData` in the workers, uploaded to the GPU via
  `createImageBitmap` (zero-copy), round-robined across the worker pool, and cancelled bitmaps are
  freed on pan/zoom.

## Cross-origin isolation (required)

openslide-js's WebAssembly uses `SharedArrayBuffer` and pthreads, so the page **must be
cross-origin isolated** (`crossOriginIsolated === true`). That needs two HTTP response headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- **Locally**, the `openslide()` Vite plugin in `vite.config.ts` sets these for the dev and
  preview servers automatically.
- **On GitHub Pages** (which cannot set custom headers) the bundled
  [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) shim
  (`public/coi-serviceworker.min.js`, registered from `index.html`) injects them client-side. On
  first visit it installs and the page reloads once into the isolated context.

If `crossOriginIsolated` is `false` in the console, the decode workers cannot boot — that is
almost always a missing-headers problem.

> **Browser notes:** *Open Folder* with full subdirectory scanning uses the File System Access
> API (Chromium-based browsers); Firefox/Safari fall back to a flat folder picker. All evergreen
> browsers support the service-worker isolation path.

## Run it locally

```bash
cd demo
npm install
npm run dev
```

Open the printed URL, then **Open Folder** / **Pick File(s)** to load slides from disk, or paste a
slide URL under *Load from URL*. (No sample slide ships with the demo — point it at your own WSI
files.)

Other scripts:

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally (also sets COOP/COEP)
npm run lint      # ESLint
```

To preview exactly what GitHub Pages serves (assets under a `/<repo>/` base path):

```bash
export VITE_BASE=/openslide-js/   # vite preview re-reads the config, so set it for both
npm run build
npm run preview                   # served under http://localhost:4173/openslide-js/
```

## Deployment

Pushes to `main` that touch `demo/**` are built and published to GitHub Pages by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml). The workflow sets
`VITE_BASE=/<repo>/` so all assets resolve under the project Pages subpath. A one-time repo
setting is required: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
