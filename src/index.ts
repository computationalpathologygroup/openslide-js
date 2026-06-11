// Core classes
export { OpenSlide } from './openslide.js';
export { Slide } from './slide.js';
export { DeepZoomGenerator } from './deep-zoom.js';
export type { DeepZoomOptions } from './deep-zoom.js';

// Errors
export { OpenSlideError, OpenSlideAbortError, OpenSlideUnsupportedFormatError } from './errors.js';

// Types
export type {
  Dimensions,
  SlideInfo,
  DziInfo,
  OpenSlideOptions,
  SlideSource,
  VirtualFile,
} from './types.js';

// Property name constants (matching OpenSlide C library)
export const PROPERTY_NAME_COMMENT = 'openslide.comment';
export const PROPERTY_NAME_VENDOR = 'openslide.vendor';
export const PROPERTY_NAME_QUICKHASH1 = 'openslide.quickhash-1';
export const PROPERTY_NAME_BACKGROUND_COLOR = 'openslide.background-color';
export const PROPERTY_NAME_OBJECTIVE_POWER = 'openslide.objective-power';
export const PROPERTY_NAME_MPP_X = 'openslide.mpp-x';
export const PROPERTY_NAME_MPP_Y = 'openslide.mpp-y';
export const PROPERTY_NAME_BOUNDS_X = 'openslide.bounds-x';
export const PROPERTY_NAME_BOUNDS_Y = 'openslide.bounds-y';
export const PROPERTY_NAME_BOUNDS_WIDTH = 'openslide.bounds-width';
export const PROPERTY_NAME_BOUNDS_HEIGHT = 'openslide.bounds-height';
