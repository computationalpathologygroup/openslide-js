import { test, expect } from '@playwright/test';

test.describe('OpenSlide version', () => {
  test('getVersion returns a version string', async ({ page }) => {
    await page.goto('/test/integration/test-harness.html');
    await page.waitForFunction(() => (window as any).__TEST_READY__);

    const version = await page.evaluate(() => (window as any).__TEST__.getVersion());
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
