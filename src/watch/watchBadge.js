// Unseen-watched-replies badge on Bluesky's Notifications nav link. It sits in the 24px icon
// wrapper at the bottom-right corner, right under Bluesky's own unread badge (top-right), so
// the two never overlap and ours never reaches the "Notifications" label. Bluesky's badge
// is never touched.

import { waitForElement } from '../utils.js';
import { WATCH_CHANGED_EVENT } from './WatchService.js';
import { navBadgeContent } from './watchCopy.js';

/** The selector `updateNotificationBadge` in main.js also relies on. */
export const NAV_NOTIFICATIONS_SELECTOR = 'a[aria-label="Notifications"]';
export const NAV_BADGE_CLASS = 'bsky-nav-watch-nav-badge';
/**
 * The nav icon inside the link. Its parent is Bluesky's 24px, position: relative icon
 * wrapper, which also holds Bluesky's unread badge (`div[aria-label="3 unread items"]`, in an
 * absolutely positioned box of its own).
 */
export const NAV_ICON_SELECTOR = ':scope > * > svg';

/**
 * The element that holds the icon (and Bluesky's badge), falling back to the link. Null when
 * the fallback isn't positioned, since the badge would then place itself against some
 * unrelated ancestor.
 */
function iconWrapper(link) {
  const wrapper = link.querySelector(NAV_ICON_SELECTOR)?.parentElement;
  if (wrapper) return wrapper;
  return window.getComputedStyle(link).position === 'static' ? null : link;
}

/** Ensure exactly one badge on the link, showing `count`. */
export function renderNavBadge(link, count) {
  const wrapper = iconWrapper(link);
  const badges = link.querySelectorAll(`.${NAV_BADGE_CLASS}`);
  if (!wrapper) {
    for (const badge of badges) badge.remove();
    return;
  }
  let badge = [...badges].find((b) => b.parentElement === wrapper);
  for (const extra of badges) if (extra !== badge) extra.remove();

  const content = navBadgeContent(count);
  if (!badge) {
    if (content.hidden) return;
    badge = document.createElement('span');
    badge.className = NAV_BADGE_CLASS;
    wrapper.appendChild(badge);
  }
  badge.hidden = content.hidden;
  if (badge.textContent !== content.text) badge.textContent = content.text;
  if (badge.getAttribute('aria-label') !== content.label) {
    badge.setAttribute('aria-label', content.label);
  }
}

/**
 * Badge every Notifications link (desktop sidebar and mobile bar) with the unseen total.
 * @param {{unseenTotal: () => number}} service
 * @returns {() => void} stop, which removes every badge
 */
export function startWatchBadge(service) {
  const renderAll = () => {
    const count = service.unseenTotal();
    for (const link of document.querySelectorAll(NAV_NOTIFICATIONS_SELECTOR)) {
      renderNavBadge(link, count);
    }
  };

  // One observer covers new links and our badge being dropped by a React re-render
  const watcher = waitForElement(
    `${NAV_NOTIFICATIONS_SELECTOR}, .${NAV_BADGE_CLASS}`,
    (el) => {
      if (el.matches(NAV_NOTIFICATIONS_SELECTOR)) renderNavBadge(el, service.unseenTotal());
    },
    (el) => {
      if (el.classList.contains(NAV_BADGE_CLASS)) renderAll();
    }
  );
  document.addEventListener(WATCH_CHANGED_EVENT, renderAll);

  return () => {
    watcher.disconnect();
    document.removeEventListener(WATCH_CHANGED_EVENT, renderAll);
    for (const badge of document.querySelectorAll(`.${NAV_BADGE_CLASS}`)) badge.remove();
  };
}
