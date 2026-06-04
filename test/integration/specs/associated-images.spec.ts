import { test, expect, type Page } from '@playwright/test';

test.describe('Associated images - CMU-1-Small-Region.svs', () => {
  let page: Page;
  let slideId: string;
  let associatedNames: string[];

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
    associatedNames = info.associatedImageNames;
  });

  test.afterAll(async () => {
    await page.evaluate(
      (id: string) => (window as any).__TEST__.closeSlide(id),
      slideId,
    );
    await page.evaluate(() => (window as any).__TEST__.terminate());
    await page.close();
  });

  test('lists associated image names', () => {
    expect(Array.isArray(associatedNames)).toBe(true);
  });

  test('can read each associated image', async () => {
    for (const name of associatedNames) {
      const dims = await page.evaluate(
        ({ id, n }) =>
          (window as any).__TEST__.getAssociatedImageDimensions(id, n),
        { id: slideId, n: name },
      );
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);

      const img = await page.evaluate(
        ({ id, n }) => (window as any).__TEST__.readAssociatedImage(id, n),
        { id: slideId, n: name },
      );
      expect(img.width).toBe(dims.width);
      expect(img.height).toBe(dims.height);
    }
  });
});
