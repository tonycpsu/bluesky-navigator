/**
 * Feed Map tests for Bluesky Navigator
 * Tests the visual feed overview component
 */

import { test, expect, getAllPosts, getFeedMapSegments, pressKey, waitForScriptReady } from '../fixtures/index.js';

test.describe('Feed Map', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await waitForScriptReady(authenticatedPage);
  });

  test('feed map renders with segments', async ({ authenticatedPage: page }) => {
    // Check feed map exists
    const feedMap = page.locator('.feed-map');
    await expect(feedMap).toBeVisible();

    // Check segments exist
    const segments = await getFeedMapSegments(page);
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThan(0);
  });

  test('feed map segment count matches post count', async ({ authenticatedPage: page }) => {
    const posts = await getAllPosts(page);
    const postCount = await posts.count();

    const segments = await getFeedMapSegments(page);
    const segmentCount = await segments.count();

    // Segments should match or exceed post count (may include empty slots)
    expect(segmentCount).toBeGreaterThanOrEqual(postCount);
  });

  test('current post is highlighted in feed map', async ({ authenticatedPage: page }) => {
    // Look for highlighted segment
    const currentSegment = page.locator('.feed-map-segment-current');
    await expect(currentSegment).toBeVisible();
  });

  test('clicking segment navigates to that post', async ({ authenticatedPage: page }) => {
    // Get segments
    const segments = await getFeedMapSegments(page);
    const segmentCount = await segments.count();

    if (segmentCount > 3) {
      // Click on segment index 3
      const targetSegment = segments.nth(3);
      await targetSegment.click();

      // Wait for navigation
      await page.waitForTimeout(500);

      // Verify this segment is now current
      const hasCurrentClass = await targetSegment.evaluate((el) => {
        return el.classList.contains('feed-map-segment-current');
      });

      expect(hasCurrentClass).toBe(true);
    }
  });

  test('feed map updates when navigating posts', async ({ authenticatedPage: page }) => {
    // Get initial highlighted segment index
    const getHighlightedIndex = async () => {
      const segments = await getFeedMapSegments(page);
      const count = await segments.count();
      for (let i = 0; i < count; i++) {
        const segment = segments.nth(i);
        const isCurrent = await segment.evaluate((el) =>
          el.classList.contains('feed-map-segment-current')
        );
        if (isCurrent) return i;
      }
      return -1;
    };

    const initialIndex = await getHighlightedIndex();

    // Navigate down
    await pressKey(page, 'j');
    await page.waitForTimeout(200);

    const newIndex = await getHighlightedIndex();

    // Index should have changed
    expect(newIndex).not.toBe(initialIndex);
  });

  test('feed map shows tooltip on hover', async ({ authenticatedPage: page }) => {
    const segments = await getFeedMapSegments(page);
    const firstSegment = segments.first();

    // Hover over segment
    await firstSegment.hover();

    // Wait for tooltip
    await page.waitForTimeout(300);

    // Check for tooltip
    const tooltip = page.locator('.feed-map-tooltip');
    await expect(tooltip).toBeVisible();
  });

  test('zoom window shows around current position', async ({ authenticatedPage: page }) => {
    // Check if zoom is enabled (it may be a setting)
    const zoomContainer = page.locator('.feed-map-zoom');
    const isVisible = await zoomContainer.isVisible().catch(() => false);

    if (isVisible) {
      // Zoom should have segments
      const zoomSegments = page.locator('.feed-map-zoom .feed-map-segment');
      const count = await zoomSegments.count();
      expect(count).toBeGreaterThan(0);

      // Should have a highlighted segment in zoom too
      const zoomHighlight = page.locator('.feed-map-zoom .feed-map-segment-current');
      await expect(zoomHighlight).toBeVisible();
    }
  });
});
