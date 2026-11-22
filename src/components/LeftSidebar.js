// LeftSidebar.js - Collapsible / auto-hide behavior for Bluesky's desktop left nav column

import constants from '../constants.js';
import { announceToScreenReader, waitForElement } from '../utils.js';

export const LEFT_SIDEBAR_MODES = {
  FIXED: 'Fixed',
  COLLAPSIBLE: 'Collapsible',
  AUTO_HIDE: 'Auto-hide',
};

/**
 * Dispatch this on document whenever something else changes the center column's
 * natural geometry (e.g. the post width +/- buttons) so the sidebar layout is re-measured.
 */
export const LAYOUT_CHANGED_EVENT = 'bsky-nav:layout-changed';

/** Dispatch this on document to toggle the sidebar (used by the Alt+B shortcut). */
export const TOGGLE_LEFT_SIDEBAR_EVENT = 'bsky-nav:toggle-left-sidebar';

const CLASS = {
  collapsed: 'bsky-nav-left-nav-collapsed', // Collapsible mode, nav collapsed
  autoHide: 'bsky-nav-left-nav-autohide', // Auto-hide mode, nav is an off-screen overlay
  revealed: 'bsky-nav-left-nav-revealed', // Auto-hide overlay currently slid out
  reclaim: 'bsky-nav-left-nav-reclaim', // Center column widened into the nav's space
  // Global status bar follows the column (only when a custom post width constrains it)
  reclaimGlobal: 'bsky-nav-left-nav-reclaim-global',
  // Bluesky's column border lines follow the column
  reclaimBorders: 'bsky-nav-left-nav-reclaim-borders',
  measuring: 'bsky-nav-left-nav-measuring', // Transitions disabled while measuring
};
const LAYOUT_CLASSES = [
  CLASS.collapsed,
  CLASS.autoHide,
  CLASS.revealed,
  CLASS.reclaim,
  CLASS.reclaimGlobal,
  CLASS.reclaimBorders,
];

const CSS_VARS = {
  contentMargin: '--bsky-nav-ln-content-margin',
  contentWidth: '--bsky-nav-ln-content-width',
  navWidth: '--bsky-nav-ln-nav-width',
  background: '--bsky-nav-ln-bg',
};

const TOGGLE_ID = 'bsky-nav-left-nav-toggle';
const EDGE_ID = 'bsky-nav-left-nav-edge';
const MOBILE_QUERY = '(max-width: 800px)';
// Minimum left offset of the widened content, so it stays clear of the toggle
// button and the floating prev/next buttons that sit at the left edge.
const CONTENT_GUTTER = 44;
const HIDE_DELAY = 300;
// Bluesky renders nav popovers (e.g. the account switcher) in portals outside the nav
// Full-height element drawing the center column's left/right borders
const COLUMN_BORDERS_SELECTOR =
  'main[role="main"] div[style*="inset: 0px 0px 0px 50%"][style*="border-left-width"]';
const OPEN_MENU_SELECTOR = '[role="menu"], [data-radix-popper-content-wrapper]';

