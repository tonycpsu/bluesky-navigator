/**
 * UI Elements tests for Bluesky Navigator
 *
 * Tests the visibility and functionality of toolbar, statusbar,
 * and other UI elements created by the userscript.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Toolbar", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("toolbar is visible on feed page", async ({ authenticatedPage: page }) => {
    const toolbar = page.locator("#bsky-navigator-toolbar");
    await expect(toolbar).toBeVisible();
  });

  test("toolbar contains search input", async ({ authenticatedPage: page }) => {
    const searchInput = page.locator("#bsky-navigator-search");
    await expect(searchInput).toBeVisible();
  });

  test("toolbar has preferences icon", async ({ authenticatedPage: page }) => {
    const prefsIcon = page.locator("#preferencesIndicator");
    await expect(prefsIcon).toBeVisible();
  });

  test("clicking preferences icon opens config modal", async ({ authenticatedPage: page }) => {
    const prefsIcon = page.locator("#preferencesIndicator");
    await prefsIcon.click();

    await expect(page.locator(".config-modal")).toBeVisible();
  });
});

test.describe("Status Bar", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("statusbar exists in DOM", async ({ authenticatedPage: page }) => {
    // Statusbar may be hidden or attached depending on config
    const statusbar = page.locator("#bsky-navigator-global-statusbar");
    await expect(statusbar).toBeAttached();
  });

  test("statusbar container is attached", async ({ authenticatedPage: page }) => {
    // The statusbar container should exist (presence verified in DOM)
    const statusbar = page.locator("#bsky-navigator-global-statusbar");
    await expect(statusbar).toBeAttached();
  });
});

test.describe("Post Selection Styling", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("selected post has active selection class", async ({ authenticatedPage: page }) => {
    const selectedPost = page.locator(".item-selection-active");
    await expect(selectedPost).toBeVisible();
  });

  test("selected post has data-bsky-navigator-item-index attribute", async ({ authenticatedPage: page }) => {
    const selectedPost = page.locator(".item-selection-active");
    const index = await selectedPost.getAttribute("data-bsky-navigator-item-index");
    expect(index).not.toBeNull();
  });

  test("posts have item-index data attributes", async ({ authenticatedPage: page }) => {
    const postsWithIndex = page.locator("[data-bsky-navigator-item-index]");
    const count = await postsWithIndex.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Indicators", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("toolbar is visible and functional", async ({ authenticatedPage: page }) => {
    // Toolbar should be visible
    const toolbar = page.locator("#bsky-navigator-toolbar");
    await expect(toolbar).toBeVisible();

    // Toolbar should contain the search input (required element)
    const searchInput = toolbar.locator("#bsky-navigator-search");
    await expect(searchInput).toBeVisible();
  });
});
