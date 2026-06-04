/**
 * format-matrix.spec.ts
 *
 * Comprehensive format coverage test, modeled after the OpenSlide C library's
 * try_open + extended test programs. Runs the same battery of tests against
 * every supported format (single-file and multi-file).
 *
 * For each slide this tests:
 *  - Vendor detection (try_open -n)
 *  - Opening and metadata retrieval
 *  - Level dimensions and downsamples (extended.c level loop)
 *  - getBestLevelForDownsample with multiple values (extended.c downsample series)
 *  - Property reading and validation (extended.c property loop + quickhash check)
 *  - Region reading at multiple coordinates and levels (extended.c test_image_fetch)
 *  - Associated images: listing, dimensions, reading (extended.c associated loop)
 *  - ICC profile reading (extended.c ICC section)
 *  - DeepZoom tile generation
 *  - Slide close lifecycle
 */
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixture definitions — one per format, smallest representative file
// ---------------------------------------------------------------------------
interface SlideFixture {
  /** Display name for the test group */
  name: string;
  /** Path relative to test/data/ (served via /fixtures/) */
  file: string;
  /** Expected vendor string from detectVendor / openslide.vendor property */
  vendor: string;
  /** Description for reference */
  description: string;
  /** Minimum expected level count (most multi-level slides have >=3) */
  minLevels: number;
  /**
   * If set, the slide can be detected but NOT opened in the WASM build.
   * Only vendor detection is tested; all other tests are skipped.
   * The string documents the reason.
   */
  openFailReason?: string;
}

interface MultiFileFixture {
  /** Display name for the test group */
  name: string;
  /** Directory path relative to test/data/ (used for manifest and file serving) */
  dirPath: string;
  /** Index file path within the directory (the .mrxs, .vms, .tif, etc.) */
  slideFile: string;
  /** Expected vendor string */
  vendor: string;
  /** Description for reference */
  description: string;
  /** Minimum expected level count */
  minLevels: number;
  /** If set, the slide fails to open */
  openFailReason?: string;
}

// Slides that can be fully opened and tested
const SUPPORTED_FIXTURES: SlideFixture[] = [
  {
    name: 'Aperio SVS (JPEG)',
    file: 'Aperio/CMU-1-Small-Region.svs',
    vendor: 'aperio',
    description: 'Single pyramid level, JPEG compression',
    minLevels: 1,
  },
  {
    name: 'Aperio SVS (JPEG 2000)',
    file: 'Aperio/JP2K-33003-1.svs',
    vendor: 'aperio',
    description: 'JPEG 2000, YCbCr, multi-level',
    minLevels: 3,
  },
  {
    name: 'Generic tiled TIFF',
    file: 'Generic-TIFF/CMU-1.tiff',
    vendor: 'generic-tiff',
    description: 'Pyramidal tiled TIFF conversion of CMU-1.svs',
    minLevels: 2,
  },
  {
    name: 'Hamamatsu NDPI',
    file: 'Hamamatsu/CMU-1.ndpi',
    vendor: 'hamamatsu',
    description: 'Small scan, valid JPEG headers, circa 2009',
    minLevels: 2,
  },
  {
    name: 'Leica SCN (brightfield)',
    file: 'Leica/Leica-1.scn',
    vendor: 'leica',
    description: 'Brightfield, single ROI',
    minLevels: 2,
  },
  {
    name: 'Philips TIFF',
    file: 'Philips-TIFF/Philips-1.tiff',
    vendor: 'philips',
    description: 'BigTIFF, H&E stain, CAMELYON16',
    minLevels: 2,
  },
];

