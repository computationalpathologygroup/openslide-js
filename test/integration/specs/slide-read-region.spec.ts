import { test, expect, type Page } from '@playwright/test';

test.describe('readRegion - CMU-1-Small-Region.svs', () => {
  let page: Page;
  let slideId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);
    const info = await page.evaluate(() =>
      (window as any).__TEST__.openSlideFromUrl(
        '/fixtures/Aperio/CMU-1-Small-Region.svs',
      ),
    );
    slideId = info.id;
  });

  test.afterAll(async () => {
    await page.evaluate(
      (id: string) => (window as any).__TEST__.closeSlide(id),
      slideId,
    );
    await page.evaluate(() => (window as any).__TEST__.terminate());
    await page.close();
  });

  test('reads a small region at level 0', async () => {
    const result = await page.evaluate(
      ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 64, 64),
      { id: slideId },
    );
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(result.byteLength).toBe(64 * 64 * 4);
  });

  test('pixels are non-trivial (not all zeros)', async () => {
    const result = await page.evaluate(
      ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 16, 16),
      { id: slideId },
    );
    expect(result.checksumFirst100).toBeGreaterThan(0);
  });

  test('reads a 1x1 region', async () => {
    const result = await page.evaluate(
      ({ id }) => (window as any).__TEST__.readRegion(id, 0, 0, 0, 1, 1),
      { id: slideId },
    );
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.topLeftRGBA).toHaveLength(4);
    // Alpha should be 255 for a valid pixel
    expect(result.topLeftRGBA[3]).toBe(255);
  });
});
