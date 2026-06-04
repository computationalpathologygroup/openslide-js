/** Base error class for all OpenSlide errors. */
export class OpenSlideError extends Error {
  constructor(message: unknown) {
    const msg = typeof message === 'string' ? message
      : message instanceof Error ? message.message
      : typeof message === 'object' && message !== null ? JSON.stringify(message)
      : String(message);
    super(msg);
    this.name = 'OpenSlideError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the file format is not supported by OpenSlide. */
export class OpenSlideUnsupportedFormatError extends OpenSlideError {
  constructor(message?: string) {
    super(message ?? 'Unsupported slide format');
    this.name = 'OpenSlideUnsupportedFormatError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
