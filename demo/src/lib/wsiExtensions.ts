export interface WsiFormatInfo {
  vendor: string;
  format: string;
  extensions: string[];
  isMultiFile: boolean;
}

export const WSI_FORMATS: WsiFormatInfo[] = [
  { vendor: 'Aperio', format: 'SVS', extensions: ['.svs'], isMultiFile: false },
  { vendor: 'Hamamatsu', format: 'NDPI', extensions: ['.ndpi'], isMultiFile: false },
  { vendor: 'Leica', format: 'SCN', extensions: ['.scn'], isMultiFile: false },
  { vendor: 'Philips', format: 'TIFF', extensions: ['.tiff', '.tif'], isMultiFile: false },
  { vendor: 'Generic', format: 'Tiled TIFF', extensions: ['.tiff', '.tif'], isMultiFile: false },
  { vendor: 'Mirax', format: 'MRXS', extensions: ['.mrxs'], isMultiFile: true },
  { vendor: 'Hamamatsu', format: 'VMS', extensions: ['.vms'], isMultiFile: true },
  { vendor: 'Trestle', format: 'TIF', extensions: ['.tif'], isMultiFile: true },
  { vendor: 'DICOM', format: 'DCM', extensions: ['.dcm'], isMultiFile: true },
];

/** All single-file extensions (lowercased, dot-prefixed) */
export const SINGLE_FILE_EXTENSIONS = new Set<string>([
  '.svs', '.ndpi', '.scn', '.tiff', '.tif',
]);

/** Primary extensions that signal a multi-file format */
export const MULTI_FILE_PRIMARY_EXTENSIONS = new Set<string>([
  '.mrxs', '.vms', '.dcm',
]);

/** All WSI extensions (used for recursive scan filtering) */
export const ALL_WSI_EXTENSIONS = new Set<string>([
  ...SINGLE_FILE_EXTENSIONS,
  ...MULTI_FILE_PRIMARY_EXTENSIONS,
]);

export function getFormatLabel(ext: string): string {
  const lower = ext.toLowerCase();
  for (const f of WSI_FORMATS) {
    if (f.extensions.includes(lower)) return f.format;
  }
  return ext.toUpperCase().replace('.', '');
}
