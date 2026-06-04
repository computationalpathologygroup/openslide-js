/**
 * deep-zoom.ts
 *
 * Deep Zoom Image (DZI) tile generator. Maps DZI tile coordinates to
 * OpenSlide region reads. Compatible with viewers like OpenSeadragon.
 *
 * Pure TypeScript — no WASM dependency. Operates on a Slide instance.
 */

import type { Dimensions, DziInfo } from './types.js';
import type { Slide } from './slide.js';

export interface DeepZoomOptions {
  /** Tile size in pixels (not counting overlap). Default: 254. */
  tileSize?: number;
  /** Overlap in pixels on each edge. Default: 1. */
  overlap?: number;
  /** Only render the non-empty region defined by bounds properties. Default: false. */
  limitBounds?: boolean;
}

export class DeepZoomGenerator {
  private slide: Slide;
  private _tileSize: number;
  private _overlap: number;

  // Precomputed geometry
  private _levelCount: number;
  private _levelDimensions: Dimensions[];
  private _levelTiles: { columns: number; rows: number }[];
  private _tileCount: number;

  // Slide region to render
  private _l0Offset: { x: number; y: number };
  private _l0Size: { w: number; h: number };

  constructor(slide: Slide, options?: DeepZoomOptions) {
    this.slide = slide;
    this._tileSize = options?.tileSize ?? 254;
    this._overlap = options?.overlap ?? 1;

    // Determine bounds
    const props = slide.properties;
    const limitBounds = options?.limitBounds ?? false;

    if (limitBounds && props.has('openslide.bounds-x')) {
      this._l0Offset = {
        x: parseInt(props.get('openslide.bounds-x')!, 10),
        y: parseInt(props.get('openslide.bounds-y')!, 10),
      };
      this._l0Size = {
        w: parseInt(props.get('openslide.bounds-width')!, 10),
        h: parseInt(props.get('openslide.bounds-height')!, 10),
      };
    } else {
      this._l0Offset = { x: 0, y: 0 };
      this._l0Size = { w: slide.dimensions.width, h: slide.dimensions.height };
    }

    // Build the DZI level pyramid.
    // DZI level 0 is the smallest (1x1), last level is full resolution.
    const baseW = this._l0Size.w;
    const baseH = this._l0Size.h;
    this._levelCount = Math.ceil(Math.log2(Math.max(baseW, baseH))) + 1;

    this._levelDimensions = [];
    this._levelTiles = [];
    this._tileCount = 0;

    for (let i = 0; i < this._levelCount; i++) {
      const scale = Math.pow(2, this._levelCount - 1 - i);
      const w = Math.max(1, Math.ceil(baseW / scale));
      const h = Math.max(1, Math.ceil(baseH / scale));
      this._levelDimensions.push({ width: w, height: h });

      const cols = Math.ceil(w / this._tileSize);
      const rows = Math.ceil(h / this._tileSize);
      this._levelTiles.push({ columns: cols, rows: rows });
      this._tileCount += cols * rows;
    }
  }

  /** Number of Deep Zoom levels (0 = smallest, last = full resolution). */
  get levelCount(): number {
    return this._levelCount;
  }

  /** Total number of tiles across all levels. */
  get tileCount(): number {
    return this._tileCount;
  }

  /** Pixel dimensions at each DZI level. */
  get levelDimensions(): readonly Dimensions[] {
    return this._levelDimensions;
  }

  /** Tile grid dimensions at each DZI level. */
  get levelTiles(): readonly { columns: number; rows: number }[] {
    return this._levelTiles;
  }

