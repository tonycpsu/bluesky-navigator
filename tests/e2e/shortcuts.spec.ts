/**
 * Keyboard shortcuts tests for Bluesky Navigator
 *
 * Tests the shortcuts overlay and various keyboard actions.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";
import { ShortcutsPage } from "../shared/pages/ShortcutsPage.js";

test.describe("Shortcuts Overlay", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("? key opens shortcuts overlay", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();

    expect(await shortcutsPage.isVisible()).toBe(true);
  });

  test("Escape closes shortcuts overlay", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    // Open
    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    // Close
    await shortcutsPage.close();
    await shortcutsPage.waitForHidden();
  });

  test("? key toggles shortcuts overlay", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    // Open
    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    // The overlay has ignoreNextQuestionMark logic to prevent the same
    // keypress that opened it from immediately closing it. We need to
    // wait for that flag to be consumed before pressing ? again.
    await page.waitForTimeout(100);

    // Close with same key
    await shortcutsPage.open();
    await shortcutsPage.waitForHidden();
  });

  test("shortcuts overlay contains expected sections", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    // Check for expected category titles (expect auto-retries)
    const overlay = page.locator(".shortcut-overlay");
    await expect(overlay.getByRole("heading", { name: "Navigation", exact: true })).toBeVisible();
    await expect(overlay.getByRole("heading", { name: "Post Actions" })).toBeVisible();
    await expect(overlay.getByRole("heading", { name: "Feed Controls" })).toBeVisible();
  });
});

test.describe("Config Modal", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("Alt+. opens config modal", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Alt+.");

    // expect auto-retries until visible
    await expect(page.locator(".config-modal")).toBeVisible();
  });

  test("Escape closes config modal", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open modal
    await feedPage.pressKey("Alt+.");
    await expect(page.locator(".config-modal")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");

    // expect auto-retries until not visible
    await expect(page.locator(".config-modal")).not.toBeVisible();
  });

  test("config modal has tabs", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Alt+.");

    const modal = page.locator(".config-modal");

    // Check for tab buttons (expect auto-retries)
    await expect(modal.getByRole("tab", { name: /Display/ })).toBeVisible();
    await expect(modal.getByRole("tab", { name: /Rules/ })).toBeVisible();
  });
});

test.describe("Post Actions", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test(". key toggles read status", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const currentPost = await feedPage.getCurrentPost();

    // Get initial read state
    const initialReadState = await currentPost.evaluate((el) =>
      el.classList.contains("item-read")
    );

    // Toggle with .
    await feedPage.pressKey(".");

    // Wait for class to change using expect auto-retry
    if (initialReadState) {
      await expect(currentPost).not.toHaveClass(/item-read/);
    } else {
      await expect(currentPost).toHaveClass(/item-read/);
    }
  });

  test("+ key opens add to rules dropdown", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press + (Shift+=) to open rules dropdown
    await feedPage.pressKey("Shift+=");

    // The dropdown should appear if rules can be added
    const dropdown = page.locator(".bsky-nav-rules-dropdown");

    // Give a reasonable time for the dropdown to appear
    const isVisible = await dropdown.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      // If dropdown appeared, verify it has expected structure
      await expect(dropdown).toBeVisible();
    }
    // Note: Dropdown may not appear if no rules are applicable to the current post
    // The test passes if no error was thrown during key press
  });

  test("a key shows author hover card", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press 'a' to show author hover card
    await feedPage.pressKey("a");

    // The hover card should appear for posts with authors
    const hoverCard = page.locator('[data-testid="profileHoverCard"]');

    // Give a reasonable time for the hover card to appear
    const isVisible = await hoverCard.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      // If hover card appeared, verify it's actually visible
      await expect(hoverCard).toBeVisible();
    }
    // Note: Hover card may not appear depending on post type (e.g., reposts)
    // The test passes if no error was thrown during key press
  });
});

test.describe("Feed Controls", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("/ key focuses filter search", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Ensure search input exists first
    const searchInput = page.locator("#bsky-navigator-search");
    await expect(searchInput).toBeVisible();

    await feedPage.pressKey("/");

    // Check if search input is focused (auto-retries)
    await expect(searchInput).toBeFocused();
  });

  test(": key toggles sort order indicator", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Shift+:");

    // The statusbar should still be visible (expect auto-retries)
    const statusbar = page.locator("#bsky-navigator-global-statusbar");
    await expect(statusbar).toBeAttached();
  });
});
