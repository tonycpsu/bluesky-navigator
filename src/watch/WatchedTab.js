// The "Watched" tab on /notifications: a tab next to Bluesky's own notification tabs that
// lists watched threads and their unseen replies. All DOM work lives here; the list markup
// comes from watchedList.js.

import { waitForElement } from '../utils.js';
import { WATCH_CHANGED_EVENT, OPEN_WATCHED_TAB_EVENT } from './WatchService.js';
import { WATCHED_TAB_URL } from './watchCopy.js';
import { buildWatchedEntries, watchedPanelHtml } from './watchedList.js';

/**
 * Every Bluesky selector this file relies on. If Bluesky's markup changes, adjust these
 * (and, at most, `_tabRow` / `_insert` / `_markBluesky`).
 *
 * Bluesky's tab bar is a row of pill tabs. Each `[role="tab"]` sits in its own wrapper div
 * in the row, and its own text is invisible (opacity 0). What you see are absolutely
 * positioned siblings after the wrappers, placed by measured offsets: one border pill per
 * tab, a sliding highlight under the selected tab, and an aria-hidden label overlay per tab.
 * There is no aria-selected; only the (localized) aria-label says which tab is selected, so
 * nothing here depends on which one it is.
 */
export const NOTIF_SELECTORS = {
  /** The notifications screen root. */
  screen: '[data-testid="notificationsScreen"]',
  /** Bluesky's tab bar inside the screen. */
  tablist: '[role="tablist"]',
  /** One of Bluesky's tabs (its parent is the tab's wrapper, whose parent is the tab row). */
  tab: '[role="tab"]',
  /** In the tab row: the sliding selected-tab highlight (not a tab wrapper, label or pill). */
  highlight: ':scope > :not([aria-hidden="true"]):not(:has([role="tab"])):has(> *)',
  /** In the tab row: the visible tab labels, one per tab, in tab order. */
  labels: ':scope > [aria-hidden="true"]',
  /** Bluesky's notification lists (one page per tab); our panel replaces it. */
  list: '[data-testid="notificationsPagerView"]',
  /** The left-nav link to the notifications page. */
  navLink: 'a[aria-label="Notifications"]',
};

const NOTIFICATIONS_PATH = '/notifications';
const WATCHED_HASH = '#watched';
// How long to wait for the notifications screen after clicking the nav link
const PENDING_OPEN_TIMEOUT_MS = 5000;
const PENDING_OPEN_POLL_MS = 100;
// While the Watched view is open, how often to check that we're still on /notifications
// (Bluesky navigates with pushState, which fires no event)
const LEAVE_CHECK_MS = 500;

// Bluesky's own nodes only ever get these data attributes (React leaves attributes it
// doesn't manage alone, where it may rewrite className): one on the screen while the view
// is open, and one naming the role of each node our CSS restyles. All removed on deactivate.
const ACTIVE_ATTR = 'data-bsky-nav-watched-active';
const MARK_ATTR = 'data-bsky-nav-watched';
const MARK_HIGHLIGHT = 'highlight';
const MARK_LABEL = 'label';
const MARK_LIST = 'list';
const TAB_WRAP_CLASS = 'bsky-nav-watched-tab-wrap';
const TAB_CLASS = 'bsky-nav-watched-tab';
const PANEL_CLASS = 'bsky-nav-watched-panel';

function isVisible(el) {
  return el.getClientRects().length > 0;
}

/** querySelector(All) that treats a selector the browser can't parse (e.g. no :has()) as no match. */
function safeQuery(root, selector, all = false) {
  try {
    return all ? [...root.querySelectorAll(selector)] : root.querySelector(selector);
  } catch {
    return all ? [] : null;
  }
}

