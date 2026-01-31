import { expect, Page } from "@playwright/test";

/**
 * ShortcutsPage - Page object for Shortcuts overlay
 *
 * Handles keyboard shortcuts overlay visibility and interactions.
 */
export class ShortcutsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Check if the shortcuts overlay is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.page.locator(".shortcut-overlay").isVisible();
  }

  /**
   * Wait for the shortcuts overlay to be visible
   */
  async waitForVisible(): Promise<void> {
    await expect(this.page.locator(".shortcut-overlay")).toBeVisible();
  }

  /**
   * Wait for the shortcuts overlay to be hidden
   */
  async waitForHidden(): Promise<void> {
    await expect(this.page.locator(".shortcut-overlay")).not.toBeVisible();
  }

  /**
   * Open/toggle the shortcuts overlay with ? key
   */
  async open(): Promise<void> {
    // Use Playwright's native keyboard for more reliable event handling
    await this.page.keyboard.press("Shift+Slash");
  }

  /**
   * Close the shortcuts overlay with Escape key
   */
  async close(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }
}
