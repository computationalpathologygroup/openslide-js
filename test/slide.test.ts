import { Slide } from '../src/slide';
import type { SlideInfo } from '../src/types';

function makeInfo(): SlideInfo {
  return {
    levelCount: 3,
    levelDimensions: [
      { width: 4096, height: 2048 },
      { width: 2048, height: 1024 },
      { width: 1024, height: 512 },
    ],
    levelDownsamples: [1, 2, 4],
    properties: new Map([
      ['openslide.vendor', 'aperio'],
      ['openslide.mpp-x', '0.25'],
    ]),
    associatedImageNames: ['label', 'thumbnail'],
  };
}

describe('Slide', () => {
  test('synchronous properties are available immediately', () => {
    const send = jest.fn();
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    expect(slide.levelCount).toBe(3);
    expect(slide.dimensions).toEqual({ width: 4096, height: 2048 });
    expect(slide.levelDimensions).toHaveLength(3);
    expect(slide.levelDownsamples).toEqual([1, 2, 4]);
    expect(slide.properties.get('openslide.vendor')).toBe('aperio');
    expect(slide.associatedImageNames).toEqual(['label', 'thumbnail']);
  });

  test('getBestLevelForDownsample returns correct level', () => {
    const send = jest.fn();
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    expect(slide.getBestLevelForDownsample(1)).toBe(0);
    expect(slide.getBestLevelForDownsample(1.5)).toBe(0);
    expect(slide.getBestLevelForDownsample(2)).toBe(1);
    expect(slide.getBestLevelForDownsample(3)).toBe(1);
    expect(slide.getBestLevelForDownsample(4)).toBe(2);
    expect(slide.getBestLevelForDownsample(100)).toBe(2);
  });

  test('getBestLevelForDownsample returns 0 for small values', () => {
    const send = jest.fn();
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    expect(slide.getBestLevelForDownsample(0.5)).toBe(0);
    expect(slide.getBestLevelForDownsample(0)).toBe(0);
  });

  test('readRegion delegates to worker', async () => {
    const fakeBuffer = new ArrayBuffer(4 * 4 * 4); // 4x4 RGBA
    const send = jest.fn().mockResolvedValue(fakeBuffer);
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    const result = await slide.readRegion(0, 0, 0, 4, 4);
    expect(send).toHaveBeenCalledWith({
      cmd: 'readRegion',
      handle: 42,
      x: 0, y: 0, level: 0, w: 4, h: 4,
    }, { signal: undefined });
    expect(result).toBeInstanceOf(ImageData);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  test('readRegion forwards an AbortSignal to the worker send', async () => {
    const fakeBuffer = new ArrayBuffer(4 * 4 * 4);
    const send = jest.fn().mockResolvedValue(fakeBuffer);
    const slide = new Slide(send, 42, 'mount1', makeInfo());
    const controller = new AbortController();

    await slide.readRegion(0, 0, 0, 4, 4, { signal: controller.signal });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: 'readRegion' }),
      { signal: controller.signal },
    );
  });

  test('close sends close and unmount commands', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    await slide.close();
    expect(send).toHaveBeenCalledWith({ cmd: 'close', handle: 42 });
    expect(send).toHaveBeenCalledWith({ cmd: 'unmount', mountId: 'mount1' });
  });

  test('operations after close throw', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    await slide.close();
    await expect(slide.readRegion(0, 0, 0, 1, 1)).rejects.toThrow('Slide has been closed');
  });

  test('double close is safe', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const slide = new Slide(send, 42, 'mount1', makeInfo());

    await slide.close();
    await slide.close(); // Should not throw
    // Only one set of close/unmount calls
    expect(send).toHaveBeenCalledTimes(2);
  });
});
