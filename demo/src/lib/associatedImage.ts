/**
 * Encode an associated image (`ImageData` from a slide) into a displayable URL.
 *
 * Prefers `OffscreenCanvas.convertToBlob()` (runs off the main thread) and
 * returns a `blob:` object URL — the caller is responsible for revoking it.
 * Falls back to a synchronous canvas + `toDataURL()` when OffscreenCanvas is
 * unavailable (returns a `data:` URL, nothing to revoke).
 */
export async function associatedImageToUrl(imageData: ImageData): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return URL.createObjectURL(blob);
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}
