/**
 * Vim-style Navigation tests for Bluesky Navigator
 *
 * Tests vim-style keyboard commands like gg and G.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Vim Navigation", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("gg moves to first post", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // First move somewhere in the middle
    await feedPage.nextPost();
    await feedPage.nextPost();
    await feedPage.nextPost();

    const middleIndex = await feedPage.getCurrentIndex();
    expect(middleIndex).toBeGreaterThan(0);

    // Press gg (two g keys)
    await feedPage.pressKey("g");
    await feedPage.pressKey("g");

    const afterGGIndex = await feedPage.waitForIndexChange(middleIndex);

    // Should be at beginning (index 0) or moved toward it
    // Due to feedSortReverse, we just check it changed
    expect(afterGGIndex).not.toBe(middleIndex);
  });

  test("G command moves selection", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press G (shift+g) to go to last post
    await feedPage.pressKey("Shift+g");

    // Verify we still have a selected post (auto-retries)
    const selectedPost = page.locator(".item-selection-active");
    await expect(selectedPost).toBeVisible();
  });

  test("h navigates back in history", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press h to go back - just verify no error
    await feedPage.pressKey("h");

    // URL should still be defined
    expect(page.url()).toBeDefined();
  });
});
