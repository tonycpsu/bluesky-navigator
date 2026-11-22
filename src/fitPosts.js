// Fit posts to screen: measures the part of the viewport not covered by the
// toolbar, tab bar, status bar or Bluesky's mobile bottom bar and publishes it
// as --bsky-nav-fit-height. All capping is CSS under body.bsky-nav-fit-posts.
import { LAYOUT_CHANGED_EVENT } from './components/LeftSidebar.js';

export const FIT_HEIGHT_VAR = '--bsky-nav-fit-height';
export const FIT_BODY_CLASS = 'bsky-nav-fit-posts';
export const FIT_CAPTURE_CLASS = 'bsky-nav-fit-capture';
// On a capped post while content remains below its visible part (draws the bottom fade)
const FIT_MORE_CLASS = 'bsky-nav-fit-more';
// Embedded quote posts are .items too; only top-level posts are capped
const FIT_ITEM_SELECTOR = '.item:not(.item .item)';

const TOOLBAR_SELECTOR = '#bsky-navigator-toolbar, #bsky-navigator-global-toolbar';
// On a profile, profilePager wraps the header, tabs and the whole feed, so only its
// sticky [role="tablist"] strip counts as a bar.
const TAB_BAR_SELECTOR =
  'div[data-testid="profilePager"] [role="tablist"], div[data-testid="homeScreenFeedTabs"]';
// Below this the cap would make posts unreadable; leave them uncapped instead
const MIN_FIT_HEIGHT = 150;
// Overflow up to this many px (usually padding) gets no fade and no extra j/k step
export const FIT_SCROLL_SLACK = 4;
// On a post that lost the selection while on screen; its inner scroll goes back to the
// top once it has scrolled out of view
export const FIT_RESET_PENDING_CLASS = 'bsky-nav-fit-reset-pending';
// Longest "more below" fade; shorter when less content remains
const FADE_MAX_HEIGHT = 40;
// Custom properties set on a post with the fade: its height, and Bluesky's hover tint
const FADE_HEIGHT_VAR = '--bsky-nav-fit-fade-height';
const FADE_HOVER_VAR = '--bsky-nav-fit-fade-hover';
// Bluesky's hover tint: an inset overlay in the post that fades to opacity 0.4 on hover.
// The fade paints above it, so it needs the tint's color to end on the hovered background.
const HOVER_OVERLAY_SELECTOR =
  'div[style*="position: absolute"][style*="inset: 0px"][style*="pointer-events: none"][style*="transition-property: opacity"]';

// True while applyMeasurement has taken the body class off for a very short window
let shortWindow = false;
const STATUS_BAR_SELECTOR = '#statusBar';
const MOBILE_MAX_WIDTH = 800;

/**
 * Height of the toolbar at the top (fixed position, not scroll-dependent).
 * Includes any sticky tab bars (profile page, home feed tabs).
 */
export function measureToolbarHeight() {
  let height = 0;

  // Get navigator toolbar height
  const navigatorToolbar = $(TOOLBAR_SELECTOR).filter(':visible').first();
  if (navigatorToolbar.length) {
    height += navigatorToolbar.outerHeight(true) || 0;
  }

  // Get tab bar height (profile page or home feed tabs)
  const tabBar = $(TAB_BAR_SELECTOR).filter(':visible').first();
  if (tabBar.length) {
    height += tabBar.outerHeight(true) || 0;
  }

  // Add space for the focus ring outline (2px) plus a small buffer
  const focusRingSpace = 4;

  // Return at least a minimum height
  return Math.max(height, 60) + focusRingSpace;
}

/**
 * Height of the status bar at the bottom.
 */
export function measureStatusBarHeight() {
  const statusBar = $(STATUS_BAR_SELECTOR);
  if (statusBar.length && statusBar.is(':visible')) {
    return statusBar.outerHeight() || 0;
  }
  return 0;
}

/**
 * Height of Bluesky's fixed bottom tab bar on narrow screens, else 0.
 * Stable selector (live mobile DOM): the fixed `nav[role="navigation"]` that
 * touches the bottom of the viewport. On desktop the same role is the left nav.
 */
export function measureBottomBarHeight() {
  if (window.innerWidth > MOBILE_MAX_WIDTH) return 0;
  for (const nav of document.querySelectorAll('nav[role="navigation"]')) {
    if (window.getComputedStyle(nav).position !== 'fixed') continue;
    const rect = nav.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= window.innerHeight - 1 &&
      rect.top > window.innerHeight / 2
    ) {
      return Math.round(window.innerHeight - rect.top);
    }
  }
  return 0;
}

export function computeFitHeight({ innerHeight, top, bottom }) {
  return Math.max(0, Math.floor(innerHeight - top - bottom));
}

function applyMeasurement() {
  const px = computeFitHeight({
    innerHeight: window.innerHeight,
    top: measureToolbarHeight(),
    bottom: measureStatusBarHeight() + measureBottomBarHeight(),
  });
  // In a very short window drop the body class as well, so everything (posts, media,
  // unrolled threads, j/k) behaves as with the setting off until there is room again
  const usable = px >= MIN_FIT_HEIGHT;
  if (usable === shortWindow) {
    // Only undo what this function did; setFitPostsEnabled owns the class otherwise
    document.body.classList.toggle(FIT_BODY_CLASS, usable);
    shortWindow = !usable;
  }
  if (usable) {
    document.documentElement.style.setProperty(FIT_HEIGHT_VAR, `${px}px`);
  } else {
    document.documentElement.style.removeProperty(FIT_HEIGHT_VAR);
  }
}