  /**
   * Get a single tile as ImageData.
   *
   * @param level - DZI level (0 = smallest).
   * @param col - Column index.
   * @param row - Row index.
   */
  async getTile(level: number, col: number, row: number): Promise<ImageData> {
    if (level < 0 || level >= this._levelCount) {
      throw new RangeError(`Level ${level} out of range [0, ${this._levelCount})`);
    }
    const grid = this._levelTiles[level];
    if (col < 0 || col >= grid.columns || row < 0 || row >= grid.rows) {
      throw new RangeError(`Tile (${col}, ${row}) out of range for level ${level}`);
    }

    const info = this.getTileInfo(level, col, row);

    // Read from the slide at the best matching OpenSlide level
    const dziDim = this._levelDimensions[level];
    const downsample = this._l0Size.w / dziDim.width;
    const slideLevel = this.slide.getBestLevelForDownsample(downsample);
    const slideLevelDs = this.slide.levelDownsamples[slideLevel];

    // Convert DZI tile coords to OpenSlide level-0 coords
    const l0X = this._l0Offset.x + info.x * downsample;
    const l0Y = this._l0Offset.y + info.y * downsample;

    // Size to read at the slide level
    const readW = Math.ceil(info.w * downsample / slideLevelDs);
    const readH = Math.ceil(info.h * downsample / slideLevelDs);

    const tile = await this.slide.readRegion(
      Math.round(l0X),
      Math.round(l0Y),
      slideLevel,
      readW,
      readH,
    );

    // If the read size matches the desired tile size, return directly
    if (readW === info.w && readH === info.h) {
      return tile;
    }

    // Otherwise, scale down to the exact tile dimensions using canvas
    // (in a worker context, OffscreenCanvas; in main thread, regular canvas)
    return this.resampleTile(tile, info.w, info.h);
  }

  /**
   * Generate the DZI XML descriptor string.
   */
  getDzi(format: 'jpeg' | 'png' = 'jpeg'): string {
    const dim = this._levelDimensions[this._levelCount - 1];
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"`,
      `  TileSize="${this._tileSize}"`,
      `  Overlap="${this._overlap}"`,
      `  Format="${format}">`,
      `  <Size Width="${dim.width}" Height="${dim.height}"/>`,
      `</Image>`,
    ].join('\n');
  }

  /** Structured DZI info (alternative to XML). */
  getDziInfo(format: 'jpeg' | 'png' = 'jpeg'): DziInfo {
    const dim = this._levelDimensions[this._levelCount - 1];
    return {
      tileSize: this._tileSize,
      overlap: this._overlap,
      format,
      width: dim.width,
      height: dim.height,
    };
  }

  // --- Internal ---

  /**
   * Compute tile bounds within the DZI level coordinate space.
   */
  private getTileInfo(level: number, col: number, row: number): { x: number; y: number; w: number; h: number } {
    const dim = this._levelDimensions[level];
    const ts = this._tileSize;
    const ol = this._overlap;

    // Tile origin (accounting for overlap on non-edge tiles)
    const x = col === 0 ? 0 : col * ts - ol;
    const y = row === 0 ? 0 : row * ts - ol;

    // Tile extent
    const x2 = Math.min((col + 1) * ts + ol, dim.width);
    const y2 = Math.min((row + 1) * ts + ol, dim.height);

    return { x, y, w: x2 - x, h: y2 - y };
  }

  /**
   * Downsample a tile to the target dimensions using nearest-neighbor.
   * This is a fallback; for better quality, users should use createImageBitmap
   * in their viewer integration.
   */
  private resampleTile(source: ImageData, dstW: number, dstH: number): ImageData {
    const srcW = source.width;
    const srcH = source.height;
    const src = source.data;
    const dst = new Uint8ClampedArray(dstW * dstH * 4);

    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let dy = 0; dy < dstH; dy++) {
      const sy = Math.min(Math.floor(dy * yRatio), srcH - 1);
      for (let dx = 0; dx < dstW; dx++) {
        const sx = Math.min(Math.floor(dx * xRatio), srcW - 1);
        const si = (sy * srcW + sx) * 4;
        const di = (dy * dstW + dx) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }

    return new ImageData(dst, dstW, dstH);
  }
}