const TOGGLE_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M9 4v16"></path>
    <path class="bsky-nav-left-nav-toggle-chevron" d="M16 10l-2 2 2 2"></path>
  </svg>`;

/**
 * Manages the desktop left navigation column according to the `leftSidebarMode` setting:
 * - Fixed: Bluesky's default layout, untouched.
 * - Collapsible: a toggle button hides/shows the nav; the collapsed state is persisted
 *   in config (`leftSidebarCollapsed`).
 * - Auto-hide: the nav is hidden and slides out as an overlay when the mouse reaches
 *   the left edge of the window (or when keyboard focus enters it).
 *
 * When the nav is collapsed or auto-hidden, the center column is widened leftwards
 * into the space the nav occupied: its right edge stays put (so the right sidebar,
 * `hideRightSidebar`, `postWidthDesktop` and `compactLayout` all keep working) and its
 * left edge moves to where the nav started. The geometry is measured from the live
 * layout with our classes temporarily removed, so it adapts to whatever the other
 * layout settings and Bluesky's own breakpoints produce.
 *
 * Mobile (<= 800px) is never affected.
 */
export default class LeftSidebar {
  /**
   * @param {object} config - ConfigWrapper instance
   * @param {object} [options]
   * @param {Function} [options.onLayoutChange] - Called after the content area changes
   *   position/width, so dependents (fixed sidecar, feed map...) can re-measure
   */
  constructor(config, { onLayoutChange } = {}) {
    this.config = config;
    this.onLayoutChange = onLayoutChange || null;
    this.nav = null;
    this.toggleButton = null;
    this.edgeZone = null;
    this.hideTimer = null;
    this.applyFrame = null;
    this.lastLayoutKey = null;
    this.revealedByFocus = false;

    this.scheduleApply = this.scheduleApply.bind(this);
    this.onKeyDownCapture = this.onKeyDownCapture.bind(this);
    this.onNavMouseEnter = this.onNavMouseEnter.bind(this);
    this.onNavMouseLeave = this.onNavMouseLeave.bind(this);
    this.onNavFocusIn = this.onNavFocusIn.bind(this);
    this.onNavFocusOut = this.onNavFocusOut.bind(this);

    window.addEventListener('resize', this.scheduleApply);
    document.addEventListener(LAYOUT_CHANGED_EVENT, this.scheduleApply);
    document.addEventListener(TOGGLE_LEFT_SIDEBAR_EVENT, () => this.toggle());
    // Window capture runs before the document-level shortcut handlers
    window.addEventListener('keydown', this.onKeyDownCapture, true);

    // Re-apply whenever Bluesky (re)mounts the nav or a center column
    this.observer = waitForElement(
      `${constants.LEFT_NAV_COLUMN_SELECTOR}, ${constants.CENTER_COLUMN_SELECTOR}`,
      this.scheduleApply
    );

    this.apply();
  }

  getMode() {
    const mode = this.config.get('leftSidebarMode');
    return Object.values(LEFT_SIDEBAR_MODES).includes(mode) ? mode : LEFT_SIDEBAR_MODES.FIXED;
  }

  isCollapsed() {
    return this.config.get('leftSidebarCollapsed') === true;
  }

  /**
   * Coalesce re-application into the next animation frame
   */
  scheduleApply() {
    if (this.applyFrame) return;
    this.applyFrame = requestAnimationFrame(() => {
      this.applyFrame = null;
      this.apply();
    });
  }

  /**
   * Apply the current mode/state to the page. Safe to call repeatedly.
   */
  apply() {
    const body = document.body;
    if (!body) return;

    const mode = this.getMode();
    const nav = document.querySelector(constants.LEFT_NAV_COLUMN_SELECTOR);
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;

    if (mode === LEFT_SIDEBAR_MODES.FIXED || isMobile || !nav) {
      this.teardown();
      return;
    }

    if (nav !== this.nav) this.bindNav(nav);

    const autoHide = mode === LEFT_SIDEBAR_MODES.AUTO_HIDE;
    const collapsed = mode === LEFT_SIDEBAR_MODES.COLLAPSIBLE && this.isCollapsed();
    const geometry = collapsed || autoHide ? this.measure(nav) : null;

    const rootStyle = document.documentElement.style;
    if (geometry) {
      rootStyle.setProperty(CSS_VARS.navWidth, `${geometry.navWidth}px`);
      if (geometry.reclaim > 0) {
        rootStyle.setProperty(CSS_VARS.contentMargin, `${geometry.contentMargin}px`);
        rootStyle.setProperty(CSS_VARS.contentWidth, `${geometry.contentWidth}px`);
      }
    }
    const reclaim = !!geometry && geometry.reclaim > 0;
    body.classList.toggle(CLASS.reclaim, reclaim);
    body.classList.toggle(CLASS.reclaimGlobal, reclaim && geometry.reclaimGlobal);
    body.classList.toggle(CLASS.reclaimBorders, reclaim && geometry.reclaimBorders);
    body.classList.toggle(CLASS.collapsed, collapsed);
    body.classList.toggle(CLASS.autoHide, autoHide);
    if (!autoHide) {
      body.classList.remove(CLASS.revealed);
      this.clearHideTimer();
    }

    this.updateToggleButton(mode === LEFT_SIDEBAR_MODES.COLLAPSIBLE, collapsed);
    this.updateEdgeZone(autoHide);
    this.notifyIfChanged([mode, collapsed, geometry]);
  }

  /**
   * Restore Bluesky's default layout and remove our controls
   */
  teardown() {
    const body = document.body;
    if (body) body.classList.remove(...LAYOUT_CLASSES);
    const rootStyle = document.documentElement.style;
    Object.values(CSS_VARS).forEach((name) => rootStyle.removeProperty(name));
    this.clearHideTimer();
    this.updateToggleButton(false);
    this.updateEdgeZone(false);
    this.bindNav(null);
    this.notifyIfChanged(null);
  }

  /**
   * Measure the nav and center column as Bluesky (plus the other layout settings) lays
   * them out, i.e. with our classes removed. Everything happens synchronously within one
   * task, so nothing is painted in between, and transitions are disabled so the class
   * round-trip doesn't animate.
   * @returns {{navWidth:number, reclaim:number, reclaimGlobal?:boolean,
   *   reclaimBorders?:boolean, contentMargin?:number,
   *   contentWidth?:number}|null}
   */
  measure(nav) {
    const body = document.body;
    const active = LAYOUT_CLASSES.filter((cls) => body.classList.contains(cls));
    body.classList.add(CLASS.measuring);
    body.classList.remove(...active);
    try {
      const navRect = nav.getBoundingClientRect();
      if (navRect.width === 0) return null;
      const result = { navWidth: Math.round(navRect.width), reclaim: 0 };
      // The Messages screen has no single center column to widen
      if (constants.MESSAGES_PATH_REGEX.test(window.location.pathname)) return result;

      const column = Array.from(document.querySelectorAll(constants.CENTER_COLUMN_SELECTOR)).find(
        (el) => el.getBoundingClientRect().width > 0
      );
      if (!column || !column.parentElement) return result;
      const colRect = column.getBoundingClientRect();
      const parentRect = column.parentElement.getBoundingClientRect();

      // Only reclaim space when the nav actually sits to the left of the content
      if (navRect.left >= colRect.left) return result;
      const targetLeft = Math.max(CONTENT_GUTTER, navRect.left);
      const reclaim = Math.max(0, Math.round(colRect.left - targetLeft));
      if (reclaim === 0) return result;

      // The global status bar is full width unless the post width settings constrain it
      // to the column, in which case it should keep following the column
      const globalBar = document.getElementById('bsky-navigator-global-statusbar');
      const reclaimGlobal = !!globalBar && window.getComputedStyle(globalBar).maxWidth !== 'none';

      // Move the column borders only if they're aligned with the column (they aren't
      // with some custom post widths) and share its full-width coordinate space
      const borders = Array.from(document.querySelectorAll(COLUMN_BORDERS_SELECTOR)).find(
        (el) => el.getBoundingClientRect().width > 0
      );
      const bordersRect = borders?.getBoundingClientRect();
      const reclaimBorders =
        !!bordersRect &&
        Math.round(parentRect.left) === 0 &&
        Math.abs(bordersRect.left - (colRect.left - 1)) <= 2 &&
        Math.abs(bordersRect.width - (colRect.width + 2)) <= 2;

      return {
        ...result,
        reclaim,
        reclaimGlobal,
        reclaimBorders,
        contentMargin: Math.round(colRect.left - reclaim - parentRect.left),
        contentWidth: Math.round(colRect.width + reclaim),
      };
    } finally {
      body.classList.add(...active);
      // Flush styles while transitions are still disabled
      void window.getComputedStyle(nav).left;
      body.classList.remove(CLASS.measuring);
    }
  }

  notifyIfChanged(layout) {
    const key = JSON.stringify(layout);
    if (key === this.lastLayoutKey) return;
    const isFirst = this.lastLayoutKey === null && layout === null;
    this.lastLayoutKey = key;
    if (isFirst || !this.onLayoutChange) return;
    // Let the new styles take effect before dependents measure
    requestAnimationFrame(() => this.onLayoutChange());
  }

  /**
   * Toggle the collapsed state (Collapsible mode only). Persisted in config.
   */
  toggle() {
    if (this.getMode() !== LEFT_SIDEBAR_MODES.COLLAPSIBLE) {
      announceToScreenReader('Set Left sidebar to Collapsible in settings to toggle it');
      return;
    }
    const collapsed = !this.isCollapsed();
    this.config.set('leftSidebarCollapsed', collapsed); // set() also saves
    this.apply();
    announceToScreenReader(
      collapsed ? 'Navigation sidebar collapsed' : 'Navigation sidebar expanded'
    );
  }

  updateToggleButton(show, collapsed = false) {
    if (!show) {
      if (this.toggleButton) {
        this.toggleButton.remove();
        this.toggleButton = null;
      }
      return;
    }

    if (!this.toggleButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = TOGGLE_ID;
      button.className = 'bsky-nav-left-nav-toggle';
      button.innerHTML = TOGGLE_ICON;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggle();
      });
      document.body.appendChild(button);
      this.toggleButton = button;
    }

    const label = collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar';
    this.toggleButton.setAttribute('aria-label', label);
    this.toggleButton.setAttribute('aria-expanded', String(!collapsed));
    this.toggleButton.title = label;
    this.toggleButton.classList.toggle('collapsed', collapsed);
  }

  /**
   * Keep Enter/Space on the toggle button away from the shortcut handlers (which
   * listen on document in the capture phase), so the button's native activation runs.
   */
  onKeyDownCapture(event) {
    if (
      this.toggleButton &&
      event.target === this.toggleButton &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.stopImmediatePropagation();
    }
  }

  updateEdgeZone(show) {
    if (!show) {
      if (this.edgeZone) {
        this.edgeZone.remove();
        this.edgeZone = null;
      }
      return;
    }
    if (this.edgeZone) return;

    const zone = document.createElement('div');
    zone.id = EDGE_ID;
    zone.className = 'bsky-nav-left-nav-edge';
    zone.setAttribute('aria-hidden', 'true');
    zone.addEventListener('mouseenter', () => {
      this.revealedByFocus = false;
      this.reveal();
    });
    zone.addEventListener('mouseleave', () => this.scheduleHide());
    document.body.appendChild(zone);
    this.edgeZone = zone;
  }

  bindNav(nav) {
    if (this.nav) {
      this.nav.removeEventListener('mouseenter', this.onNavMouseEnter);
      this.nav.removeEventListener('mouseleave', this.onNavMouseLeave);
      this.nav.removeEventListener('focusin', this.onNavFocusIn);
      this.nav.removeEventListener('focusout', this.onNavFocusOut);
    }
    this.nav = nav;
    if (nav) {
      nav.addEventListener('mouseenter', this.onNavMouseEnter);
      nav.addEventListener('mouseleave', this.onNavMouseLeave);
      nav.addEventListener('focusin', this.onNavFocusIn);
      nav.addEventListener('focusout', this.onNavFocusOut);
    }
  }

  isAutoHideActive() {
    return document.body.classList.contains(CLASS.autoHide);
  }

  onNavMouseEnter() {
    if (!this.isAutoHideActive()) return;
    this.revealedByFocus = false;
    this.clearHideTimer();
  }

  onNavMouseLeave() {
    if (!this.isAutoHideActive()) return;
    this.scheduleHide();
  }

  onNavFocusIn() {
    if (!this.isAutoHideActive()) return;
    if (!document.body.classList.contains(CLASS.revealed)) {
      // Revealed by keyboard (Tab) rather than the mouse
      this.revealedByFocus = !this.nav?.matches(':hover');
    }
    this.reveal();
  }

  onNavFocusOut(event) {
    if (!this.isAutoHideActive()) return;
    if (this.nav && event.relatedTarget && this.nav.contains(event.relatedTarget)) return;
    this.revealedByFocus = false;
    this.scheduleHide();
  }

  /**
   * Slide the auto-hidden nav out as an overlay
   */
  reveal() {
    if (!this.isAutoHideActive() || !this.nav) return;
    this.clearHideTimer();
    // Match Bluesky's current theme background (it isn't tied to prefers-color-scheme)
    const background = this.getShellBackground(this.nav);
    if (background) {
      document.documentElement.style.setProperty(CSS_VARS.background, background);
    }
    document.body.classList.add(CLASS.revealed);
  }

  scheduleHide() {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      const nav = this.nav;
      if (!nav || !this.isAutoHideActive()) return;
      if (nav.matches(':hover') || this.edgeZone?.matches(':hover')) return;
      if (this.revealedByFocus && nav.contains(document.activeElement)) return;
      // Keep the nav open while one of its popover menus is showing
      if (document.querySelector(OPEN_MENU_SELECTOR)) {
        this.scheduleHide();
        return;
      }
      document.body.classList.remove(CLASS.revealed);
    }, HIDE_DELAY);
  }

  clearHideTimer() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /**
   * Find the first opaque background behind the nav (Bluesky's themed shell)
   */
  getShellBackground(nav) {
    for (let el = nav.parentElement; el; el = el.parentElement) {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
    }
    return '';
  }
}
