import { OpenSlideError, OpenSlideUnsupportedFormatError } from '../src/errors';

describe('Error classes', () => {
  test('OpenSlideError has correct name and message', () => {
    const err = new OpenSlideError('test error');
    expect(err.name).toBe('OpenSlideError');
    expect(err.message).toBe('test error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenSlideError);
  });

  test('OpenSlideUnsupportedFormatError extends OpenSlideError', () => {
    const err = new OpenSlideUnsupportedFormatError();
    expect(err.name).toBe('OpenSlideUnsupportedFormatError');
    expect(err.message).toBe('Unsupported slide format');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenSlideError);
    expect(err).toBeInstanceOf(OpenSlideUnsupportedFormatError);
  });

  test('OpenSlideUnsupportedFormatError accepts custom message', () => {
    const err = new OpenSlideUnsupportedFormatError('bad file');
    expect(err.message).toBe('bad file');
  });
});
