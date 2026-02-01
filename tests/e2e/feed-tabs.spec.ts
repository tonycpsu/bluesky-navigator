/**
 * Feed Tabs tests for Bluesky Navigator
 *
 * Tests tab switching functionality on the home page.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Tab Switching", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("number keys trigger tab switch without error", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press 1 to switch to first tab
    await feedPage.pressKey("1");

    // Press 2 to switch to second tab (if exists)
    await feedPage.pressKey("2");

    // Verify selection still works
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });

  test("tab switching preserves feed functionality", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Switch tabs
    await feedPage.pressKey("1");

    // Wait for feed to be ready
    await expect(page.locator(".item-selection-active")).toBeVisible();

    // Navigation should still work
    await feedPage.nextPost();
    const index = await feedPage.getCurrentIndex();

    expect(index).not.toBeNull();
  });
});

test.describe("Feed Refresh", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("comma key refreshes the feed", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Get initial post count
    const initialCount = await feedPage.getPostCount();

    // Press comma to refresh
    await feedPage.pressKey(",");

    // Wait for feed to have posts
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeVisible();

    // Feed should still have posts
    const afterCount = await feedPage.getPostCount();
    expect(afterCount).toBeGreaterThan(0);
  });

  test("u key loads newer posts without error", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press u to load newer posts
    await feedPage.pressKey("u");

    // Verify feed still works
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });
});

test.describe("Hide Read Toggle", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test('double-quote key toggles hide read mode', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // First mark some posts as read
    for (let i = 0; i < 3; i++) {
      await feedPage.nextPost();
    }

    // Press " (Shift+') to toggle hide read
    await feedPage.pressKey('Shift+"');

    // Verify feed still works
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeVisible();
  });
});