export class WatchedTab {
  /**
   * @param {object} options
   * @param {object} options.service the WatchService
   * @param {object} options.config ConfigWrapper
   */
  constructor({ service, config }) {
    this.service = service;
    this.config = config;
    this.started = false;
    this.active = false;
    this.pendingOpen = false;
    this.screen = null;
    this.screenObserver = null;
    this.screenWatcher = null;
    this.ensureFrame = null;
    this.renderFrame = null;
    this.pendingTimer = null;
    this.leaveTimer = null;
    this.focusAfterRender = null;
    this.tabWrapEl = null;
    this.tabEl = null;
    this.panelEl = null;
    // The panel and markup last written by render(), to skip identical rewrites
    this.renderedPanel = null;
    this.renderedHtml = null;

    this._onWatchChanged = () => this._scheduleRender();
    this._onOpen = () => this.open();
    this._onHashChange = () => {
      if (this._onNotificationsPage() && window.location.hash === WATCHED_HASH) this.activate();
    };
    // Back/forward: leaving /notifications closes the view; returning to a #watched entry
    // opens it once the screen is back
    this._onPopState = () => {
      if (!this._onNotificationsPage()) {
        this.deactivate();
      } else if (window.location.hash === WATCHED_HASH && !this.active) {
        this.pendingOpen = true;
        this._ensure();
      }
    };
    this._onDocClick = (event) => this._maybeLeaveForBlueskyTab(event);
    this._onDocKeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') this._maybeLeaveForBlueskyTab(event);
    };
  }

  /** Start watching for the notifications screen and listening for open requests. */
  start() {
    if (this.started) return;
    this.started = true;
    // A full load of /notifications#watched opens the tab once it exists
    if (this._onNotificationsPage() && window.location.hash === WATCHED_HASH) {
      this.pendingOpen = true;
    }
    document.addEventListener(WATCH_CHANGED_EVENT, this._onWatchChanged);
    document.addEventListener(OPEN_WATCHED_TAB_EVENT, this._onOpen);
    window.addEventListener('hashchange', this._onHashChange);
    window.addEventListener('popstate', this._onPopState);
    // Capture phase, never stopped: Bluesky still switches its own tab
    document.addEventListener('click', this._onDocClick, true);
    document.addEventListener('keydown', this._onDocKeydown, true);
    this.screenWatcher = waitForElement(
      NOTIF_SELECTORS.screen,
      (screen) => this._attachScreen(screen),
      (screen) => this._detachScreen(screen)
    );
  }

  /** Stop everything and remove the tab and panel, restoring Bluesky's view. */
  stop() {
    if (!this.started) return;
    this.deactivate();
    this.started = false;
    this.pendingOpen = false;
    document.removeEventListener(WATCH_CHANGED_EVENT, this._onWatchChanged);
    document.removeEventListener(OPEN_WATCHED_TAB_EVENT, this._onOpen);
    window.removeEventListener('hashchange', this._onHashChange);
    window.removeEventListener('popstate', this._onPopState);
    document.removeEventListener('click', this._onDocClick, true);
    document.removeEventListener('keydown', this._onDocKeydown, true);
    this.screenWatcher?.disconnect();
    this.screenWatcher = null;
    this.screenObserver?.disconnect();
    this.screenObserver = null;
    if (this.ensureFrame) window.cancelAnimationFrame(this.ensureFrame);
    if (this.renderFrame) window.cancelAnimationFrame(this.renderFrame);
    this.ensureFrame = null;
    this.renderFrame = null;
    this._clearPendingTimer();
    this.tabWrapEl?.remove();
    this.panelEl?.remove();
    this.tabWrapEl = null;
    this.tabEl = null;
    this.panelEl = null;
    this.screen = null;
  }

  /**
   * Open the Watched tab: here if this is the notifications page, else go there first.
   */
  open() {
    if (this._onNotificationsPage() && this.screen) {
      this.activate();
      return;
    }
    this.pendingOpen = true;
    const link = document.querySelector(NOTIF_SELECTORS.navLink);
    if (!link) {
      window.location.href = WATCHED_TAB_URL;
      return;
    }
    link.click();
    // The screen may already be mounted (and just hidden), so no mutation announces it
    this._clearPendingTimer();
    const startedAt = Date.now();
    this.pendingTimer = window.setInterval(() => {
      if (!this.pendingOpen || Date.now() - startedAt > PENDING_OPEN_TIMEOUT_MS) {
        // Giving up: a later visit to /notifications must not open Watched by surprise
        this.pendingOpen = false;
        this._clearPendingTimer();
        return;
      }
      this._ensure();
    }, PENDING_OPEN_POLL_MS);
  }

  /** Show the Watched list in place of Bluesky's notifications list. */
  activate() {
    // Cleared first: _ensure() activates a pending open itself
    this.pendingOpen = false;
    if (!this.screen || !this._ensure()) {
      this.pendingOpen = true;
      return;
    }
    this._clearPendingTimer();
    this.active = true;
    this._markBluesky();
    this.tabEl.setAttribute('aria-selected', 'true');
    // Bluesky's tab bar scrolls sideways when the tabs don't fit; bring ours into view once
    // the bar has laid out
    window.requestAnimationFrame(() => {
      if (this.active) this.tabEl?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    this._startLeaveCheck();
    this._updatePanelOffset();
    this.render();
    if (window.location.hash !== WATCHED_HASH) {
      window.history.replaceState(window.history.state, '', WATCHED_TAB_URL);
    }
  }

  /** Restore Bluesky's own view and drop the #watched hash. */
  deactivate() {
    this.pendingOpen = false;
    this._clearPendingTimer();
    this._stopLeaveCheck();
    if (!this.active) return;
    this.active = false;
    this._unmarkBluesky();
    this.tabEl?.setAttribute('aria-selected', 'false');
    if (this._onNotificationsPage() && window.location.hash === WATCHED_HASH) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', pathname + search);
    }
  }

  /** Redraw the tab's count pill and, if open, the list. */
  render() {
    if (this.renderFrame) {
      window.cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this._renderCount();
    if (!this.panelEl || !this.active) return;
    const entries = buildWatchedEntries(this.service.getWatches(), Date.now());
    const html = watchedPanelHtml({ entries, hasApi: this.service.hasApi() });
    // Rewriting identical markup would only drop focus and text selection
    if (this.renderedPanel === this.panelEl && this.renderedHtml === html) {
      this.focusAfterRender = null;
      return;
    }
    this.panelEl.innerHTML = html;
    this.renderedPanel = this.panelEl;
    this.renderedHtml = html;
    this._restoreFocus();
  }

  // Internals

  _onNotificationsPage() {
    return window.location.pathname === NOTIFICATIONS_PATH;
  }

  _clearPendingTimer() {
    if (this.pendingTimer) window.clearInterval(this.pendingTimer);
    this.pendingTimer = null;
  }

  /** Close the view once Bluesky navigates away from /notifications. */
  _startLeaveCheck() {
    if (this.leaveTimer) return;
    this.leaveTimer = window.setInterval(() => {
      if (!this._onNotificationsPage()) this.deactivate();
      // The header's height can change without a DOM mutation (resize, font load)
      else this._updatePanelOffset();
    }, LEAVE_CHECK_MS);
  }

  _stopLeaveCheck() {
    if (this.leaveTimer) window.clearInterval(this.leaveTimer);
    this.leaveTimer = null;
  }

  /**
   * After Mark seen / Stop watching re-renders the list, put focus somewhere sensible:
   * the same entry's next button, else the entry now at that position (or the last one),
   * else the panel itself.
   */
  _restoreFocus() {
    const target = this.focusAfterRender;
    this.focusAfterRender = null;
    if (!target || !this.panelEl) return;
    const entries = [...this.panelEl.querySelectorAll('[data-post-id]')];
    const same = entries.find((el) => el.getAttribute('data-post-id') === target.postId);
    let el = same?.querySelector('[data-watched-action="unwatch"]');
    if (!el && entries.length > 0) {
      const next = entries[Math.min(target.index, entries.length - 1)];
      el = next.querySelector('[data-watched-action]');
    }
    (el || this.panelEl).focus();
  }

  /**
   * Render after the current event finishes. A link's click marks its watch seen, which
   * re-renders the list; replacing the link mid-click would cancel its navigation.
   */
  _scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  _attachScreen(screen) {
    if (this.screen === screen) return;
    this.screenObserver?.disconnect();
    this.screen = screen;
    // React re-renders the tab bar (e.g. on every tab switch); put the tab back each time
    this.screenObserver = new MutationObserver(() => {
      if (this.ensureFrame) return;
      this.ensureFrame = window.requestAnimationFrame(() => {
        this.ensureFrame = null;
        this._ensure();
      });
    });
    this.screenObserver.observe(screen, { childList: true, subtree: true });
    this._ensure();
  }

  _detachScreen(screen) {
    if (this.screen !== screen) return;
    this.screenObserver?.disconnect();
    this.screenObserver = null;
    this._unmarkBluesky();
    this.screen = null;
    this.active = false;
    // Another notifications screen may still be mounted
    const other = [...document.querySelectorAll(NOTIF_SELECTORS.screen)].find(
      (el) => el !== screen
    );
    if (other) this._attachScreen(other);
  }

  /** Bluesky's tabs in the tab bar, without ours. */
  _blueskyTabs(tablist) {
    return [...tablist.querySelectorAll(NOTIF_SELECTORS.tab)].filter((t) => t !== this.tabEl);
  }

  /** The row holding Bluesky's tab wrappers and their overlays. */
  _tabRow(tabs) {
    return tabs[0].parentElement?.parentElement ?? null;
  }

  /**
   * Make sure the tab and panel are in the screen; insert them if React dropped them.
   * Activates a pending open once everything is in place.
   * @returns {boolean} whether the tab is in place
   */
  _ensure() {
    const screen = this.screen;
    if (!screen) return false;
    const tablist = screen.querySelector(NOTIF_SELECTORS.tablist);
    const tabs = tablist ? this._blueskyTabs(tablist) : [];
    if (!tablist || tabs.length === 0 || !this._insert(tabs)) return false;
    if (this.active) this._markBluesky();
    if (this.pendingOpen && this._onNotificationsPage() && isVisible(screen)) {
      if (this.active) {
        this.pendingOpen = false;
        this._clearPendingTimer();
      } else {
        this.activate();
      }
    }
    return true;
  }

  /**
   * Put our tab right after Bluesky's last tab wrapper (before the overlays, which Bluesky
   * places by measured offsets, so they stay aligned) and our panel right after the list.
   * @returns {boolean} whether the tab is in place
   */
  _insert(tabs) {
    const row = this._tabRow(tabs);
    if (!row) return false;
    if (!this.tabWrapEl) this._createTab();
    if (!this.panelEl) this.panelEl = this._createPanel();
    const lastWrapper = tabs[tabs.length - 1].parentElement;
    if (
      this.tabWrapEl.parentElement !== row ||
      this.tabWrapEl.previousElementSibling !== lastWrapper
    ) {
      row.insertBefore(this.tabWrapEl, lastWrapper.nextSibling);
      this._renderCount();
    }
    const list = this.screen.querySelector(NOTIF_SELECTORS.list);
    if (list && list.nextElementSibling !== this.panelEl) {
      list.after(this.panelEl);
      if (this.active) this.render();
    }
    return true;
  }

  /**
   * While Watched is open: hide Bluesky's list and its sliding highlight, and show every tab
   * label in the unselected color (without the highlight, the selected label's own color can
   * be dark on a dark page).
   */
  _markBluesky() {
    const screen = this.screen;
    const tablist = screen?.querySelector(NOTIF_SELECTORS.tablist);
    if (!tablist) return;
    const mark = (el, role) => {
      if (el && el.getAttribute(MARK_ATTR) !== role) el.setAttribute(MARK_ATTR, role);
    };
    if (!screen.hasAttribute(ACTIVE_ATTR)) screen.setAttribute(ACTIVE_ATTR, '');
    mark(screen.querySelector(NOTIF_SELECTORS.list), MARK_LIST);
    const tabs = this._blueskyTabs(tablist);
    const row = tabs.length ? this._tabRow(tabs) : null;
    if (row) {
      mark(safeQuery(row, NOTIF_SELECTORS.highlight), MARK_HIGHLIGHT);
      for (const label of safeQuery(row, NOTIF_SELECTORS.labels, true)) mark(label, MARK_LABEL);
    }
  }

  /**
   * Bluesky's header is fixed and its lists pad their top by its height; so does our panel.
   * Measured on activate and on the leave-check tick, not on every mutation frame.
   */
  _updatePanelOffset() {
    const tablist = this.screen?.querySelector(NOTIF_SELECTORS.tablist);
    if (!this.panelEl || !tablist) return;
    const header = this._fixedHeader(tablist);
    const pad = header ? `${Math.round(header.getBoundingClientRect().height)}px` : '';
    if (this.panelEl.style.paddingTop !== pad) this.panelEl.style.paddingTop = pad;
  }

  /** Undo everything `_markBluesky` did to Bluesky's nodes. */
  _unmarkBluesky() {
    const screen = this.screen;
    if (!screen) return;
    screen.removeAttribute(ACTIVE_ATTR);
    screen.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
  }

  /** The fixed header that holds the tab bar, if any. */
  _fixedHeader(tablist) {
    for (let el = tablist.parentElement; el && el !== this.screen; el = el.parentElement) {
      if (window.getComputedStyle(el).position === 'fixed') return el;
    }
    return null;
  }

  _createTab() {
    const wrap = document.createElement('div');
    wrap.className = TAB_WRAP_CLASS;
    const tab = document.createElement('div');
    tab.className = TAB_CLASS;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-selected', 'false');
    tab.innerHTML =
      '<span class="bsky-nav-watched-tab-label">Watched</span>' +
      '<span class="bsky-nav-watched-tab-count" hidden></span>';
    tab.addEventListener('click', () => this.activate());
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.activate();
      }
    });
    wrap.appendChild(tab);
    this.tabWrapEl = wrap;
    this.tabEl = tab;
  }

  _createPanel() {
    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', 'Watched threads');
    // Focus lands here when an action empties the list
    panel.setAttribute('tabindex', '-1');
    panel.addEventListener('click', (event) => this._onPanelClick(event));
    // Middle-click opens a link in a new tab; that counts as opening it too
    panel.addEventListener('auxclick', (event) => {
      if (event.button === 1) this._onPanelClick(event);
    });
    return panel;
  }

  _onPanelClick(event) {
    const entry = event.target.closest('[data-post-id]');
    if (!entry || !this.panelEl.contains(entry)) return;
    const postId = entry.getAttribute('data-post-id');
    const button = event.target.closest('[data-watched-action]');
    if (button) {
      const action = button.getAttribute('data-watched-action');
      const entries = [...this.panelEl.querySelectorAll('[data-post-id]')];
      this.focusAfterRender = { postId, index: entries.indexOf(entry) };
      if (action === 'mark-seen') this.service.markSeen(postId);
      else if (action === 'unwatch') this.service.unwatch(postId);
      return;
    }
    // Links navigate normally; the re-render this causes waits for the next frame
    if (event.target.closest('a[href]')) this.service.markSeen(postId);
  }

  _renderCount() {
    const pill = this.tabEl?.querySelector('.bsky-nav-watched-tab-count');
    if (!pill) return;
    const total = this.service.unseenTotal();
    pill.textContent = total > 0 ? String(total) : '';
    pill.hidden = total === 0;
    this.tabEl.setAttribute(
      'aria-label',
      total > 0 ? `Watched, ${total} new ${total === 1 ? 'reply' : 'replies'}` : 'Watched'
    );
  }

  /** A click or Enter on one of Bluesky's tabs leaves the Watched view; Bluesky handles the rest. */
  _maybeLeaveForBlueskyTab(event) {
    if (!this.active || !this.screen) return;
    const tab = event.target.closest?.(NOTIF_SELECTORS.tab);
    if (!tab || tab === this.tabEl || this.tabEl?.contains(tab)) return;
    if (!tab.closest(NOTIF_SELECTORS.tablist) || !this.screen.contains(tab)) return;
    this.deactivate();
  }
}
