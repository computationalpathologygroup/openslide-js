import { DeepZoomGenerator } from '../src/deep-zoom';
import type { Slide } from '../src/slide';
import type { Dimensions } from '../src/types';

/** Create a mock Slide with the given dimensions and level structure. */
function mockSlide(opts: {
  dimensions: Dimensions;
  levelDimensions: Dimensions[];
  levelDownsamples: number[];
  properties?: Map<string, string>;
}): Slide {
  return {
    dimensions: opts.dimensions,
    levelCount: opts.levelDimensions.length,
    levelDimensions: opts.levelDimensions,
    levelDownsamples: opts.levelDownsamples,
    properties: opts.properties ?? new Map(),
    associatedImageNames: [],
    getBestLevelForDownsample(ds: number) {
      for (let i = opts.levelDownsamples.length - 1; i >= 0; i--) {
        if (opts.levelDownsamples[i] <= ds) return i;
      }
      return 0;
    },
    readRegion: jest.fn().mockResolvedValue(new ImageData(1, 1)),
    readAssociatedImage: jest.fn(),
    getAssociatedImageDimensions: jest.fn(),
    getIccProfile: jest.fn(),
    close: jest.fn(),
  } as unknown as Slide;
}

describe('DeepZoomGenerator', () => {
  const slide = mockSlide({
    dimensions: { width: 1024, height: 768 },
    levelDimensions: [
      { width: 1024, height: 768 },
      { width: 512, height: 384 },
    ],
    levelDownsamples: [1, 2],
  });

  const dz = new DeepZoomGenerator(slide);

  test('levelCount is derived from image dimensions', () => {
    // ceil(log2(max(1024, 768))) + 1 = ceil(10) + 1 = 11
    expect(dz.levelCount).toBe(11);
  });

  test('highest level matches full resolution', () => {
    const topLevel = dz.levelDimensions[dz.levelCount - 1];
    expect(topLevel.width).toBe(1024);
    expect(topLevel.height).toBe(768);
  });

  test('lowest level is 1x1', () => {
    const bottom = dz.levelDimensions[0];
    expect(bottom.width).toBe(1);
    expect(bottom.height).toBe(1);
  });

  test('level dimensions decrease by powers of 2', () => {
    for (let i = dz.levelCount - 2; i >= 0; i--) {
      const cur = dz.levelDimensions[i];
      const next = dz.levelDimensions[i + 1];
      // Each level should be roughly half the next, but at least 1
      expect(cur.width).toBeLessThanOrEqual(next.width);
      expect(cur.height).toBeLessThanOrEqual(next.height);
    }
  });

  test('tileCount is sum of all level tiles', () => {
    let total = 0;
    for (const t of dz.levelTiles) {
      total += t.columns * t.rows;
    }
    expect(dz.tileCount).toBe(total);
  });

  test('tile grid at top level is correct', () => {
    const top = dz.levelTiles[dz.levelCount - 1];
    // 1024 / 254 = ceil(4.03) = 5 cols
    // 768 / 254 = ceil(3.02) = 4 rows
    expect(top.columns).toBe(Math.ceil(1024 / 254));
    expect(top.rows).toBe(Math.ceil(768 / 254));
  });

  test('getDzi produces valid XML', () => {
    const xml = dz.getDzi('jpeg');
    expect(xml).toContain('TileSize="254"');
    expect(xml).toContain('Overlap="1"');
    expect(xml).toContain('Format="jpeg"');
    expect(xml).toContain('Width="1024"');
    expect(xml).toContain('Height="768"');
    expect(xml).toContain('<?xml version="1.0"');
  });

  test('getDziInfo returns structured data', () => {
    const info = dz.getDziInfo('png');
    expect(info.tileSize).toBe(254);
    expect(info.overlap).toBe(1);
    expect(info.format).toBe('png');
    expect(info.width).toBe(1024);
    expect(info.height).toBe(768);
  });

  test('custom tileSize and overlap', () => {
    const dz2 = new DeepZoomGenerator(slide, { tileSize: 512, overlap: 2 });
    const info = dz2.getDziInfo();
    expect(info.tileSize).toBe(512);
    expect(info.overlap).toBe(2);
  });

  test('getTile throws on out-of-range level', async () => {
    await expect(dz.getTile(-1, 0, 0)).rejects.toThrow(RangeError);
    await expect(dz.getTile(999, 0, 0)).rejects.toThrow(RangeError);
  });

  test('getTile throws on out-of-range address', async () => {
    await expect(dz.getTile(dz.levelCount - 1, 999, 0)).rejects.toThrow(RangeError);
    await expect(dz.getTile(dz.levelCount - 1, 0, 999)).rejects.toThrow(RangeError);
  });

  test('limitBounds uses slide bounds properties', () => {
    const bounded = mockSlide({
      dimensions: { width: 2000, height: 1500 },
      levelDimensions: [{ width: 2000, height: 1500 }],
      levelDownsamples: [1],
      properties: new Map([
        ['openslide.bounds-x', '100'],
        ['openslide.bounds-y', '200'],
        ['openslide.bounds-width', '800'],
        ['openslide.bounds-height', '600'],
      ]),
    });

    const dzBounded = new DeepZoomGenerator(bounded, { limitBounds: true });
    const top = dzBounded.levelDimensions[dzBounded.levelCount - 1];
    expect(top.width).toBe(800);
    expect(top.height).toBe(600);
  });
});