// Slides that can be detected but fail to open in the WASM build
const UNSUPPORTED_FIXTURES: SlideFixture[] = [
  {
    name: 'Leica SCN (fluorescence)',
    file: 'Leica/Leica-Fluorescence-1.scn',
    vendor: 'leica',
    description: 'Fluorescence, 3 channels, single ROI',
    minLevels: 1,
    openFailReason: 'Fluorescence-only SCN: OpenSlide cannot find main brightfield image',
  },
  {
    name: 'Ventana BIF',
    file: 'Ventana/Ventana-1.bif',
    vendor: 'ventana',
    description: 'Trichrome stain, joint direction LEFT',
    minLevels: 2,
    openFailReason: 'Bad direction attribute "LEFT" not supported in WASM OpenSlide build',
  },
  {
    name: 'Zeiss ZVI',
    file: 'Zeiss/Zeiss-1-Merged.zvi',
    vendor: null as any,
    description: 'HER2 FISH, fluorescence, 3 channels, merged',
    minLevels: 1,
    openFailReason: 'OLE2 compound document format cannot be read via HTTP range requests (vendor detection also fails)',
  },
  {
    name: 'Zeiss CZI (JPEG XR)',
    file: 'Zeiss/Zeiss-5-JXR.czi',
    vendor: null as any,
    description: 'Brightfield, JPEG XR pyramidal, two scenes',
    minLevels: 1,
    openFailReason: 'Zeiss CZI vendor support is not in OpenSlide v4.0.0 (added in upstream development; arrives in the next OpenSlide release). JPEG XR codec also not compiled into WASM build.',
  },
];

const ALL_FIXTURES = [...SUPPORTED_FIXTURES, ...UNSUPPORTED_FIXTURES];

// ---------------------------------------------------------------------------
// Multi-file format fixtures — extracted from ZIP archives in test/data/
// ---------------------------------------------------------------------------
const MULTIFILE_SUPPORTED: MultiFileFixture[] = [
  {
    name: 'MIRAX (MRXS)',
    dirPath: 'Mirax/CMU-1-Saved-1_16',
    slideFile: 'CMU-1-Saved-1_16.mrxs',
    vendor: 'mirax',
    description: 'Downsampled 1/16, smallest MIRAX test file (3.6 MB)',
    minLevels: 1,
  },
  {
    name: 'DICOM WSI (JP2K)',
    dirPath: 'DICOM/JP2K-33003-1',
    slideFile: 'DCM_4.dcm',
    vendor: 'dicom',
    description: 'JPEG 2000 DICOM WSI, 6 DCM files (62 MB)',
    minLevels: 1,
  },
  {
    name: 'Trestle TIF',
    dirPath: 'Trestle/CMU-1',
    slideFile: 'CMU-1.tif',
    vendor: 'trestle',
    description: 'Multi-file TIFF with associated metadata (159 MB)',
    minLevels: 1,
  },
  {
    name: 'Hamamatsu VMS',
    dirPath: 'Hamamatsu-vms/CMU-1',
    slideFile: 'CMU-1-40x - 2010-01-12 13.24.05.vms',
    vendor: 'hamamatsu',
    description: 'Multi-file VMS with JPEG tiles (617 MB)',
    minLevels: 1,
  },
];

const MULTIFILE_UNSUPPORTED: MultiFileFixture[] = [
  {
    name: 'Olympus VSI',
    dirPath: 'Olympus/OS-2',
    slideFile: 'OS-2.vsi',
    vendor: 'olympus',
    description: 'Multi-file VSI with ETS stacks (295 MB)',
    minLevels: 1,
    openFailReason: 'VSI opener cannot find companion _OS-2_/ directory via WORKERFS mount',
  },
];

// The same downsample values tested by extended.c
const DOWNSAMPLE_TEST_VALUES = [
  0.8, 1.0, 1.5, 2.0, 3.0, 3.1, 10, 20, 25, 100, 1000, 10000,
];

// SHA-256 of empty bytes — quickhash must NOT be this (means uninitialized)
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ---------------------------------------------------------------------------
// Tests — unsupported formats (vendor detection only)
// ---------------------------------------------------------------------------
for (const fixture of UNSUPPORTED_FIXTURES) {
  test.describe(`${fixture.name} [unsupported]`, () => {
    test(`detectVendor returns ${fixture.vendor ? '"' + fixture.vendor + '"' : 'null'}`, async ({ page }) => {
      await page.goto('/test/integration/test-harness.html');
      await page.waitForFunction(() => (window as any).__TEST_READY__);
      const vendor = await page.evaluate(
        (f: string) =>
          (window as any).__TEST__.detectVendor('/fixtures/' + f),
        fixture.file,
      );
      expect(vendor).toBe(fixture.vendor);
      await page.evaluate(() => (window as any).__TEST__.terminate());
    });

    test(`open fails as expected: ${fixture.openFailReason}`, async ({ page }) => {
      await page.goto('/test/integration/test-harness.html');
      await page.waitForFunction(() => (window as any).__TEST_READY__);
      const error = await page.evaluate(async (f: string) => {
        try {
          await (window as any).__TEST__.openSlideFromUrl('/fixtures/' + f);
          return null;
        } catch (e: any) {
          return e.message;
        }
      }, fixture.file);
      expect(error).toBeTruthy();
      await page.evaluate(() => (window as any).__TEST__.terminate());
    });
  });
}

