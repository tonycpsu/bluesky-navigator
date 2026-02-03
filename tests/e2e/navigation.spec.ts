/**
 * Navigation tests for Bluesky Navigator
 *
 * Tests keyboard navigation between posts using vim-style keys
 * and standard navigation keys.
 *
 * Note: Tests are designed to work regardless of feedSortReverse setting.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Post Navigation", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("j key changes selection", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    const initialIndex = await feedPage.getCurrentIndex();
    expect(initialIndex).not.toBeNull();

    // Press j multiple times to ensure movement
    await feedPage.nextPost();
    await feedPage.nextPost();

    const afterIndex = await feedPage.getCurrentIndex();
    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(initialIndex);
  });

  test("k key changes selection in opposite direction", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Start at a known position using goToFirstPost (includes proper waiting)
    await feedPage.goToFirstPost();

    // Move forward several times to ensure we're not at the start
    for (let i = 0; i < 5; i++) {
      await feedPage.nextPost();
    }

    // Wait for selection to be visible after navigation
    await expect(page.locator(".item-selection-active")).toBeVisible();
    const afterJIndex = await feedPage.getCurrentIndex();
    expect(afterJIndex).toBeGreaterThan(0);

    // Now move backward with k - press multiple times since k scrolls within tall posts first
    // We need to press enough times to ensure we navigate to a previous post
    for (let i = 0; i < 5; i++) {
      await feedPage.pressKey("k");
      await page.waitForTimeout(200);
    }

    // Wait a bit for the navigation to complete
    await page.waitForTimeout(500);
    const afterKIndex = await feedPage.getCurrentIndex();

    // k should have moved to a previous post (lower index)
    expect(afterKIndex).not.toBeNull();
    expect(afterKIndex).toBeLessThan(afterJIndex!);
  });

  test("ArrowDown moves to next post when current post fits in viewport", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Navigate to find a short post that fits in viewport
    // ArrowDown scrolls within tall posts, so we need a short one to test navigation
    await feedPage.goToFirstPost();

    let foundShortPost = false;
    for (let i = 0; i < 10; i++) {
      const postFitsInViewport = await page.evaluate(() => {
        const post = document.querySelector(".item-selection-active");
        if (!post) return false;
        const rect = post.getBoundingClientRect();
        return rect.height < window.innerHeight * 0.8; // Post is less than 80% of viewport
      });

      if (postFitsInViewport) {
        foundShortPost = true;
        break;
      }
      // Use j to move to next post (j always moves, unlike ArrowDown)
      await feedPage.nextPost();
    }

    if (!foundShortPost) {
      test.skip(); // Skip if no short posts found in first 10
      return;
    }

    const initialIndex = await feedPage.getCurrentIndex();

    // Press ArrowDown - should move to next post since current post fits in viewport
    await feedPage.pressKey("ArrowDown");
    const afterIndex = await feedPage.waitForIndexChange(initialIndex, 5000);

    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(initialIndex);
  });

  test("Home and End move to opposite extremes", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Get initial index
    const initialIndex = await feedPage.getCurrentIndex();

    // Press Home and wait for index to potentially change
    await feedPage.pressKey("Home");
    const homeIndex = await feedPage.waitForIndexChange(initialIndex);

    // Press End and wait for index to change from Home position
    await feedPage.pressKey("End");
    const endIndex = await feedPage.waitForIndexChange(homeIndex);

    // Home and End should result in different positions
    expect(homeIndex).not.toBeNull();
    expect(endIndex).not.toBeNull();
    expect(homeIndex).not.toBe(endIndex);

    // One should be 0 and the other should be high
    const minIndex = Math.min(homeIndex!, endIndex!);
    const maxIndex = Math.max(homeIndex!, endIndex!);
    expect(minIndex).toBe(0);
    expect(maxIndex).toBeGreaterThan(0);
  });

  test("PageDown moves posts", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Start at Home position
    const initialIndex = await feedPage.getCurrentIndex();
    await feedPage.pressKey("Home");
    const startIndex = await feedPage.waitForIndexChange(initialIndex);

    // Press PageDown and wait for change
    await feedPage.pressKey("PageDown");
    const afterIndex = await feedPage.waitForIndexChange(startIndex);

    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(startIndex);

    // PageDown should move at least 1 post (may move more depending on viewport)
    const distance = Math.abs(afterIndex! - startIndex!);
    expect(distance).toBeGreaterThanOrEqual(1);
  });

  test("PageUp moves posts in opposite direction", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Start at End position (opposite of Home)
    const initialIndex = await feedPage.getCurrentIndex();
    await feedPage.pressKey("End");
    const startIndex = await feedPage.waitForIndexChange(initialIndex);

    // Press PageUp and wait for change
    await feedPage.pressKey("PageUp");
    const afterIndex = await feedPage.waitForIndexChange(startIndex);

    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(startIndex);

    // PageUp should move at least 1 post (may move more depending on viewport)
    const distance = Math.abs(afterIndex! - startIndex!);
    expect(distance).toBeGreaterThanOrEqual(1);
  });

  test("post gets marked as read when navigated", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Navigate through several posts
    for (let i = 0; i < 5; i++) {
      await feedPage.nextPost();
    }

    // Wait for read status to be applied (check element exists, may be filtered)
    await expect(page.locator(".item-read").first()).toBeAttached();
  });
});
