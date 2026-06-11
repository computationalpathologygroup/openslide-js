/**
 * pixel-convert.ts
 *
 * Word-wise conversion of OpenSlide's pre-multiplied ARGB32 output to
 * straight RGBA. Assumes a little-endian host (WASM is always LE, and all
 * browsers that can run it are too): a source word reads 0xAARRGGBB and the
 * destination word must read 0xAABBGGRR so its bytes land as [R, G, B, A].
 */

/**
 * Convert pre-multiplied ARGB to straight RGBA, one 32-bit word per pixel.
 * `src` and `dst` must have the same length; they may alias (in-place).
 */
export function convertArgbToRgba(src: Uint32Array, dst: Uint32Array): void {
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    const a = v >>> 24;

    if (a === 255) {
      // Opaque (the overwhelmingly common case for brightfield slides):
      // keep A and G in place, swap R and B.
      dst[i] = (v & 0xff00ff00) | ((v >>> 16) & 0xff) | ((v & 0xff) << 16);
    } else if (a === 0) {
      dst[i] = 0;
    } else {
      // Un-premultiply each channel, then compose as RGBA.
      const r = Math.min(255, ((((v >>> 16) & 0xff) * 255) / a) | 0);
      const g = Math.min(255, ((((v >>> 8) & 0xff) * 255) / a) | 0);
      const b = Math.min(255, (((v & 0xff) * 255) / a) | 0);
      dst[i] = (a << 24) | (b << 16) | (g << 8) | r;
    }
  }
}
