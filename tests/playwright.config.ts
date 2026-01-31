import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright Test configuration for Bluesky Navigator E2E tests
 *
 * Environment variables:
 *   BSKY_IDENTIFIER - Bluesky handle or email
 *   BSKY_APP_PASSWORD - Bluesky app password
 *   DEBUG_PAUSE - Set to 'true' to pause after each test
 *   HEADLESS - Set to 'false' to show browser (note: extensions require headed mode)
 */
export default defineConfig({
  testDir: "./e2e",

  // Output directories
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "./test-results",

  // Reporter configuration
  reporter: [
    ["html", { outputFolder: "./playwright-report", open: "never" }],
    ["json", { outputFile: "./test-results/results.json" }],
    ["list"],
  ],

  // Test execution settings
  timeout: 120000, // 2 minutes - setup with extension takes time
  expect: {
    timeout: 10000,
  },

  // Run tests serially (extension context is shared)
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  // Shared settings for all projects
  use: {
    baseURL: "https://bsky.app",
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,

    // Artifact capture
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "firefox",
      use: {
        // Extensions require headed mode
        headless: false,
      },
    },
  ],

  // Global setup for extension loading
  globalSetup: path.join(__dirname, "global-setup.js"),
});
