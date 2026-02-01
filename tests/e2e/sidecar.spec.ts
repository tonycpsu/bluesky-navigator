/**
 * Sidecar tests for Bluesky Navigator
 *
 * Tests the sidecar panel functionality for viewing thread context.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Sidecar Panel", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("semicolon key toggles sidecar without error", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press semicolon to toggle sidecar
    await feedPage.pressKey(";");

    // Verify selection still works after toggle
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });

  test("sidecar toggle is responsive", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Toggle twice to verify key works
    await feedPage.pressKey(";");
    await feedPage.pressKey(";");

    // Verify selection still works
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });

  test("t key toggles thread context without error", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press t to toggle thread context
    await feedPage.pressKey("t");

    // Verify selection still works
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });
});

test.describe("Sidecar Navigation", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("arrow keys work after sidecar toggle", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Toggle sidecar
    await feedPage.pressKey(";");

    // Press right arrow
    await feedPage.pressKey("ArrowRight");

    // Verify selection still exists
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });
});
