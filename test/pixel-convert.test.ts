import { convertArgbToRgba } from '../src/pixel-convert.js';

/**
 * Reference implementation: the original byte-wise ARGB→RGBA conversion
 * from worker-api.ts, kept verbatim as the source of truth.
 */
function referenceArgbToRgba(buf: Uint8ClampedArray): void {
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3];
    const b = buf[i];
    const g = buf[i + 1];
    const r = buf[i + 2];

    if (a === 0) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
    } else if (a === 255) {
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    } else {
      buf[i] = Math.min(255, (r * 255 / a) | 0);
      buf[i + 1] = Math.min(255, (g * 255 / a) | 0);
      buf[i + 2] = Math.min(255, (b * 255 / a) | 0);
    }
  }
}

function convert(bytes: number[]): Uint8Array {
  const src = new Uint8Array(bytes);
  const dst = new Uint8Array(bytes.length);
  convertArgbToRgba(
    new Uint32Array(src.buffer),
    new Uint32Array(dst.buffer),
  );
  return dst;
}

describe('convertArgbToRgba', () => {
  it('swaps R and B for opaque pixels', () => {
    // LE bytes [B, G, R, A] → expect [R, G, B, A]
    expect([...convert([10, 20, 30, 255])]).toEqual([30, 20, 10, 255]);
  });

  it('zeroes fully transparent pixels', () => {
    expect([...convert([10, 20, 30, 0])]).toEqual([0, 0, 0, 0]);
  });

  it('un-premultiplies partially transparent pixels', () => {
    // Premultiplied: channel = round(channel * a / 255); here a=128, r=64 → ~127
    const out = convert([32, 48, 64, 128]);
    expect(out[0]).toBe(Math.min(255, (64 * 255 / 128) | 0));
    expect(out[1]).toBe(Math.min(255, (48 * 255 / 128) | 0));
    expect(out[2]).toBe(Math.min(255, (32 * 255 / 128) | 0));
    expect(out[3]).toBe(128);
  });

  it('matches the reference implementation on random data', () => {
    const n = 4096;
    const bytes = new Uint8Array(n * 4);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (Math.random() * 256) | 0;
    }
    // Force all three alpha classes to appear
    bytes[3] = 255;
    bytes[7] = 0;
    bytes[11] = 77;

    const expected = new Uint8ClampedArray(bytes);
    referenceArgbToRgba(expected);

    const dst = new Uint8Array(bytes.length);
    convertArgbToRgba(
      new Uint32Array(bytes.buffer.slice(0)),
      new Uint32Array(dst.buffer),
    );

    expect([...dst]).toEqual([...expected]);
  });

  it('supports in-place conversion (src === dst)', () => {
    const buf = new Uint8Array([10, 20, 30, 255, 1, 2, 3, 0]);
    const words = new Uint32Array(buf.buffer);
    convertArgbToRgba(words, words);
    expect([...buf]).toEqual([30, 20, 10, 255, 0, 0, 0, 0]);
  });
});
