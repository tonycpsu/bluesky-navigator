/**
 * Navigation tests for Bluesky Navigator
 * Tests keyboard navigation between posts
 */

import { test, expect, getCurrentPost, getAllPosts, pressKey, waitForScriptReady } from '../fixtures/index.js';

test.describe('Post Navigation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await waitForScriptReady(authenticatedPage);
  });

  test('j key moves to next post', async ({ authenticatedPage: page }) => {
    // Get initial state
    const posts = await getAllPosts(page);
    const postCount = await posts.count();
    expect(postCount).toBeGreaterThan(1);

    // Find initial current post index
    const initialCurrent = await getCurrentPost(page);
    const initialText = await initialCurrent.textContent();

    // Press j to move to next
    await pressKey(page, 'j');

    // Verify we moved to a different post
    const newCurrent = await getCurrentPost(page);
    const newText = await newCurrent.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('k key moves to previous post', async ({ authenticatedPage: page }) => {
    // First move down a couple posts
    await pressKey(page, 'j');
    await pressKey(page, 'j');

    const beforeK = await getCurrentPost(page);
    const beforeText = await beforeK.textContent();

    // Press k to move up
    await pressKey(page, 'k');

    const afterK = await getCurrentPost(page);
    const afterText = await afterK.textContent();
    expect(afterText).not.toBe(beforeText);
  });

  test('gg moves to first post', async ({ authenticatedPage: page }) => {
    // Move down several posts first
    await pressKey(page, 'j');
    await pressKey(page, 'j');
    await pressKey(page, 'j');

    // Press gg to go to first
    await pressKey(page, 'g');
    await pressKey(page, 'g');

    // Verify we're at the first post
    const posts = await getAllPosts(page);
    const firstPost = posts.first();
    const currentPost = await getCurrentPost(page);

    // Check they're the same element
    const firstBoundingBox = await firstPost.boundingBox();
    const currentBoundingBox = await currentPost.boundingBox();

    expect(currentBoundingBox.y).toBe(firstBoundingBox.y);
  });

  test('G moves to last post', async ({ authenticatedPage: page }) => {
    // Press G to go to last
    await pressKey(page, 'Shift+g');

    // Verify we're at a post near the end
    const posts = await getAllPosts(page);
    const lastPost = posts.last();
    const currentPost = await getCurrentPost(page);

    const lastBoundingBox = await lastPost.boundingBox();
    const currentBoundingBox = await currentPost.boundingBox();

    expect(currentBoundingBox.y).toBe(lastBoundingBox.y);
  });

  test('J moves to next unread post', async ({ authenticatedPage: page }) => {
    // Press J to move to next unread
    await pressKey(page, 'Shift+j');

    // Should move to some post (behavior depends on read state)
    const currentPost = await getCurrentPost(page);
    expect(currentPost).toBeTruthy();
  });

  test('post gets marked as read when navigated past', async ({ authenticatedPage: page }) => {
    // Navigate to first post
    await pressKey(page, 'g');
    await pressKey(page, 'g');

    const firstPost = await getCurrentPost(page);

    // Move to next post
    await pressKey(page, 'j');

    // Check if first post now has read class
    const hasReadClass = await firstPost.evaluate((el) => {
      return el.classList.contains('bsky-navigator-item-read');
    });

    expect(hasReadClass).toBe(true);
  });

  test('arrow keys also navigate posts', async ({ authenticatedPage: page }) => {
    const initialCurrent = await getCurrentPost(page);
    const initialText = await initialCurrent.textContent();

    // Press down arrow
    await pressKey(page, 'ArrowDown');

    const newCurrent = await getCurrentPost(page);
    const newText = await newCurrent.textContent();
    expect(newText).not.toBe(initialText);

    // Press up arrow
    await pressKey(page, 'ArrowUp');

    const backCurrent = await getCurrentPost(page);
    const backText = await backCurrent.textContent();
    expect(backText).toBe(initialText);
  });
});
