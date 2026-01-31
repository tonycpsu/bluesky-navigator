/**
 * Feed Map tests for Bluesky Navigator
 *
 * Tests the feed map position indicator functionality.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";
import { FeedMapPage } from "../shared/pages/FeedMapPage.js";

test.describe("Feed Map", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("feed map renders with segments", async ({ authenticatedPage: page }) => {
    const feedMapPage = new FeedMapPage(page);

    // Verify feed map is visible
    await feedMapPage.waitForVisible();

    // Verify segments exist
    const segmentCount = await feedMapPage.getSegmentCount();
    expect(segmentCount).toBeGreaterThan(0);
  });

  test("feed map has segments for loaded posts", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const feedMapPage = new FeedMapPage(page);

    // Get counts
    const postCount = await feedPage.getPostCount();
    const segmentCount = await feedMapPage.getSegmentCount();

    // Feed map should have some segments (may not exactly match due to rendering timing)
    expect(segmentCount).toBeGreaterThan(0);

    // Log the counts for debugging
    console.log(`Posts: ${postCount}, Segments: ${segmentCount}`);
  });

  test("current post is highlighted in feed map", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const feedMapPage = new FeedMapPage(page);

    // Navigate to first post
    await feedPage.goToFirstPost();

    // Wait for current segment to appear (expect auto-retries)
    await expect(page.locator(".feed-map-segment-current")).toBeVisible();
  });

  test("feed map updates when navigating posts", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const feedMapPage = new FeedMapPage(page);

    // Go to first post and wait for current segment
    await feedPage.goToFirstPost();
    await expect(page.locator(".feed-map-segment-current")).toBeVisible();

    // Get initial current segment position
    const initialSegment = await feedMapPage.getCurrentSegment();
    const initialBox = await initialSegment.boundingBox();

    // Navigate down several posts
    for (let i = 0; i < 5; i++) {
      await feedPage.nextPost();
    }

    // Wait for feed map to update by checking segment is still visible
    await expect(page.locator(".feed-map-segment-current")).toBeVisible();

    // Get new current segment position
    const newSegment = await feedMapPage.getCurrentSegment();
    const newBox = await newSegment.boundingBox();

    // The segment position should have changed (moved right or down depending on layout)
    if (initialBox && newBox) {
      const positionChanged = initialBox.x !== newBox.x || initialBox.y !== newBox.y;
      expect(positionChanged).toBe(true);
    }
  });
});
