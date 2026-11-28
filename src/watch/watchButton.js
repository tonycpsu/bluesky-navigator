// The watch bell injected into Bluesky's post action rows, and its click handling.
// ItemHandler decides which posts get a bell; this module owns the DOM.

import { watchService } from './WatchService.js';
import { watchButtonLabel } from './watchCopy.js';

export const WATCH_BUTTON_CLASS = 'bsky-nav-watch-btn';
const WRAP_CLASS = 'bsky-nav-watch-wrap';
const COUNT_CLASS = 'bsky-nav-watch-count';
const ICON_CLASS = 'bsky-nav-watch-icon';
const WATCHED_CLASS = 'bsky-nav-watch-btn-watched';
const NOTICE_MS = 4000;

const BELL_PATH = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9Z';
const CLAPPER_PATH = 'M10.3 21a1.94 1.94 0 0 0 3.4 0';

const OUTLINE_BELL_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  `focusable="false"><path d="${BELL_PATH}"></path><path d="${CLAPPER_PATH}"></path></svg>`;
const FILLED_BELL_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  `focusable="false"><path d="${BELL_PATH}" fill="currentColor"></path>` +
  `<path d="${CLAPPER_PATH}"></path></svg>`;

const notices = new WeakMap();
let clicksInstalled = false;
let currentOnToggle = null;

/**
 * The WatchInfo a bell carries in its data attributes.
 * @param {HTMLElement} button
 * @returns {object} WatchInfo
 */
export function watchInfoFromButton(button) {
  const ds = button.dataset;
  return {
    postId: ds.postId,
    url: ds.postUrl,
    authorDid: ds.authorDid || null,
    authorHandle: ds.authorHandle || null,
    snippet: ds.snippet || '',
  };
}

function setInfo(button, info) {
  button.dataset.postId = info.postId;
  button.dataset.postUrl = info.url;
  button.dataset.authorDid = info.authorDid || '';
  button.dataset.authorHandle = info.authorHandle || '';
  button.dataset.snippet = info.snippet || '';
}

function createButton() {
  const wrap = document.createElement('div');
  wrap.className = WRAP_CLASS;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = WATCH_BUTTON_CLASS;
  button.setAttribute('aria-pressed', 'false');
  const icon = document.createElement('span');
  icon.className = ICON_CLASS;
  icon.innerHTML = OUTLINE_BELL_SVG;
  const count = document.createElement('span');
  count.className = COUNT_CLASS;
  count.hidden = true;
  button.append(icon, count);
  wrap.append(button);
  return { wrap, button };
}

/**
 * Put a bell in an item's Bluesky action row, after the last built-in button, or reuse
 * the one already there. Items without an action row (unrolled sub-posts, sidecar
 * replies) get none.
 * @param {HTMLElement} itemEl
 * @param {object} info WatchInfo
 * @returns {HTMLElement | null} the bell button
 */
export function ensureWatchButton(itemEl, info) {
  if (!itemEl || !info) return null;
  const group = actionGroup(itemEl);
  if (!group) return null;
  let button = bellInGroup(group);
  if (!button) {
    const created = createButton();
    group.append(created.wrap);
    button = created.button;
  }
  setInfo(button, info);
  return button;
}

/** The right-hand group of an item's action row (holds the "..." button), if any. */
function actionGroup(itemEl) {
  const dropdown = itemEl.querySelector('button[data-testid="postDropdownBtn"]');
  return dropdown?.parentElement?.parentElement ?? null;
}

function bellInGroup(group) {
  return group.querySelector(`:scope > .${WRAP_CLASS} > .${WATCH_BUTTON_CLASS}`);
}

/**
 * The bell already in an item's action row, if any.
 * @param {HTMLElement} itemEl
 * @returns {HTMLElement | null}
 */
export function findWatchButton(itemEl) {
  const group = itemEl ? actionGroup(itemEl) : null;
  return group ? bellInGroup(group) : null;
}

