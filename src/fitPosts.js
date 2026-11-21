// Fit posts to screen: measures the part of the viewport not covered by the
// toolbar, tab bar, status bar or Bluesky's mobile bottom bar and publishes it
// as --bsky-nav-fit-height. All capping is CSS under body.bsky-nav-fit-posts.
import { LAYOUT_CHANGED_EVENT } from './components/LeftSidebar.js';

export const FIT_HEIGHT_VAR = '--bsky-nav-fit-height';
export const FIT_BODY_CLASS = 'bsky-nav-fit-posts';
export const FIT_CAPTURE_CLASS = 'bsky-nav-fit-capture';

const TOOLBAR_SELECTOR = '#bsky-navigator-toolbar, #bsky-navigator-global-toolbar';
// On a profile, profilePager wraps the header, tabs and the whole feed, so only its
// sticky [role="tablist"] strip counts as a bar.
const TAB_BAR_SELECTOR =
  'div[data-testid="profilePager"] [role="tablist"], div[data-testid="homeScreenFeedTabs"]';
// Below this the cap would make posts unreadable; leave them uncapped instead
const MIN_FIT_HEIGHT = 150;
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
  if (px < MIN_FIT_HEIGHT) {
    // No variable: every max-height that uses it is invalid at computed time, i.e. none
    document.documentElement.style.removeProperty(FIT_HEIGHT_VAR);
  } else {
    document.documentElement.style.setProperty(FIT_HEIGHT_VAR, `${px}px`);
  }
}

let watcher = null;

function startWatcher() {
  if (watcher) return;
  let frame = 0;
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
    });
  }
  // Cheap: just schedules one frame; the work above is a few querySelectorAll calls per frame
  const mutations = new window.MutationObserver(schedule);
  mutations.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  document.addEventListener(LAYOUT_CHANGED_EVENT, schedule);
  observe();
  watcher = {
    stop() {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener(LAYOUT_CHANGED_EVENT, schedule);
    },
  };
}

export function setFitPostsEnabled(enabled) {
  if (enabled) {
    document.body.classList.add(FIT_BODY_CLASS);
    applyMeasurement();
    startWatcher();
  } else {
    document.body.classList.remove(FIT_BODY_CLASS);
    document.documentElement.style.removeProperty(FIT_HEIGHT_VAR);
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
  }
}
