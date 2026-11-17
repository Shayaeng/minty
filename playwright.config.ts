import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 180_000,
  use: { baseURL: 'http://127.0.0.1:8788', channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true },
  webServer: {
    command: 'node scripts/prepare-household-e2e.mjs && npx wrangler dev --config .wrangler-household-e2e.jsonc --ip 127.0.0.1 --port 8788 --var MINTY_DEV_NO_AUTH:1 --var IRS_LIMITS:off --persist-to .wrangler/household-e2e',
    url: 'http://127.0.0.1:8788/healthz',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
