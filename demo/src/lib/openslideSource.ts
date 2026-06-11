import OpenSeadragon from 'openseadragon';
import type { DeepZoomGenerator } from '@computationalpathologygroup/openslide-js';

/**
 * Build an OpenSeadragon TileSource backed by a POOL of openslide-js
 * DeepZoomGenerators — one per worker handle on the same slide. Tile reads are
 * round-robined across the pool so they decode on different worker threads in
 * parallel (openslide-js pins each Slide to one worker, so multiple handles =
 * multiple decode lanes for a single slide).
 *
 * Tiles are produced in the worker as `ImageData`, uploaded to the GPU via
 * `createImageBitmap` (zero-copy, no per-tile canvas), and handed to OSD. Level
 * geometry comes from the first generator (identical across handles — same
 * source). In-flight tiles are tracked in a WeakSet so tiles cancelled by a pan
 * or zoom are discarded and their bitmaps freed (`bitmap.close()`).
 */
export function createOpenSlideTileSource(
  generators: DeepZoomGenerator[],
  slideName: string,
): OpenSeadragon.TileSource {
  const dz = generators[0];
  const info = dz.getDziInfo('jpeg');
  const maxLevel = dz.levelCount - 1;
  const levelDimensions = dz.levelDimensions;
  const levelTiles = dz.levelTiles;
  let rr = 0; // round-robin cursor across the generator pool

  const tileSource = new OpenSeadragon.TileSource({
    width: info.width,
    height: info.height,
    tileWidth: info.tileSize,
    tileHeight: info.tileSize,
    tileOverlap: info.overlap,
    minLevel: 0,
    maxLevel,
  } as ConstructorParameters<typeof OpenSeadragon.TileSource>[0]);

  // OSD tile-source customization is inherently dynamic; patch the instance.
  const ts = tileSource as unknown as Record<string, unknown>;
  const aborted = new WeakSet<object>();
  // Per-tile AbortControllers: aborting cancels the read while it is still
  // queued in the worker (executing reads finish and are discarded via the
  // WeakSet as before).
  const controllers = new Map<object, AbortController>();

  // Dev-only latency collector: localStorage.setItem('osjs-stats', '1'),
  // reload, pan/zoom, then call window.__tileStats() in the console.
  const statsEnabled =
    typeof localStorage !== 'undefined' && localStorage.getItem('osjs-stats') === '1';
  const durations: number[] = [];
  let cancelledTiles = 0;
  if (statsEnabled) {
    (window as unknown as Record<string, unknown>).__tileStats = () => {
      const sorted = [...durations].sort((a, b) => a - b);
      const q = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
      return {
        slide: slideName,
        tiles: sorted.length,
        medianMs: Math.round(q(0.5) * 10) / 10,
        p95Ms: Math.round(q(0.95) * 10) / 10,
        cancelled: cancelledTiles,
      };
    };
  }

  ts.getTileUrl = (level: number, x: number, y: number): string =>
    `openslide://${slideName}/${level}/${x}/${y}`;

  ts.getLevelScale = (level: number): number => {
    const dim = levelDimensions[level];
    return dim ? dim.width / info.width : 0;
  };

  ts.getNumTiles = (level: number): OpenSeadragon.Point => {
    const tiles = levelTiles[level];
    if (!tiles) return new OpenSeadragon.Point(0, 0);
    return new OpenSeadragon.Point(tiles.columns, tiles.rows);
  };

  ts.tileExists = (level: number, x: number, y: number): boolean => {
    const tiles = levelTiles[level];
    if (!tiles) return false;
    return x >= 0 && y >= 0 && x < tiles.columns && y < tiles.rows;
  };

  ts.downloadTileStart = (context: {
    tile: { level: number; x: number; y: number };
    finish: (data: unknown, request: unknown, dataType: unknown) => void;
  }): void => {
    const { level, x, y } = context.tile;

    // Spread reads across the pool so they decode on parallel worker threads.
    const gen = generators[rr++ % generators.length];

    const controller = new AbortController();
    controllers.set(context, controller);
    const started = statsEnabled ? performance.now() : 0;

    gen.getTile(level, x, y, { signal: controller.signal })
      .then(async (imageData: ImageData) => {
        controllers.delete(context);
        if (aborted.has(context)) return;
        if (statsEnabled) durations.push(performance.now() - started);
        const bitmap = await createImageBitmap(imageData);
        if (aborted.has(context)) {
          bitmap.close();
          return;
        }
        // OSD 6 needs the explicit "imageBitmap" type — it can't infer it from
        // the data the way it does for HTMLImageElement / CanvasRenderingContext2D.
        context.finish(bitmap, null, 'imageBitmap');
      })
      .catch((err: Error) => {
        controllers.delete(context);
        if (err?.name === 'AbortError') {
          // Cancelled while still queued in the worker — never decoded.
          cancelledTiles++;
          return;
        }
        if (aborted.has(context)) return;
        if (err?.message === 'aborted') return;
        context.finish(null, null, err?.message || 'tile load failed');
      });
  };

  ts.downloadTileAbort = (context: object): void => {
    // Cancel the read if it is still queued in the worker; reads already
    // executing finish and are discarded via the WeakSet (bitmap freed).
    aborted.add(context);
    controllers.get(context)?.abort();
    controllers.delete(context);
  };

  ts.hasTransparency = (): boolean => false;

  return tileSource;
}
