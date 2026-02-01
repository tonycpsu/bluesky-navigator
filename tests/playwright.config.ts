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
 *   SKIP_SETUP - Set to 'true' to skip setup project (for re-runs)
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
  timeout: 60000, // 1 minute per test (reduced from 2)
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

    // Only capture artifacts on failure (faster)
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    // Setup project - runs once before tests
    {
      name: "setup",
      testMatch: "**/auth.setup.ts",
    },
    // Main test project - depends on setup
    {
      name: "firefox",
      testIgnore: "**/auth.setup.ts",
      dependencies: process.env.SKIP_SETUP ? [] : ["setup"],
      use: {
        headless: false,
      },
    },
  ],

  // Global setup for any pre-flight checks
  globalSetup: path.join(__dirname, "global-setup.js"),
});