/**
 * Toggle the "more below" fade on one post: on while it overflows its cap and is
 * not scrolled to its end.
 */
function updateFitFade(el, readHoverColor = false) {
  const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
  const more = remaining > FIT_SCROLL_SLACK;
  el.classList.toggle(FIT_MORE_CLASS, more);
  if (!more) return;
  el.style.setProperty(FADE_HEIGHT_VAR, `${Math.min(FADE_MAX_HEIGHT, Math.round(remaining))}px`);
  if (readHoverColor || !el.style.getPropertyValue(FADE_HOVER_VAR)) {
    const overlay = [...el.querySelectorAll(HOVER_OVERLAY_SELECTOR)].find(
      (node) => node.closest('.item') === el
    );
    if (overlay) {
      el.style.setProperty(FADE_HOVER_VAR, window.getComputedStyle(overlay).backgroundColor);
    }
  }
}

/**
 * Refresh the fade on the posts within a screen of the viewport. Posts further away
 * keep their last state and are refreshed once a page scroll brings them near.
 */
/**
 * True if any part of the element shows between the bars at the top and the bottom.
 */
export function isInVisibleArea(el) {
  const rect = el.getBoundingClientRect();
  const bottom = window.innerHeight - measureStatusBarHeight() - measureBottomBarHeight();
  return rect.bottom > measureToolbarHeight() && rect.top < bottom;
}

function refreshFades() {
  for (const el of document.querySelectorAll(`.${FIT_RESET_PENDING_CLASS}`)) {
    if (isInVisibleArea(el)) continue;
    el.classList.remove(FIT_RESET_PENDING_CLASS);
    el.scrollTop = 0;
    const unroll = el.querySelector('.bsky-nav-unroll-scroll');
    if (unroll) unroll.scrollTop = 0;
  }
  const lo = -window.innerHeight;
  const hi = 2 * window.innerHeight;
  for (const el of document.querySelectorAll(FIT_ITEM_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < lo || rect.top > hi) continue;
    // Re-read the hover color here (not on every scroll event) so a theme change follows
    updateFitFade(el, true);
  }
}

function clearFades() {
  document
    .querySelectorAll(`.${FIT_RESET_PENDING_CLASS}`)
    .forEach((el) => el.classList.remove(FIT_RESET_PENDING_CLASS));
  document.querySelectorAll(`.${FIT_MORE_CLASS}`).forEach((el) => {
    el.classList.remove(FIT_MORE_CLASS);
    el.style.removeProperty(FADE_HEIGHT_VAR);
    el.style.removeProperty(FADE_HOVER_VAR);
  });
}

let watcher = null;

function startWatcher() {
  if (watcher) return;
  let frame = 0;
  let fadeFrame = 0;
  let observed = [];
  const observer = new window.ResizeObserver(() => schedule());
  // Bars are removed and re-created on in-app navigation, so re-observe whenever the set changes
  const observe = () => {
    const bars = [
      ...document.querySelectorAll(
        `${TOOLBAR_SELECTOR}, ${STATUS_BAR_SELECTOR}, ${TAB_BAR_SELECTOR}`
      ),
    ];
    if (bars.length === observed.length && bars.every((el, i) => el === observed[i])) return;
    observer.disconnect();
    bars.forEach((el) => observer.observe(el));
    observed = bars;
  };
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      observe();
      applyMeasurement();
      refreshFades();
    });
  }
  function scheduleFades() {
    if (fadeFrame || frame) return;
    fadeFrame = requestAnimationFrame(() => {
      fadeFrame = 0;
      refreshFades();
    });
  }
  // Scroll events don't bubble, so listen in the capture phase: a post scrolling
  // inside updates just itself, a page scroll refreshes the posts near the viewport
  const onScroll = (event) => {
    const target = event.target;
    if (target instanceof window.Element) {
      if (target.matches(FIT_ITEM_SELECTOR)) updateFitFade(target);
    } else {
      scheduleFades();
    }
  };
  // Cheap: just schedules one frame; the work above is a few querySelectorAll calls per frame
  const mutations = new window.MutationObserver(schedule);
  mutations.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  document.addEventListener(LAYOUT_CHANGED_EVENT, schedule);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // Images and videos that load late can make a post overflow its cap
  document.addEventListener('load', scheduleFades, true);
  observe();
  watcher = {
    stop() {
      if (frame) window.cancelAnimationFrame(frame);
      if (fadeFrame) window.cancelAnimationFrame(fadeFrame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener(LAYOUT_CHANGED_EVENT, schedule);
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('load', scheduleFades, true);
    },
  };
}

export function setFitPostsEnabled(enabled) {
  shortWindow = false;
  if (enabled) {
    document.body.classList.add(FIT_BODY_CLASS);
    applyMeasurement();
    startWatcher();
    refreshFades();
  } else {
    document.body.classList.remove(FIT_BODY_CLASS);
    document.documentElement.style.removeProperty(FIT_HEIGHT_VAR);
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    clearFades();
  }
}
