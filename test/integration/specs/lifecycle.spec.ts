import { test, expect } from '@playwright/test';

test.describe('Slide lifecycle', () => {
  test('open and close cycle completes without error', async ({ page }) => {
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);

    const info = await page.evaluate(() =>
      (window as any).__TEST__.openSlideFromUrl(
        '/fixtures/Aperio/CMU-1-Small-Region.svs',
      ),
    );
    await page.evaluate(
      (id: string) => (window as any).__TEST__.closeSlide(id),
      info.id,
    );
    await page.evaluate(() => (window as any).__TEST__.terminate());
  });

  test('can open multiple slides sequentially', async ({ page }) => {
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);

    for (let i = 0; i < 3; i++) {
      const info = await page.evaluate(() =>
        (window as any).__TEST__.openSlideFromUrl(
          '/fixtures/Aperio/CMU-1-Small-Region.svs',
        ),
      );
      expect(info.levelCount).toBeGreaterThanOrEqual(1);
      await page.evaluate(
        (id: string) => (window as any).__TEST__.closeSlide(id),
        info.id,
      );
    }

    await page.evaluate(() => (window as any).__TEST__.terminate());
  });
});
