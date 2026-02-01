/**
 * Accessibility tests for Bluesky Navigator
 *
 * Tests screen reader support, keyboard accessibility, and ARIA attributes.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";
import { ShortcutsPage } from "../shared/pages/ShortcutsPage.js";

test.describe("Keyboard Accessibility", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("navigation works with keyboard only", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Navigate with j
    await feedPage.nextPost();

    // Verify post is selected (auto-retries)
    const selectedPost = page.locator(".item-selection-active");
    await expect(selectedPost).toBeVisible();

    // Navigate with k
    await feedPage.previousPost();

    // Verify selection still works (auto-retries)
    await expect(selectedPost).toBeVisible();
  });

  test("modals are keyboard accessible", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open config modal with keyboard
    await feedPage.pressKey("Alt+.");
    await expect(page.locator(".config-modal")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.locator(".config-modal")).not.toBeVisible();

    // Open shortcuts overlay with keyboard
    const shortcutsPage = new ShortcutsPage(page);
    await shortcutsPage.open();
    await expect(page.locator(".shortcut-overlay")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.locator(".shortcut-overlay")).not.toBeVisible();
  });

  test("focus is visible on selected post", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Navigate to ensure selection
    await feedPage.nextPost();

    const selectedPost = page.locator(".item-selection-active");
    await expect(selectedPost).toBeVisible();
  });
});

test.describe("ARIA Attributes", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("shortcuts overlay has dialog role", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    const overlay = page.locator(".shortcut-overlay");
    await expect(overlay).toHaveAttribute("role", "dialog");
  });

  test("shortcuts overlay has aria-modal", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    const overlay = page.locator(".shortcut-overlay");
    await expect(overlay).toHaveAttribute("aria-modal", "true");
  });

  test("config modal has proper structure", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    await feedPage.pressKey("Alt+.");
    await expect(page.locator(".config-modal")).toBeVisible();

    // Check for tab list (auto-retries)
    const tablist = page.locator('.config-modal [role="tablist"]');
    await expect(tablist).toBeVisible();
  });
});

test.describe("Screen Reader Support", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("shortcuts overlay has aria-labelledby", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    const overlay = page.locator(".shortcut-overlay");
    const labelledBy = await overlay.getAttribute("aria-labelledby");

    // Should reference the title element
    expect(labelledBy).toBeTruthy();
  });
});

test.describe("Toast Notifications", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("x key dismisses toast if present", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press x to dismiss any toast
    await feedPage.pressKey("x");

    // Verify feed still works (auto-retries)
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });
});
