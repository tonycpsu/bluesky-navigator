/**
 * Navigation tests for Bluesky Navigator
 * Tests keyboard navigation between posts
 */

import { test, expect, getCurrentPost, getAllPosts, waitForScriptReady } from '../fixtures/index.js';

// Helper to get current selection index
async function getCurrentIndex(page) {
  await page.waitForTimeout(300);

  const index = await page.evaluate(() => {
    const elements = document.querySelectorAll('.item-selection-active');
    if (elements.length === 0) return null;
    const current = elements[0];
    current.scrollIntoView({ block: 'center' });
    return current.getAttribute('data-bsky-navigator-item-index');
  });

  if (index === null) {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const elements = document.querySelectorAll('.item-selection-active');
      if (elements.length === 0) return null;
      return elements[0].getAttribute('data-bsky-navigator-item-index');
    });
  }

  return index;
}

test.describe('Post Navigation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await waitForScriptReady(authenticatedPage);
  });

  test('Home key moves to first post', async ({ authenticatedPage: page }) => {
    // First move down with End to ensure we're not at first post
    await page.keyboard.press('End');
    await page.waitForTimeout(500);

    const afterEndIndex = await getCurrentIndex(page);
    expect(parseInt(afterEndIndex, 10)).toBeGreaterThan(0);

    // Press Home to go to first post
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);

    // Verify we're at the first post (index 0)
    const currentIndex = await getCurrentIndex(page);
    expect(currentIndex).toBe('0');
  });

  test('End key moves to last loaded post', async ({ authenticatedPage: page }) => {
    // Start at first post
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);

    const initialIndex = await getCurrentIndex(page);

    // Press End to go to last
    await page.keyboard.press('End');
    await page.waitForTimeout(500);

    // Verify we moved to a higher index
    const endIndex = await getCurrentIndex(page);
    expect(parseInt(endIndex, 10)).toBeGreaterThan(parseInt(initialIndex, 10));

    // Go back to first for next test
    await page.keyboard.press('Home');
  });

  test('PageDown moves down several posts', async ({ authenticatedPage: page }) => {
    // Start at first post
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);

    const initialIndex = await getCurrentIndex(page);

    // Press PageDown
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);

    // Verify we moved down
    const afterIndex = await getCurrentIndex(page);
    expect(parseInt(afterIndex, 10)).toBeGreaterThan(parseInt(initialIndex, 10));

    // Go back to first for next test
    await page.keyboard.press('Home');
  });

  test('PageUp moves up several posts', async ({ authenticatedPage: page }) => {
    // First move to end
    await page.keyboard.press('End');
    await page.waitForTimeout(500);

    const endIndex = await getCurrentIndex(page);
    expect(parseInt(endIndex, 10)).toBeGreaterThan(0);

    // Press PageUp
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(500);

    // Verify we moved up
    const afterIndex = await getCurrentIndex(page);
    expect(parseInt(afterIndex, 10)).toBeLessThan(parseInt(endIndex, 10));

    // Go back to first for next test
    await page.keyboard.press('Home');
  });

  test('ArrowDown moves to next post', async ({ authenticatedPage: page }) => {
    // First go to start with Home to ensure consistent state
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);

    const initialIndex = await getCurrentIndex(page);
    expect(initialIndex).toBe('0');

    // Ensure focus is on page body, not URL bar
    await page.evaluate(() => document.body.focus());
    await page.waitForTimeout(100);

    // Use ArrowDown to move to next post
    let newIndex = initialIndex;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(500);
      newIndex = await getCurrentIndex(page);
      if (parseInt(newIndex, 10) > parseInt(initialIndex, 10)) break;
    }

    // Verify we moved to a higher index
    expect(parseInt(newIndex, 10)).toBeGreaterThan(parseInt(initialIndex, 10));
  });

  test('k key moves to previous post', async ({ authenticatedPage: page }) => {
    // Start at first post
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);

    // Move down several posts using j key
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(300);
    }

    const startIndex = await getCurrentIndex(page);
    expect(parseInt(startIndex, 10)).toBeGreaterThan(0);

    // Ensure focus is on page body
    await page.evaluate(() => document.body.focus());
    await page.waitForTimeout(100);

    // Press k key to move up
    let newIndex = startIndex;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('k');
      await page.waitForTimeout(300);
      newIndex = await getCurrentIndex(page);
      if (parseInt(newIndex, 10) < parseInt(startIndex, 10)) break;
    }

    // Verify we moved to a lower index
    expect(parseInt(newIndex, 10)).toBeLessThan(parseInt(startIndex, 10));
  });

  test('post gets marked as read when navigated past', async ({ authenticatedPage: page }) => {
    // Start at first post using gg (vim-style)
    await page.keyboard.press('g');
    await page.waitForTimeout(50);
    await page.keyboard.press('g');
    await page.waitForTimeout(500);

    // Move down several posts - use 'j' key and try multiple times
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(300);
    }

    // Wait for read status to be applied
    await page.waitForTimeout(1000);

    // Check if any element has the read class
    const hasReadClass = await page.evaluate(() => {
      const elementsWithRead = document.querySelectorAll('.item-read');
      return elementsWithRead.length > 0;
    });

    expect(hasReadClass).toBe(true);
  });
});
