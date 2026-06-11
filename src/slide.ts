/**
 * slide.ts
 *
 * Represents an opened whole-slide image. Created by OpenSlide.open().
 * Metadata properties are synchronous (eagerly loaded), while pixel
 * operations are async (delegated to a worker).
 */

import type { Dimensions, SlideInfo } from './types.js';
import { OpenSlideError } from './errors.js';

/** Per-call options for worker-delegated operations. */
export interface SendOptions {
  /** Transferables to move (not copy) to the worker. */
  transfer?: Transferable[];
  /**
   * Cancels the operation if it is still queued in the worker (rejects with
   * OpenSlideAbortError). An already-executing read runs to completion.
   */
  signal?: AbortSignal;
}

/** Function type for sending a command to a worker and awaiting the response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendCommand = (cmd: Record<string, any>, opts?: SendOptions) => Promise<unknown>;

export class Slide {
  /** @internal */ private _send: SendCommand;
  /** @internal */ private _handle: number;
  /** @internal */ private _mountId: string;
  /** @internal */ private _info: SlideInfo;
  /** @internal */ private _closed = false;

  /** @internal */
  constructor(send: SendCommand, handle: number, mountId: string, info: SlideInfo) {
    this._send = send;
    this._handle = handle;
    this._mountId = mountId;
    this._info = info;
  }

  /** Number of pyramid levels in the slide. */
  get levelCount(): number {
    return this._info.levelCount;
  }

  /** Dimensions of level 0 (full resolution). */
  get dimensions(): Dimensions {
    return this._info.levelDimensions[0];
  }

  /** Dimensions of each pyramid level. */
  get levelDimensions(): readonly Dimensions[] {
    return this._info.levelDimensions;
  }

  /** Downsample factor for each pyramid level. */
  get levelDownsamples(): readonly number[] {
    return this._info.levelDownsamples;
  }

  /** Slide metadata properties (vendor, MPP, objective power, etc.). */
  get properties(): ReadonlyMap<string, string> {
    return this._info.properties;
  }

  /** Names of associated images (e.g., "label", "thumbnail", "macro"). */
  get associatedImageNames(): readonly string[] {
    return this._info.associatedImageNames;
  }

  /**
   * Find the best pyramid level for a given downsample factor.
   * Returns the level index whose downsample is closest to (but not
   * exceeding) the requested factor.
   */
  getBestLevelForDownsample(downsample: number): number {
    for (let i = this._info.levelDownsamples.length - 1; i >= 0; i--) {
      if (this._info.levelDownsamples[i] <= downsample) return i;
    }
    return 0;
  }

  /**
   * Read a region of pixel data from the slide.
   *
   * @param x - Top-left x coordinate in level-0 reference frame.
   * @param y - Top-left y coordinate in level-0 reference frame.
   * @param level - Pyramid level to read from.
   * @param width - Width in pixels at the target level.
   * @param height - Height in pixels at the target level.
   * @param options.signal - Cancels the read while it is still queued in the
   *   worker (rejects with OpenSlideAbortError); an executing read finishes.
   * @returns ImageData containing RGBA pixel data.
   */
  async readRegion(
    x: number,
    y: number,
    level: number,
    width: number,
    height: number,
    options?: { signal?: AbortSignal },
  ): Promise<ImageData> {
    this.ensureOpen();
    const buffer = await this._send({
      cmd: 'readRegion',
      handle: this._handle,
      x, y, level,
      w: width, h: height,
    }, { signal: options?.signal }) as ArrayBuffer;

    const data = new Uint8ClampedArray(buffer);
    return new ImageData(data, width, height);
  }

  /**
   * Read an associated image (e.g., slide label or macro image).
   *
   * @param name - Name of the associated image.
   * @returns ImageData containing RGBA pixel data.
   */
  async readAssociatedImage(name: string): Promise<ImageData> {
    this.ensureOpen();
    const result = await this._send({
      cmd: 'readAssociatedImage',
      handle: this._handle,
      name,
    }) as { buffer: ArrayBuffer; width: number; height: number };

    const data = new Uint8ClampedArray(result.buffer);
    return new ImageData(data, result.width, result.height);
  }

  /**
   * Get the dimensions of an associated image.
   */
  async getAssociatedImageDimensions(name: string): Promise<Dimensions> {
    this.ensureOpen();
    return await this._send({
      cmd: 'getAssociatedImageDimensions',
      handle: this._handle,
      name,
    }) as Dimensions;
  }

  /**
   * Read the ICC color profile embedded in the slide, if any.
   * @returns Raw ICC profile bytes, or null if none.
   */
  async getIccProfile(): Promise<ArrayBuffer | null> {
    this.ensureOpen();
    return await this._send({
      cmd: 'getIccProfile',
      handle: this._handle,
    }) as ArrayBuffer | null;
  }

  /** Close the slide and release WASM resources. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._send({ cmd: 'close', handle: this._handle });
    await this._send({ cmd: 'unmount', mountId: this._mountId });
  }

  /** Support for `await using slide = ...` (explicit resource management). */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private ensureOpen(): void {
    if (this._closed) {
      throw new OpenSlideError('Slide has been closed');
    }
  }
}
