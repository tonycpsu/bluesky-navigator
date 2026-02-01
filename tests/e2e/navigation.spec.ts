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

    // Now move backward with k
    await feedPage.pressKey("k");

    // Wait for the index to change
    const afterKIndex = await feedPage.waitForIndexChange(afterJIndex, 8000);

    // k should move in opposite direction (index should change)
    expect(afterKIndex).not.toBeNull();
    expect(afterKIndex).not.toBe(afterJIndex);
  });

  test("ArrowDown behaves like j key", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Get initial state
    const initialIndex = await feedPage.getCurrentIndex();

    // Press ArrowDown and wait for selection to change
    await feedPage.pressKey("ArrowDown");
    let afterIndex = await feedPage.waitForIndexChange(initialIndex, 5000);

    // If first ArrowDown didn't change, try again
    if (afterIndex === initialIndex) {
      await feedPage.pressKey("ArrowDown");
      afterIndex = await feedPage.waitForIndexChange(initialIndex, 5000);
    }

    expect(afterIndex).not.toBeNull();
    // ArrowDown should change selection (may go up or down depending on feedSortReverse)
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
