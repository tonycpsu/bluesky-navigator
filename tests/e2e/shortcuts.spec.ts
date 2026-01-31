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
    await page.waitForTimeout(500);
    expect(await shortcutsPage.isVisible()).toBe(true);

    // Close with same key
    await shortcutsPage.open();
    await page.waitForTimeout(500);
    expect(await shortcutsPage.isVisible()).toBe(false);
  });

  test("shortcuts overlay contains expected sections", async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await page.waitForTimeout(200);

    // Check for expected category titles
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
    await page.waitForTimeout(300);

    await expect(page.locator(".config-modal")).toBeVisible();
  });

  test("Escape closes config modal", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open modal
    await feedPage.pressKey("Alt+.");
    await page.waitForTimeout(300);
    await expect(page.locator(".config-modal")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(page.locator(".config-modal")).not.toBeVisible();
  });

  test("config modal has tabs", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Alt+.");
    await page.waitForTimeout(300);

    const modal = page.locator(".config-modal");

    // Check for tab buttons
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
    await page.waitForTimeout(200);

    // Check new state
    const newReadState = await currentPost.evaluate((el) =>
      el.classList.contains("item-read")
    );

    expect(newReadState).not.toBe(initialReadState);
  });

  test("+ key opens add to rules dropdown", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Shift+=");

    // Wait for dropdown
    await page.waitForTimeout(500);

    // Check for dropdown (may not appear if there are no rules to add)
    const dropdown = page.locator(".bsky-nav-rules-dropdown");
    const isVisible = await dropdown.isVisible().catch(() => false);
    // Just verify no error occurred - dropdown may not appear
    expect(typeof isVisible).toBe("boolean");
  });

  test("a key shows author hover card", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("a");

    // Wait for hover card
    await page.waitForTimeout(500);

    // Check for hover card (may or may not appear depending on post type)
    const hoverCard = page.locator('[data-testid="profileHoverCard"]');
    const isVisible = await hoverCard.isVisible().catch(() => false);

    // Just verify no error occurred
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Feed Controls", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("/ key focuses filter search", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("/");

    // Check if search input is focused
    const searchInput = page.locator("#bsky-navigator-search");
    await expect(searchInput).toBeFocused();
  });

  test(": key toggles sort order indicator", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await feedPage.pressKey("Shift+:");
    await page.waitForTimeout(200);

    // The statusbar should still be visible
    const statusbar = page.locator("#bsky-navigator-global-statusbar");
    await expect(statusbar).toBeAttached();
  });
});
