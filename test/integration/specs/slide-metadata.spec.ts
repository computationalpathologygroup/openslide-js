import { test, expect, type Page } from '@playwright/test';

test.describe('Slide metadata - CMU-1-Small-Region.svs', () => {
  let page: Page;
  let slideInfo: any;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);
    slideInfo = await page.evaluate(() =>
      (window as any).__TEST__.openSlideFromUrl(
        '/fixtures/Aperio/CMU-1-Small-Region.svs',
      ),
    );
  });

  test.afterAll(async () => {
    if (slideInfo?.id) {
      await page.evaluate(
        (id: string) => (window as any).__TEST__.closeSlide(id),
        slideInfo.id,
      );
    }
    await page.evaluate(() => (window as any).__TEST__.terminate());
    await page.close();
  });

  test('has expected level count', () => {
    // CMU-1-Small-Region is small enough to have a single pyramid level
    expect(slideInfo.levelCount).toBe(1);
  });

  test('has positive dimensions', () => {
    expect(slideInfo.dimensions.width).toBeGreaterThan(0);
    expect(slideInfo.dimensions.height).toBeGreaterThan(0);
  });

  test('level 0 downsample is 1', () => {
    expect(slideInfo.levelDownsamples[0]).toBeCloseTo(1.0);
  });

  test('has openslide.vendor property', () => {
    expect(slideInfo.properties['openslide.vendor']).toBe('aperio');
  });

  test('has quickhash property', () => {
    expect(slideInfo.properties['openslide.quickhash-1']).toBeTruthy();
  });
});
