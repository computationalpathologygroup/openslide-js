import { test, expect, type Page } from '@playwright/test';

test.describe('DeepZoom integration - CMU-1-Small-Region.svs', () => {
  let page: Page;
  let slideId: string;
  let dzInfo: any;

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
    dzInfo = await page.evaluate(
      (id: string) =>
        (window as any).__TEST__.createDeepZoom(id, {
          tileSize: 254,
          overlap: 1,
        }),
      slideId,
    );
  });

  test.afterAll(async () => {
    await page.evaluate(
      (id: string) => (window as any).__TEST__.closeSlide(id),
      slideId,
    );
    await page.evaluate(() => (window as any).__TEST__.terminate());
    await page.close();
  });

  test('has positive level count and tile count', () => {
    expect(dzInfo.levelCount).toBeGreaterThan(0);
    expect(dzInfo.tileCount).toBeGreaterThan(0);
  });

  test('can fetch a tile from the top level', async () => {
    const topLevel = dzInfo.levelCount - 1;
    const tile = await page.evaluate(
      ({ dzId, level }) =>
        (window as any).__TEST__.getDziTile(dzId, level, 0, 0),
      { dzId: dzInfo.dzId, level: topLevel },
    );
    expect(tile.width).toBeGreaterThan(0);
    expect(tile.height).toBeGreaterThan(0);
  });
});
