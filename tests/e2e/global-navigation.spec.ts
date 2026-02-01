/**
 * Global Navigation tests for Bluesky Navigator
 *
 * Tests Alt+key shortcuts for navigating to different sections of Bluesky.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Global Navigation Shortcuts", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("Alt+N navigates to Notifications", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press Alt+N
    await feedPage.pressKey("Alt+n");

    // Wait for navigation (auto-retries)
    await page.waitForURL(/\/notifications/, { timeout: 10000 });

    expect(page.url()).toContain("/notifications");
  });

  test("Alt+E navigates to Explore/Search", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press Alt+E
    await feedPage.pressKey("Alt+e");

    // Wait for navigation (auto-retries)
    await page.waitForURL(/\/search/, { timeout: 10000 });

    expect(page.url()).toContain("/search");
  });

  test("Alt+F navigates to Feeds", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press Alt+F
    await feedPage.pressKey("Alt+f");

    // Wait for navigation (auto-retries)
    await page.waitForURL(/\/feeds/, { timeout: 10000 });

    expect(page.url()).toContain("/feeds");
  });

  test("Alt+H navigates to Home from another page", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // First navigate away from home
    await feedPage.pressKey("Alt+n");
    await page.waitForURL(/\/notifications/, { timeout: 10000 }).catch(() => {});

    // Press Alt+H to go home
    await page.keyboard.press("Alt+KeyH");

    // Wait for home page
    await expect(page).toHaveURL(/bsky\.app\/?(\?.*)?$/, { timeout: 10000 });
  });

  test("Alt+, navigates to Settings", async ({ authenticatedPage: page }) => {
    // Use evaluate to dispatch the keyboard event directly
    await page.evaluate(() => {
      const eventInit = {
        key: ",",
        code: "Comma",
        keyCode: 188,
        which: 188,
        altKey: true,
        bubbles: true,
        cancelable: true,
      };
      document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    });

    // Wait for navigation (auto-retries)
    await page.waitForURL(/\/settings/, { timeout: 10000 });

    expect(page.url()).toContain("/settings");
  });
});
