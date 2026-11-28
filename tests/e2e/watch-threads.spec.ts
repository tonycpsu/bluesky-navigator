/**
 * Watch threads tests for Bluesky Navigator
 *
 * Tests the watch bell in the post action row, the w key and the shortcut overlay entries.
 * Each test unwatches whatever it watched.
 */

import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/index.js';
import { FeedPage } from '../shared/pages/FeedPage.js';
import { ShortcutsPage } from '../shared/pages/ShortcutsPage.js';

const BELL = '.bsky-nav-watch-btn';

/** The selected item's index, read without scrolling (unlike FeedPage.getCurrentIndex). */
async function selectionIndex(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document
        .querySelector('.item-selection-active')
        ?.getAttribute('data-bsky-navigator-item-index') ?? null
  );
}

/**
 * A feed item other than the selected one that is unread and has a bell. If every such
 * item is read, select the next one with ArrowDown (which doesn't mark read), toggle it
 * unread with `.`, and go back with ArrowUp.
 */
async function nonSelectedUnreadItem(page: Page, feedPage: FeedPage): Promise<Locator> {
  const candidates = page.locator(`.item:not(.item-selection-active):has(${BELL})`);
  const unread = candidates.and(page.locator('.item-unread')).first();
  if (await unread.count()) return unread;

  const start = await selectionIndex(page);
  let moved = start;
  for (let i = 0; i < 10 && moved === start; i++) {
    await feedPage.pressKey('ArrowDown');
    moved = await selectionIndex(page);
  }
  expect(moved).not.toBe(start);
  const item = page.locator(`.item[data-bsky-navigator-item-index="${moved}"]`);
  if (await item.evaluate((el) => el.classList.contains('item-read'))) {
    await feedPage.pressKey('.');
    await expect(item).toHaveClass(/item-unread/);
  }
  for (let i = 0; i < 10 && (await selectionIndex(page)) !== start; i++) {
    await feedPage.pressKey('ArrowUp');
  }
  expect(await selectionIndex(page)).toBe(start);
  await expect(item).toHaveClass(/item-unread/);
  return item;
}

test.describe('Watch Threads', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test('bell appears in the action row', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const currentPost = await feedPage.getCurrentPost();

    const bell = currentPost.locator(BELL);
    await expect(bell).toHaveCount(1);
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute('aria-pressed', 'false');

    // The bell sits in the same row as Bluesky's own action buttons
    const sharesRow = await bell.evaluate((el) => {
      const row = el.closest('div')?.parentElement?.parentElement;
      return Boolean(row?.querySelector('button[data-testid="likeBtn"]'));
    });
    expect(sharesRow).toBe(true);
  });

  test('clicking the bell does not navigate', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const target = await nonSelectedUnreadItem(page, feedPage);
    const bell = target.locator(BELL);
    await bell.scrollIntoViewIfNeeded();
    // Hovering an item can select it; take the "before" state once the pointer is there
    await bell.hover();
    await page.waitForTimeout(500);

    const urlBefore = page.url();
    const indexBefore = await selectionIndex(page);
    await expect(target).toHaveClass(/item-unread/);

    await bell.click();

    await expect(bell).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).toBe(urlBefore);
    expect(await selectionIndex(page)).toBe(indexBefore);
    await expect(target).toHaveClass(/item-unread/);
    await expect(target).not.toHaveClass(/item-read/);

    // Clean up
    await bell.click();
    await expect(bell).toHaveAttribute('aria-pressed', 'false');
    expect(page.url()).toBe(urlBefore);
  });

  test('w toggles watch on the selected post', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    const currentPost = await feedPage.getCurrentPost();
    const bell = currentPost.locator(BELL);
    await expect(bell).toHaveAttribute('aria-pressed', 'false');

    await feedPage.pressKey('w');
    await expect(bell).toHaveAttribute('aria-pressed', 'true');
    await expect(bell).toHaveAttribute('aria-label', /Stop watching/);

    // Clean up
    await feedPage.pressKey('w');
    await expect(bell).toHaveAttribute('aria-pressed', 'false');
    await expect(bell).toHaveAttribute('aria-label', /Watch for new replies/);
  });

  test('shortcut overlay lists w and W', async ({ authenticatedPage: page }) => {
    const shortcutsPage = new ShortcutsPage(page);

    await shortcutsPage.open();
    await shortcutsPage.waitForVisible();

    const overlay = page.locator('.shortcut-overlay');
    await expect(overlay.getByText('Watch/unwatch thread for new replies')).toBeVisible();
    await expect(overlay.getByText('Watched threads', { exact: true })).toBeVisible();
  });

  test('with hide-read on, a watched post with no unseen replies hides like any read post', async ({
    authenticatedPage: page,
  }) => {
    const feedPage = new FeedPage(page);
    const currentPost = await feedPage.getCurrentPost();
    // Tag the post itself: item indexes are reassigned only on visible posts, so
    // after hide-read toggles, another post can end up sharing this one's index
    await page
      .locator('.item-selection-active')
      .evaluate((el) => el.setAttribute('data-test-watch-target', ''));
    const item = page.locator('.item[data-test-watch-target]');
    const bell = currentPost.locator(BELL);

    await feedPage.pressKey('w');
    await expect(bell).toHaveAttribute('aria-pressed', 'true');

    // Make sure it is read (`.` toggles)
    if (await item.evaluate((el) => el.classList.contains('item-unread'))) {
      await feedPage.pressKey('.');
    }
    await expect(item).toHaveClass(/item-read/);

    // Hide-read on: nothing is unseen (a fresh watch has no replies yet), so it hides
    await feedPage.pressKey('"');
    try {
      await expect(item).toBeHidden();
    } finally {
      // Clean up: hide-read off, then unwatch with the bell
      await feedPage.pressKey('"');
    }
    await expect(item).toBeVisible();
    await item.locator(BELL).click();
    await expect(item.locator(BELL)).toHaveAttribute('aria-pressed', 'false');
  });
});

