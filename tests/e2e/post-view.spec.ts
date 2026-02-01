/**
 * Post View tests for Bluesky Navigator
 *
 * Tests post viewing functionality including modals and opening posts.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Post Opening", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("o key opens the selected post", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Get initial URL
    const initialUrl = page.url();

    // Press o to open post
    await feedPage.pressKey("o");

    // Wait for navigation to post page (auto-retries)
    await page.waitForURL(/\/post\//, { timeout: 10000 });

    expect(page.url()).toContain("/post/");
    expect(page.url()).not.toBe(initialUrl);
  });

  test("Enter key opens the selected post", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Navigate back to home first
    await page.goto("https://bsky.app");
    await feedPage.waitForReady();

    // Press Enter to open post
    await page.keyboard.press("Enter");

    // Wait for navigation to post page (auto-retries)
    await page.waitForURL(/\/post\//, { timeout: 10000 });

    expect(page.url()).toContain("/post/");
  });
});

test.describe("Post View Modal", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("v key opens full-screen post view modal", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press v to open post view modal
    await feedPage.pressKey("v");

    // Wait for modal to appear (auto-retries)
    const modal = page.locator(".post-view-modal, [role='dialog']");
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test("Escape closes post view modal", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open modal
    await feedPage.pressKey("v");
    const modal = page.locator(".post-view-modal, [role='dialog']");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press("Escape");

    // Modal should close (auto-retries)
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("Media Toggle", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("m key toggles media/video without error", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Press m to toggle media
    await feedPage.pressKey("m");

    // Verify selection still works (auto-retries)
    await expect(page.locator(".item-selection-active")).toBeVisible();
  });
});
