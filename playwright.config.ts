import { defineConfig, devices } from '@playwright/test';
import { launchOptions } from './test/e2e/browsers';

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build:test && pnpm preview:test',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /smoke\.spec/,
      use: { ...devices['Desktop Chrome'], launchOptions: launchOptions.chromium },
    },
    {
      name: 'firefox',
      testMatch: /smoke\.spec/,
      use: { ...devices['Desktop Firefox'], launchOptions: launchOptions.firefox },
    },
    { name: 'webkit', testMatch: /smoke\.spec/, use: { ...devices['Desktop Safari'] } },
    // Call tests launch their own browsers (two at a time, possibly different engines).
    { name: 'calls', testMatch: /calls\/.*\.spec/, timeout: 90_000 },
    { name: 'ui', testMatch: /ui\/.*\.spec/, timeout: 90_000 },
  ],
});
