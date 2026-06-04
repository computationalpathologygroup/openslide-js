import { test, expect } from '@playwright/test';

test.describe('Slide opening', () => {
  test('opens CMU-1-Small-Region.svs from URL', async ({ page }) => {
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);

    const info = await page.evaluate(async () => {
      return (window as any).__TEST__.openSlideFromUrl(
        '/fixtures/Aperio/CMU-1-Small-Region.svs',
      );
    });

    expect(info.levelCount).toBeGreaterThanOrEqual(1);
    expect(info.dimensions.width).toBeGreaterThan(0);
    expect(info.dimensions.height).toBeGreaterThan(0);

    await page.evaluate((id: string) => (window as any).__TEST__.closeSlide(id), info.id);
    await page.evaluate(() => (window as any).__TEST__.terminate());
  });
});
