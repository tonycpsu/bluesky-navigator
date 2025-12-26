// @ts-check
import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 120000, // 2 minutes - setup with extension takes time
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Run tests serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker - worker scope shares browser within test file
  reporter: 'html',
  use: {
    baseURL: 'https://bsky.app',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        // Extensions require headed mode
        headless: false,
      },
    },
  ],
  // Global setup for extension loading
  globalSetup: path.join(__dirname, 'global-setup.js'),
});