const NOTIF_SCREEN = '[data-testid="notificationsScreen"]';
const WATCHED_TAB = `${NOTIF_SCREEN} .bsky-nav-watched-tab`;
const WATCHED_PANEL = `${NOTIF_SCREEN} .bsky-nav-watched-panel`;
const BLUESKY_TABS = `${NOTIF_SCREEN} [role="tablist"] [role="tab"]:not(.bsky-nav-watched-tab)`;
// Bluesky's list of notifications (one page per tab), hidden while Watched is open
const BLUESKY_LIST = `${NOTIF_SCREEN} [data-testid="notificationsPagerView"]`;
// Bluesky's tabs have no aria-selected; the selected one's label reads "All tab, selected"
const SELECTED_LABEL = /, selected$/;
const ACTIVE_ATTR = 'data-bsky-nav-watched-active';
const EMPTY_MESSAGE =
  'No watched threads. Press w on a post, or click its bell, to watch it for new replies.';

/** Press W from the feed and wait for the Watched tab to open. */
async function openWatchedTab(page: Page, feedPage: FeedPage): Promise<void> {
  await feedPage.pressKey('W');
  await expect(page).toHaveURL(/\/notifications#watched$/, { timeout: 10000 });
  await expect(page.locator(WATCHED_TAB)).toHaveAttribute('aria-selected', 'true');
}

test.describe('Watched tab', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const feedPage = new FeedPage(authenticatedPage);
    await feedPage.waitForReady();
  });

  test('W opens the Watched tab', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await openWatchedTab(page, feedPage);
    await expect(page.locator(WATCHED_TAB)).toHaveText(/Watched/);
    await expect(page.locator(WATCHED_PANEL)).toBeVisible();
    await expect(page.locator(BLUESKY_LIST)).toBeHidden();
    // Bluesky's sliding highlight is hidden so only our pill looks selected
    await expect(page.locator(`${NOTIF_SCREEN} [data-bsky-nav-watched="highlight"]`)).toBeHidden();
  });

  test("selecting another tab restores Bluesky's list", async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await openWatchedTab(page, feedPage);

    const firstTab = page.locator(BLUESKY_TABS).first();
    await firstTab.click();

    await expect(page.locator(WATCHED_TAB)).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator(WATCHED_PANEL)).toBeHidden();
    await expect(page.locator(BLUESKY_LIST)).toBeVisible();
    await expect(page.locator(BLUESKY_TABS).first()).toHaveAttribute('aria-label', SELECTED_LABEL);
    await expect(page.locator(NOTIF_SCREEN)).not.toHaveAttribute(ACTIVE_ATTR);
    // Every mark on Bluesky's nodes is gone
    await expect(page.locator(`${NOTIF_SCREEN} [data-bsky-nav-watched]`)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('Watched tab is re-inserted after the tab bar re-renders', async ({
    authenticatedPage: page,
  }) => {
    const feedPage = new FeedPage(page);
    await openWatchedTab(page, feedPage);

    // Switch Bluesky's tabs twice, then make React drop our nodes the way a re-render would
    await page.locator(BLUESKY_TABS).nth(1).click();
    await expect(page.locator(BLUESKY_TABS).nth(1)).toHaveAttribute('aria-label', SELECTED_LABEL);
    await page.locator(BLUESKY_TABS).first().click();
    await expect(page.locator(BLUESKY_TABS).first()).toHaveAttribute('aria-label', SELECTED_LABEL);
    await page.evaluate(() => {
      document.querySelector('.bsky-nav-watched-tab-wrap')?.remove();
      document.querySelector('.bsky-nav-watched-panel')?.remove();
    });

    await expect(page.locator(WATCHED_TAB)).toHaveCount(1);
    await expect(page.locator(WATCHED_TAB)).toBeVisible();
    await page.locator(WATCHED_TAB).click();
    await expect(page.locator(WATCHED_TAB)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(WATCHED_PANEL)).toBeVisible();
  });

  test('empty state explains how to watch', async ({ authenticatedPage: page }) => {
    const feedPage = new FeedPage(page);
    await openWatchedTab(page, feedPage);

    // Other tests clean up after themselves; clear anything left over on the test account
    const stopButtons = page.locator(`${WATCHED_PANEL} [data-watched-action="unwatch"]`);
    for (let i = 0; i < 60 && (await stopButtons.count()) > 0; i++) {
      await stopButtons.first().click();
    }

    await expect(page.locator(WATCHED_PANEL)).toContainText(EMPTY_MESSAGE);
  });

  test('/notifications#watched opens the tab', async ({ authenticatedPage: page }) => {
    await page.goto('https://bsky.app/notifications#watched');
    await expect(page.locator(WATCHED_TAB)).toHaveAttribute('aria-selected', 'true', {
      timeout: 15000,
    });
    await expect(page.locator(WATCHED_PANEL)).toBeVisible();
    await expect(page.locator(NOTIF_SCREEN)).toHaveAttribute(ACTIVE_ATTR, '');
  });

  test('no watch badge when there are no unseen watched replies', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('https://bsky.app/notifications');
    await expect(page.locator('a[aria-label="Notifications"]').first()).toBeVisible({
      timeout: 15000,
    });
    // Storage can't be seeded from e2e, so a clean test account has nothing unseen
    await expect(page.locator('.bsky-nav-watch-nav-badge:not([hidden])')).toHaveCount(0);
  });
});
