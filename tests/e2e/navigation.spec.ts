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

    // First move with j a few times
    await feedPage.nextPost();
    await feedPage.nextPost();
    await feedPage.nextPost();
    const afterJIndex = await feedPage.getCurrentIndex();

    // Now move with k
    await feedPage.previousPost();
    await feedPage.previousPost();
    const afterKIndex = await feedPage.getCurrentIndex();

    expect(afterKIndex).not.toBeNull();
    expect(afterKIndex).not.toBe(afterJIndex);
  });

  test("ArrowDown behaves like j key", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    const initialIndex = await feedPage.getCurrentIndex();

    // Press ArrowDown
    await feedPage.pressKey("ArrowDown");
    await feedPage.pressKey("ArrowDown");

    const afterIndex = await feedPage.getCurrentIndex();
    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(initialIndex);
  });

  test("Home and End move to opposite extremes", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press Home
    await feedPage.pressKey("Home");
    await page.waitForTimeout(500);
    const homeIndex = await feedPage.getCurrentIndex();

    // Press End
    await feedPage.pressKey("End");
    await page.waitForTimeout(500);
    const endIndex = await feedPage.getCurrentIndex();

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
    await feedPage.pressKey("Home");
    await page.waitForTimeout(500);
    const startIndex = await feedPage.getCurrentIndex();

    // Press PageDown
    await feedPage.pressKey("PageDown");
    await page.waitForTimeout(500);
    const afterIndex = await feedPage.getCurrentIndex();

    expect(afterIndex).not.toBeNull();
    expect(afterIndex).not.toBe(startIndex);

    // PageDown should move at least 1 post (may move more depending on viewport)
    const distance = Math.abs(afterIndex! - startIndex!);
    expect(distance).toBeGreaterThanOrEqual(1);
  });

  test("PageUp moves posts in opposite direction", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Start at End position (opposite of Home)
    await feedPage.pressKey("End");
    await page.waitForTimeout(500);
    const startIndex = await feedPage.getCurrentIndex();

    // Press PageUp
    await feedPage.pressKey("PageUp");
    await page.waitForTimeout(500);
    const afterIndex = await feedPage.getCurrentIndex();

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

    // Wait for read status to be applied (expect auto-retries)
    await expect(page.locator(".item-read").first()).toBeVisible();
  });
});
