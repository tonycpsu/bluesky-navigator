/**
 * Config Modal tests for Bluesky Navigator
 *
 * Tests the configuration modal tabs and settings.
 */

import { test, expect } from "../fixtures/index.js";
import { FeedPage } from "../shared/pages/FeedPage.js";

test.describe("Config Modal Tabs", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();

    // Open config modal
    await feedPage.pressKey("Alt+.");
    await expect(authenticatedPage.locator(".config-modal")).toBeVisible();
  });

  test("all main tabs are present", async ({ authenticatedPage: page }) => {
    const modal = page.locator(".config-modal");

    // Check for main tab buttons (auto-retries)
    await expect(modal.getByRole("tab", { name: /Display/i })).toBeVisible();
    await expect(modal.getByRole("tab", { name: /Feed Map/i })).toBeVisible();
    await expect(modal.getByRole("tab", { name: /Appearance/i })).toBeVisible();
    await expect(modal.getByRole("tab", { name: /Rules/i })).toBeVisible();
  });

  test("clicking tab switches content", async ({ authenticatedPage: page }) => {
    const modal = page.locator(".config-modal");

    // Click on Feed Map tab
    const feedMapTab = modal.getByRole("tab", { name: /Feed Map/i });
    await feedMapTab.click();

    // Tab should be selected (auto-retries)
    await expect(feedMapTab).toHaveAttribute("aria-selected", "true");
  });

  test("Rules tab can be clicked", async ({ authenticatedPage: page }) => {
    const modal = page.locator(".config-modal");

    // Click on Rules tab
    const rulesTab = modal.getByRole("tab", { name: /Rules/i });
    await rulesTab.click();

    // Tab should be selected (auto-retries)
    await expect(rulesTab).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Config Modal Interactions", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test("modal can be closed with Escape", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open modal
    await feedPage.pressKey("Alt+.");
    await expect(page.locator(".config-modal")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.locator(".config-modal")).not.toBeVisible();
  });

  test("modal has save button", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);

    // Open modal
    await feedPage.pressKey("Alt+.");
    await expect(page.locator(".config-modal")).toBeVisible();

    // Check for save button (auto-retries)
    const saveButton = page.locator(".config-modal").getByRole("button", { name: /Save/i });
    await expect(saveButton).toBeVisible();
  });
});

test.describe("Config Settings", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();

    // Open config modal
    await feedPage.pressKey("Alt+.");
    await expect(authenticatedPage.locator(".config-modal")).toBeVisible();
  });

  test("settings have labels", async ({ authenticatedPage: page }) => {
    const modal = page.locator(".config-modal");

    // Check that there are labeled form elements (auto-retries)
    const labels = modal.locator("label");
    await expect(labels.first()).toBeVisible();
  });
});