function refreshOne(button) {
  const postId = button.dataset.postId;
  const watched = watchService.isWatched(postId);
  const unseen = watched ? watchService.unseenCountFor(postId) : 0;
  const { title } = watchButtonLabel({ watched, unseen, hasApi: watchService.hasApi() });
  // The screen reader label leaves out the login hint, which the tooltip carries
  const spoken = watchButtonLabel({ watched, unseen, hasApi: true }).title;

  if (button.classList.contains(WATCHED_CLASS) !== watched) {
    button.classList.toggle(WATCHED_CLASS, watched);
    const icon = button.querySelector(`.${ICON_CLASS}`);
    if (icon) icon.innerHTML = watched ? FILLED_BELL_SVG : OUTLINE_BELL_SVG;
  }
  button.setAttribute('aria-pressed', String(watched));
  button.setAttribute('aria-label', spoken);
  button.title = notices.get(button)?.message ?? title;

  const count = button.querySelector(`.${COUNT_CLASS}`);
  if (count) {
    count.textContent = unseen > 99 ? '99+' : unseen > 0 ? String(unseen) : '';
    count.hidden = unseen === 0;
  }
}

function bellsIn(root) {
  const bells = [...root.querySelectorAll(`.${WATCH_BUTTON_CLASS}`)];
  if (root.classList?.contains(WATCH_BUTTON_CLASS)) bells.push(root);
  return bells;
}

/**
 * Bring every bell under `root` up to date with the watch service: icon, pressed state,
 * label, tooltip and unseen count. Copies of a bell (e.g. in the post view modal) are
 * matched by their post id, so they update too.
 * @param {ParentNode} [root=document]
 */
export function refreshWatchButtons(root = document) {
  for (const button of bellsIn(root)) refreshOne(button);
}

/**
 * Remove every bell under `root` (used when watching is turned off).
 * @param {ParentNode} [root=document]
 */
export function removeWatchButtons(root = document) {
  for (const wrap of root.querySelectorAll(`.${WRAP_CLASS}`)) wrap.remove();
}

/**
 * Show a message in a bell's tooltip for a few seconds (e.g. the watch limit).
 * @param {HTMLElement} button
 * @param {string} message
 */
export function showWatchButtonNotice(button, message) {
  const previous = notices.get(button);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    notices.delete(button);
    refreshOne(button);
  }, NOTICE_MS);
  notices.set(button, { message, timer });
  refreshOne(button);
}

function onBellEvent(event) {
  const button = bellFromTarget(event.target);
  if (!button) return;
  // Consume the whole press so Bluesky's row handlers never open the post, and ours never
  // mark it read or move the selection
  event.preventDefault();
  event.stopPropagation();
  if (event.type === 'click' && currentOnToggle) {
    currentOnToggle(watchInfoFromButton(button), button);
  }
}

function bellFromTarget(target) {
  return typeof target?.closest === 'function' ? target.closest(`.${WATCH_BUTTON_CLASS}`) : null;
}

// Enter or Space on a focused bell: keep the key from the shortcut handlers (Enter would
// open the post) but leave its default, so the browser clicks the button natively
function onBellKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (bellFromTarget(event.target)) event.stopPropagation();
}

/**
 * Listen for bell presses in the capture phase, once per page. Later calls only replace
 * the toggle callback (each handler passes its own when it activates).
 * @param {(info: object, button: HTMLElement) => void} onToggle
 */
export function installWatchButtonClicks(onToggle) {
  currentOnToggle = onToggle;
  if (clicksInstalled) return;
  clicksInstalled = true;
  for (const type of ['pointerdown', 'mousedown', 'click']) {
    document.addEventListener(type, onBellEvent, true);
  }
  // On window so it runs before the handlers' document-level capture keydown listener
  window.addEventListener('keydown', onBellKeydown, true);
}
