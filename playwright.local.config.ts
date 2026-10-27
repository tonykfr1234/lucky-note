import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-local', timeout: 45000, expect: { timeout: 10000 }, workers: 1,
  reporter: [['list']],
  use: { headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } : {},
    screenshot: 'only-on-failure' },
  webServer: [
    { command: 'node scripts/local-preview-server.mjs dist-local', url: 'http://127.0.0.1:4320', timeout: 15000 },
    { command: 'node scripts/local-preview-server.mjs dist-preview', env: { LOCAL_PREVIEW_PORT: '4321' }, url: 'http://127.0.0.1:4321/lucky-note/', timeout: 15000 },
  ],
});
