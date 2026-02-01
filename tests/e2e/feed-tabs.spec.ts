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

    // Press 1 to switch to first tab - should not throw
    await feedPage.pressKey("1");

    // Wait for page to settle
    await page.waitForTimeout(500);

    // Press 2 to switch to second tab (if exists) - should not throw
    await feedPage.pressKey("2");

    // Wait for page to settle and verify we're still on a feed page
    await page.waitForTimeout(500);

    // Verify the page still has feed structure (element exists, even if not visible due to scroll)
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeAttached({ timeout: 10000 });
  });

  test("tab switching preserves feed functionality", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Get initial feed item count
    const initialCount = await page.locator('[data-testid^="feedItem-by-"]').count();

    // Switch to first tab
    await feedPage.pressKey("1");

    // Wait for feed to have posts
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeAttached({ timeout: 10000 });

    // Switch to second tab if it exists
    await feedPage.pressKey("2");
    await page.waitForTimeout(500);

    // Wait for feed to still have posts
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeAttached({ timeout: 10000 });

    // Switch back to first tab
    await feedPage.pressKey("1");
    await page.waitForTimeout(500);

    // Verify feed still works
    const finalCount = await page.locator('[data-testid^="feedItem-by-"]').count();
    expect(finalCount).toBeGreaterThan(0);
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

    // Press " to toggle hide read ON
    await feedPage.pressKey('Shift+"');
    await page.waitForTimeout(300);

    // Press " again to toggle hide read OFF (restore all posts)
    await feedPage.pressKey('Shift+"');
    await page.waitForTimeout(300);

    // Verify feed still has posts attached
    await expect(page.locator('[data-testid^="feedItem-by-"]').first()).toBeAttached();
  });
});
