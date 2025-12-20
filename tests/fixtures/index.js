/**
 * Playwright test fixtures for Bluesky Navigator
 *
 * Provides:
 * - Browser context with Tampermonkey extension loaded
 * - Authenticated page ready for testing
 * - Helper functions for common operations
 */

import { test as base, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.dirname(__dirname);

// Load environment variables
dotenv.config({ path: path.join(TESTS_DIR, '.env') });

const TAMPERMONKEY_PATH = path.join(TESTS_DIR, 'extensions', 'tampermonkey');
const USER_DATA_DIR = path.join(TESTS_DIR, 'user-data');
const USERSCRIPT_PATH = path.join(TESTS_DIR, '..', 'dist', 'bluesky-navigator.user.js');

/**
 * Custom test fixture with extension-loaded browser context
 */
export const test = base.extend({
  /**
   * Browser context with Tampermonkey loaded
   */
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        `--disable-extensions-except=${TAMPERMONKEY_PATH}`,
        `--load-extension=${TAMPERMONKEY_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
      viewport: { width: 1280, height: 720 },
    });

    await use(context);
    await context.close();
  },

  /**
   * Page that's authenticated and has the script loaded
   */
  authenticatedPage: async ({ context }, use) => {
    const page = await context.newPage();

    // Navigate to Bluesky
    await page.goto('https://bsky.app');

    // Check if already logged in
    const isLoggedIn = await page
      .locator('[data-testid="homeScreenFeedTabs"]')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!isLoggedIn) {
      // Perform login
      await login(page);
    }

    // Wait for feed to load
    await page.waitForSelector('[data-testid="feedItem"]', { timeout: 30000 });

    // Wait for userscript to initialize (toolbar appears)
    await page.waitForSelector('#bsky-navigator-toolbar', { timeout: 30000 });

    await use(page);
  },
});

/**
 * Login to Bluesky
 */
async function login(page) {
  const identifier = process.env.BSKY_IDENTIFIER;
  const password = process.env.BSKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error('Missing BSKY_IDENTIFIER or BSKY_APP_PASSWORD in environment');
  }

  // Click sign in
  await page.click('text=Sign in');

  // Fill credentials
  await page.fill('input[autocomplete="username"]', identifier);
  await page.click('button:has-text("Next")');

  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');

  // Wait for login to complete
  await page.waitForSelector('[data-testid="homeScreenFeedTabs"]', { timeout: 30000 });
}

/**
 * Helper: Wait for script to be fully ready
 */
export async function waitForScriptReady(page) {
  await page.waitForSelector('#bsky-navigator-toolbar', { timeout: 10000 });
  await page.waitForSelector('[data-testid="feedItem"]', { timeout: 10000 });
  // Small delay for script initialization
  await page.waitForTimeout(500);
}

/**
 * Helper: Get the currently focused post element
 */
export async function getCurrentPost(page) {
  return page.locator('[data-testid="feedItem"].bsky-navigator-item-current');
}

/**
 * Helper: Get all post elements
 */
export async function getAllPosts(page) {
  return page.locator('[data-testid="feedItem"]');
}

/**
 * Helper: Press a key and wait for UI to update
 */
export async function pressKey(page, key, options = {}) {
  await page.keyboard.press(key);
  if (options.waitForUpdate !== false) {
    await page.waitForTimeout(100);
  }
}

/**
 * Helper: Check if the shortcuts overlay is visible
 */
export async function isShortcutsOverlayVisible(page) {
  return page.locator('.shortcut-overlay').isVisible();
}

/**
 * Helper: Check if the config modal is visible
 */
export async function isConfigModalVisible(page) {
  return page.locator('.config-modal').isVisible();
}

/**
 * Helper: Get feed map segments
 */
export async function getFeedMapSegments(page) {
  return page.locator('.feed-map-segment');
}

export { expect } from '@playwright/test';
