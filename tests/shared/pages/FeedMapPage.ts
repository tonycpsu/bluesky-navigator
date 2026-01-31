import { expect, Page } from "@playwright/test";

/**
 * FeedMapPage - Page object for Feed Map interactions
 *
 * Handles feed map visibility, segments, and positioning.
 */
export class FeedMapPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Get the feed map wrapper element
   */
  async getWrapper() {
    return this.page.locator(".feed-map-wrapper");
  }

  /**
   * Check if the feed map is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.page.locator(".feed-map-wrapper").isVisible();
  }

  /**
   * Wait for the feed map to be visible
   */
  async waitForVisible(): Promise<void> {
    await expect(this.page.locator(".feed-map-wrapper")).toBeVisible();
  }

  /**
   * Get all feed map segments
   */
  async getSegments() {
    return this.page.locator(".feed-map-segment");
  }

  /**
   * Get the count of feed map segments
   */
  async getSegmentCount(): Promise<number> {
    return await this.page.locator(".feed-map-segment").count();
  }

  /**
   * Get the currently highlighted segment
   */
  async getCurrentSegment() {
    return this.page.locator(".feed-map-segment-current");
  }

  /**
   * Check if a segment is highlighted as current
   */
  async hasCurrentSegment(): Promise<boolean> {
    return (await this.page.locator(".feed-map-segment-current").count()) > 0;
  }

  /**
   * Click on a segment at a specific position (0-1 range)
   */
  async clickAtPosition(position: number): Promise<void> {
    const indicator = this.page.locator(".feed-map-position-indicator");
    const box = await indicator.boundingBox();

    if (box) {
      const x = box.x + box.width * position;
      const y = box.y + box.height / 2;
      await this.page.mouse.click(x, y);
      await this.page.waitForTimeout(500);
    }
  }
}
