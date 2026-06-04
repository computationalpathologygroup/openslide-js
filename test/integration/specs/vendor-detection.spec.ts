import { test, expect } from '@playwright/test';

test.describe('Vendor detection', () => {
  test('detects Aperio vendor for .svs file', async ({ page }) => {
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);

    const vendor = await page.evaluate(() =>
      (window as any).__TEST__.detectVendor('/fixtures/Aperio/CMU-1-Small-Region.svs'),
    );
    expect(vendor).toBe('aperio');
  });
});
