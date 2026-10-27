import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 45000, expect: { timeout: 8000 },
  fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4318',
    headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: false, timeout: 15000 },
});
