import { defineConfig } from '@playwright/test';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8090',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      args: ['--enable-features=SharedArrayBuffer'],
    },
  },
  webServer: {
    command: 'node test/integration/server.mjs',
    port: 8090,
    reuseExistingServer: !process.env.CI,
    cwd: ROOT,
  },
});