// ---------------------------------------------------------------------------
// Tests — supported formats (full test battery)
// ---------------------------------------------------------------------------
for (const fixture of SUPPORTED_FIXTURES) {
  test.describe(fixture.name, () => {
    let page: Page;
    let slideInfo: any;

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage();
      await page.goto('/test/integration/test-harness.html');
      await page.waitForFunction(() => (window as any).__TEST_READY__);

      // Open the slide once for the entire describe block
      slideInfo = await page.evaluate(
        (f: string) =>
          (window as any).__TEST__.openSlideFromUrl('/fixtures/' + f),
        fixture.file,
      );
    });

    test.afterAll(async () => {
      await page.evaluate(() => (window as any).__TEST__.terminate());
      await page.close();
    });

    // -----------------------------------------------------------------------
    // 1. Vendor detection (try_open -n)
    // -----------------------------------------------------------------------
    test('detectVendor returns expected vendor', async () => {
      const vendor = await page.evaluate(
        (f: string) =>
          (window as any).__TEST__.detectVendor('/fixtures/' + f),
        fixture.file,
      );
      expect(vendor).toBe(fixture.vendor);
    });

    // -----------------------------------------------------------------------
    // 2. Open slide and retrieve metadata
    // -----------------------------------------------------------------------
    test('opens successfully with valid metadata', async () => {
      expect(slideInfo).toBeTruthy();
      expect(slideInfo.id).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // 3. Level metadata (extended.c level loop)
    // -----------------------------------------------------------------------
    test(`has at least ${fixture.minLevels} level(s)`, () => {
      expect(slideInfo.levelCount).toBeGreaterThanOrEqual(fixture.minLevels);
    });

    test('level 0 has positive dimensions', () => {
      expect(slideInfo.dimensions.width).toBeGreaterThan(0);
      expect(slideInfo.dimensions.height).toBeGreaterThan(0);
    });

    test('levelDimensions array length matches levelCount', () => {
      expect(slideInfo.levelDimensions).toHaveLength(slideInfo.levelCount);
    });

    test('levelDownsamples array length matches levelCount', () => {
      expect(slideInfo.levelDownsamples).toHaveLength(slideInfo.levelCount);
    });

    test('level 0 downsample is 1.0', () => {
      expect(slideInfo.levelDownsamples[0]).toBeCloseTo(1.0, 2);
    });

    test('downsamples are monotonically non-decreasing', () => {
      for (let i = 1; i < slideInfo.levelDownsamples.length; i++) {
        expect(slideInfo.levelDownsamples[i]).toBeGreaterThanOrEqual(
          slideInfo.levelDownsamples[i - 1],
        );
      }
    });

    test('level dimensions decrease or stay same as level increases', () => {
      for (let i = 1; i < slideInfo.levelDimensions.length; i++) {
        expect(slideInfo.levelDimensions[i].width).toBeLessThanOrEqual(
          slideInfo.levelDimensions[i - 1].width,
        );
        expect(slideInfo.levelDimensions[i].height).toBeLessThanOrEqual(
          slideInfo.levelDimensions[i - 1].height,
        );
      }
    });

    test('all levels have positive dimensions', () => {
      for (const dim of slideInfo.levelDimensions) {
        expect(dim.width).toBeGreaterThan(0);
        expect(dim.height).toBeGreaterThan(0);
      }
    });

    // -----------------------------------------------------------------------
    // 4. getBestLevelForDownsample (extended.c downsample series)
    // -----------------------------------------------------------------------
    test('getBestLevelForDownsample returns valid level for each test value', async () => {
      for (const ds of DOWNSAMPLE_TEST_VALUES) {
        const level = await page.evaluate(
          ({ id, ds }) =>
            (window as any).__TEST__.getBestLevelForDownsample(id, ds),
          { id: slideInfo.id, ds },
        );
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThan(slideInfo.levelCount);
      }
    });

    test('getBestLevelForDownsample(1.0) returns 0', async () => {
      const level = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.getBestLevelForDownsample(id, 1.0),
        slideInfo.id,
      );
      expect(level).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 5. Properties (extended.c property loop + quickhash check)
    // -----------------------------------------------------------------------
    test('has properties', () => {
      expect(Object.keys(slideInfo.properties).length).toBeGreaterThan(0);
    });

    test('openslide.vendor matches expected vendor', () => {
      expect(slideInfo.properties['openslide.vendor']).toBe(fixture.vendor);
    });

    test('has openslide.quickhash-1 and it is initialized', () => {
      const qh = slideInfo.properties['openslide.quickhash-1'];
      expect(qh).toBeTruthy();
      // Must not be the SHA-256 of empty bytes (means uninitialized)
      expect(qh).not.toBe(EMPTY_SHA256);
    });

    // -----------------------------------------------------------------------
    // 6. Region reading (extended.c test_image_fetch pattern)
    //    Tests reading at multiple coordinates across all levels.
    // -----------------------------------------------------------------------
    test('reads a region at origin (0,0) on level 0', async () => {
      const result = await page.evaluate(
        ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 64, 64),
        { id: slideInfo.id },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
      expect(result.byteLength).toBe(64 * 64 * 4);
    });

    test('reads a 1x1 region with valid RGBA', async () => {
      const result = await page.evaluate(
        ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 1, 1),
        { id: slideInfo.id },
      );
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.topLeftRGBA).toHaveLength(4);
      // Alpha is 255 for pixels inside tissue, 0 for pixels outside the ROI
      // (e.g., Leica SCN with ROI offset). Both are valid.
      expect([0, 255]).toContain(result.topLeftRGBA[3]);
    });

    test('reads region at center of slide', async () => {
      const x = Math.floor(slideInfo.dimensions.width / 2);
      const y = Math.floor(slideInfo.dimensions.height / 2);
      const result = await page.evaluate(
        ({ id, x, y }) =>
          (window as any).__TEST__.readRegion(id, x, y, 0, 64, 64),
        { id: slideInfo.id, x, y },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
    });

    test('reads region near bottom-right edge', async () => {
      const x = slideInfo.dimensions.width - 100;
      const y = slideInfo.dimensions.height - 100;
      const result = await page.evaluate(
        ({ id, x, y }) =>
          (window as any).__TEST__.readRegion(id, x, y, 0, 64, 64),
        { id: slideInfo.id, x, y },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
    });

    test('reads region on each pyramid level', async () => {
      for (let level = 0; level < slideInfo.levelCount; level++) {
        const result = await page.evaluate(
          ({ id, level }) =>
            (window as any).__TEST__.readRegion(id, 0, 0, level, 32, 32),
          { id: slideInfo.id, level },
        );
        expect(result.width).toBe(32);
        expect(result.height).toBe(32);
        expect(result.byteLength).toBe(32 * 32 * 4);
      }
    });

    test('pixels are non-trivial (not all zeros)', async () => {
      // Some formats (e.g., Leica SCN) have ROI offsets, so transparent
      // padding can appear at (0,0) and even at the geometric center.
      // Try several sample points to find tissue pixels.
      const w = slideInfo.dimensions.width;
      const h = slideInfo.dimensions.height;
      const samplePoints = [
        [Math.floor(w / 2), Math.floor(h / 2)],
        [Math.floor(w / 4), Math.floor(h / 4)],
        [Math.floor((w * 3) / 4), Math.floor((h * 3) / 4)],
        [Math.floor(w / 3), Math.floor(h / 2)],
      ];
      let foundNonTrivial = false;
      for (const [x, y] of samplePoints) {
        const result = await page.evaluate(
          ({ id, x, y }) =>
            (window as any).__TEST__.readRegion(id, x, y, 0, 16, 16),
          { id: slideInfo.id, x, y },
        );
        if (result.checksumFirst100 > 0) {
          foundNonTrivial = true;
          break;
        }
      }
      expect(foundNonTrivial).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 7. Associated images (extended.c associated loop)
    // -----------------------------------------------------------------------
    test('associated image names is an array', () => {
      expect(Array.isArray(slideInfo.associatedImageNames)).toBe(true);
    });

    test('can read dimensions and pixels for each associated image', async () => {
      for (const name of slideInfo.associatedImageNames) {
        const dims = await page.evaluate(
          ({ id, n }) =>
            (window as any).__TEST__.getAssociatedImageDimensions(id, n),
          { id: slideInfo.id, n: name },
        );
        expect(dims.width).toBeGreaterThan(0);
        expect(dims.height).toBeGreaterThan(0);

        const img = await page.evaluate(
          ({ id, n }) =>
            (window as any).__TEST__.readAssociatedImage(id, n),
          { id: slideInfo.id, n: name },
        );
        expect(img.width).toBe(dims.width);
        expect(img.height).toBe(dims.height);
      }
    });

    // -----------------------------------------------------------------------
    // 8. ICC profile (extended.c ICC section)
    // -----------------------------------------------------------------------
    test('getIccProfile returns null or a valid buffer', async () => {
      const profile = await page.evaluate(
        (id: string) => (window as any).__TEST__.getIccProfile(id),
        slideInfo.id,
      );
      if (profile !== null) {
        expect(profile.byteLength).toBeGreaterThan(0);
      }
      // null is also valid — not all slides have ICC profiles
    });

    // -----------------------------------------------------------------------
    // 9. DeepZoom tile generation
    // -----------------------------------------------------------------------
    test('DeepZoom generator creates valid tile hierarchy', async () => {
      const dz = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.createDeepZoom(id, {
            tileSize: 254,
            overlap: 1,
          }),
        slideInfo.id,
      );
      expect(dz.levelCount).toBeGreaterThan(0);
      expect(dz.tileCount).toBeGreaterThan(0);
    });

    test('DeepZoom can fetch top-level tile', async () => {
      const dz = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.createDeepZoom(id, {
            tileSize: 254,
            overlap: 1,
          }),
        slideInfo.id,
      );
      const topLevel = dz.levelCount - 1;
      const tile = await page.evaluate(
        ({ dzId, level }) =>
          (window as any).__TEST__.getDziTile(dzId, level, 0, 0),
        { dzId: dz.dzId, level: topLevel },
      );
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // 10. Slide close lifecycle
    // -----------------------------------------------------------------------
    test('closes without error', async () => {
      await page.evaluate(
        (id: string) => (window as any).__TEST__.closeSlide(id),
        slideInfo.id,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Tests — multi-file unsupported formats (vendor detection only)
// ---------------------------------------------------------------------------
for (const fixture of MULTIFILE_UNSUPPORTED) {
  test.describe(`${fixture.name} [multi-file, unsupported]`, () => {
    test(`open fails as expected: ${fixture.openFailReason}`, async ({ page }) => {
      await page.goto('/test/integration/test-harness.html');
      await page.waitForFunction(() => (window as any).__TEST_READY__);
      const error = await page.evaluate(async ({ dir, slideFile }: { dir: string; slideFile: string }) => {
        try {
          await (window as any).__TEST__.openSlideFromDir(
            '/fixtures-manifest/' + dir,
            slideFile,
          );
          return null;
        } catch (e: any) {
          return e.message;
        }
      }, { dir: fixture.dirPath, slideFile: fixture.slideFile });
      expect(error).toBeTruthy();
      await page.evaluate(() => (window as any).__TEST__.terminate());
    });
  });
}

// ---------------------------------------------------------------------------
// Tests — multi-file supported formats (full test battery)
// ---------------------------------------------------------------------------
for (const fixture of MULTIFILE_SUPPORTED) {
  test.describe(`${fixture.name} [multi-file]`, () => {
    let page: Page;
    let slideInfo: any;

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage();
      await page.goto('/test/integration/test-harness.html');
      await page.waitForFunction(() => (window as any).__TEST_READY__);

      // Open the multi-file slide once for the entire describe block
      slideInfo = await page.evaluate(
        ({ dir, slideFile }) =>
          (window as any).__TEST__.openSlideFromDir(
            '/fixtures-manifest/' + dir,
            slideFile,
          ),
        { dir: fixture.dirPath, slideFile: fixture.slideFile },
      );
    });

    test.afterAll(async () => {
      await page.evaluate(() => (window as any).__TEST__.terminate());
      await page.close();
    });

    // -----------------------------------------------------------------------
    // 2. Open slide and retrieve metadata
    // -----------------------------------------------------------------------
    test('opens successfully with valid metadata', async () => {
      expect(slideInfo).toBeTruthy();
      expect(slideInfo.id).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // 3. Level metadata (extended.c level loop)
    // -----------------------------------------------------------------------
    test(`has at least ${fixture.minLevels} level(s)`, () => {
      expect(slideInfo.levelCount).toBeGreaterThanOrEqual(fixture.minLevels);
    });

    test('level 0 has positive dimensions', () => {
      expect(slideInfo.dimensions.width).toBeGreaterThan(0);
      expect(slideInfo.dimensions.height).toBeGreaterThan(0);
    });

    test('levelDimensions array length matches levelCount', () => {
      expect(slideInfo.levelDimensions).toHaveLength(slideInfo.levelCount);
    });

    test('levelDownsamples array length matches levelCount', () => {
      expect(slideInfo.levelDownsamples).toHaveLength(slideInfo.levelCount);
    });

    test('level 0 downsample is 1.0', () => {
      expect(slideInfo.levelDownsamples[0]).toBeCloseTo(1.0, 2);
    });

    test('downsamples are monotonically non-decreasing', () => {
      for (let i = 1; i < slideInfo.levelDownsamples.length; i++) {
        expect(slideInfo.levelDownsamples[i]).toBeGreaterThanOrEqual(
          slideInfo.levelDownsamples[i - 1],
        );
      }
    });

    test('level dimensions decrease or stay same as level increases', () => {
      for (let i = 1; i < slideInfo.levelDimensions.length; i++) {
        expect(slideInfo.levelDimensions[i].width).toBeLessThanOrEqual(
          slideInfo.levelDimensions[i - 1].width,
        );
        expect(slideInfo.levelDimensions[i].height).toBeLessThanOrEqual(
          slideInfo.levelDimensions[i - 1].height,
        );
      }
    });

    test('all levels have positive dimensions', () => {
      for (const dim of slideInfo.levelDimensions) {
        expect(dim.width).toBeGreaterThan(0);
        expect(dim.height).toBeGreaterThan(0);
      }
    });

    // -----------------------------------------------------------------------
    // 4. getBestLevelForDownsample (extended.c downsample series)
    // -----------------------------------------------------------------------
    test('getBestLevelForDownsample returns valid level for each test value', async () => {
      for (const ds of DOWNSAMPLE_TEST_VALUES) {
        const level = await page.evaluate(
          ({ id, ds }) =>
            (window as any).__TEST__.getBestLevelForDownsample(id, ds),
          { id: slideInfo.id, ds },
        );
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThan(slideInfo.levelCount);
      }
    });

    test('getBestLevelForDownsample(1.0) returns 0', async () => {
      const level = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.getBestLevelForDownsample(id, 1.0),
        slideInfo.id,
      );
      expect(level).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 5. Properties (extended.c property loop + quickhash check)
    // -----------------------------------------------------------------------
    test('has properties', () => {
      expect(Object.keys(slideInfo.properties).length).toBeGreaterThan(0);
    });

    test('openslide.vendor matches expected vendor', () => {
      expect(slideInfo.properties['openslide.vendor']).toBe(fixture.vendor);
    });

    test('has openslide.quickhash-1 and it is initialized', () => {
      const qh = slideInfo.properties['openslide.quickhash-1'];
      expect(qh).toBeTruthy();
      expect(qh).not.toBe(EMPTY_SHA256);
    });

    // -----------------------------------------------------------------------
    // 6. Region reading (extended.c test_image_fetch pattern)
    // -----------------------------------------------------------------------
    test('reads a region at origin (0,0) on level 0', async () => {
      const result = await page.evaluate(
        ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 64, 64),
        { id: slideInfo.id },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
      expect(result.byteLength).toBe(64 * 64 * 4);
    });

    test('reads a 1x1 region with valid RGBA', async () => {
      const result = await page.evaluate(
        ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 1, 1),
        { id: slideInfo.id },
      );
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.topLeftRGBA).toHaveLength(4);
      expect([0, 255]).toContain(result.topLeftRGBA[3]);
    });

    test('reads region at center of slide', async () => {
      const x = Math.floor(slideInfo.dimensions.width / 2);
      const y = Math.floor(slideInfo.dimensions.height / 2);
      const result = await page.evaluate(
        ({ id, x, y }) =>
          (window as any).__TEST__.readRegion(id, x, y, 0, 64, 64),
        { id: slideInfo.id, x, y },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
    });

    test('reads region near bottom-right edge', async () => {
      const x = slideInfo.dimensions.width - 100;
      const y = slideInfo.dimensions.height - 100;
      const result = await page.evaluate(
        ({ id, x, y }) =>
          (window as any).__TEST__.readRegion(id, x, y, 0, 64, 64),
        { id: slideInfo.id, x, y },
      );
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
    });

    test('reads region on each pyramid level', async () => {
      for (let level = 0; level < slideInfo.levelCount; level++) {
        const result = await page.evaluate(
          ({ id, level }) =>
            (window as any).__TEST__.readRegion(id, 0, 0, level, 32, 32),
          { id: slideInfo.id, level },
        );
        expect(result.width).toBe(32);
        expect(result.height).toBe(32);
        expect(result.byteLength).toBe(32 * 32 * 4);
      }
    });

    test('pixels are non-trivial (not all zeros)', async () => {
      const w = slideInfo.dimensions.width;
      const h = slideInfo.dimensions.height;
      const samplePoints = [
        [Math.floor(w / 2), Math.floor(h / 2)],
        [Math.floor(w / 4), Math.floor(h / 4)],
        [Math.floor((w * 3) / 4), Math.floor((h * 3) / 4)],
        [Math.floor(w / 3), Math.floor(h / 2)],
      ];
      let foundNonTrivial = false;
      for (const [x, y] of samplePoints) {
        const result = await page.evaluate(
          ({ id, x, y }) =>
            (window as any).__TEST__.readRegion(id, x, y, 0, 16, 16),
          { id: slideInfo.id, x, y },
        );
        if (result.checksumFirst100 > 0) {
          foundNonTrivial = true;
          break;
        }
      }
      expect(foundNonTrivial).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 7. Associated images (extended.c associated loop)
    // -----------------------------------------------------------------------
    test('associated image names is an array', () => {
      expect(Array.isArray(slideInfo.associatedImageNames)).toBe(true);
    });

    test('can read dimensions and pixels for each associated image', async () => {
      for (const name of slideInfo.associatedImageNames) {
        const dims = await page.evaluate(
          ({ id, n }) =>
            (window as any).__TEST__.getAssociatedImageDimensions(id, n),
          { id: slideInfo.id, n: name },
        );
        expect(dims.width).toBeGreaterThan(0);
        expect(dims.height).toBeGreaterThan(0);

        const img = await page.evaluate(
          ({ id, n }) =>
            (window as any).__TEST__.readAssociatedImage(id, n),
          { id: slideInfo.id, n: name },
        );
        expect(img.width).toBe(dims.width);
        expect(img.height).toBe(dims.height);
      }
    });

    // -----------------------------------------------------------------------
    // 8. ICC profile (extended.c ICC section)
    // -----------------------------------------------------------------------
    test('getIccProfile returns null or a valid buffer', async () => {
      const profile = await page.evaluate(
        (id: string) => (window as any).__TEST__.getIccProfile(id),
        slideInfo.id,
      );
      if (profile !== null) {
        expect(profile.byteLength).toBeGreaterThan(0);
      }
    });

    // -----------------------------------------------------------------------
    // 9. DeepZoom tile generation
    // -----------------------------------------------------------------------
    test('DeepZoom generator creates valid tile hierarchy', async () => {
      const dz = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.createDeepZoom(id, {
            tileSize: 254,
            overlap: 1,
          }),
        slideInfo.id,
      );
      expect(dz.levelCount).toBeGreaterThan(0);
      expect(dz.tileCount).toBeGreaterThan(0);
    });

    test('DeepZoom can fetch top-level tile', async () => {
      const dz = await page.evaluate(
        (id: string) =>
          (window as any).__TEST__.createDeepZoom(id, {
            tileSize: 254,
            overlap: 1,
          }),
        slideInfo.id,
      );
      const topLevel = dz.levelCount - 1;
      const tile = await page.evaluate(
        ({ dzId, level }) =>
          (window as any).__TEST__.getDziTile(dzId, level, 0, 0),
        { dzId: dz.dzId, level: topLevel },
      );
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // 10. Slide close lifecycle
    // -----------------------------------------------------------------------
    test('closes without error', async () => {
      await page.evaluate(
        (id: string) => (window as any).__TEST__.closeSlide(id),
        slideInfo.id,
      );
    });
  });
}
