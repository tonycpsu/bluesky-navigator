// SavedItemHandler.js - Handler for saved/bookmarked posts page
/* global $ */

import { FeedItemHandler } from './FeedItemHandler.js';
import {
  getFeedMapConfig,
  createFeedMapElements,
  attachFeedMapToHandler,
  setupFeedMapHandlers,
} from './feedMapUtils.js';

/**
 * Handler for the saved posts (bookmarks) page.
 * Extends FeedItemHandler to provide keyboard navigation and toolbar on bookmarked posts.
 */
export class SavedItemHandler extends FeedItemHandler {
  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
    this.uiManagerStatusBar = null;
    this.uiManagerStatusBarLeft = null;
  }

  /**
   * Called by SavedUIAdapter to provide UIManager's status bar
   * This is called after activate(), so we setup feed map here
   */
  setUIManagerStatusBar(statusBar, statusBarLeft) {
    this.uiManagerStatusBar = statusBar;
    this.uiManagerStatusBarLeft = statusBarLeft;

    // Ensure status bar is in DOM and visible (may have been removed during SPA navigation)
    if (!$.contains(document, statusBar[0])) {
      // Status bar not in DOM - need to wait for UIManager to re-insert it
      setTimeout(() => this.setUIManagerStatusBar(statusBar, statusBarLeft), 100);
      return;
    }
    statusBar.show();

    // Remove any stale feed map wrapper and create fresh
    // (important for SPA navigation where previous wrapper might exist)
    statusBar.find('.feed-map-wrapper').remove();
    statusBar.removeClass('has-feed-map');
    this.addFeedMapToStatusBar(statusBar);

    // Load items with retry - saved page feed takes time to render
    this.loadItemsWithRetry();
  }

  /**
   * Add feed map elements to UIManager's status bar
   */
  addFeedMapToStatusBar(statusBar) {
    const feedMapConfig = getFeedMapConfig(this.config);
    if (feedMapConfig.position !== 'Bottom status bar') {
      return; // Feed map not configured for status bar
    }

    // Create feed map elements using shared utility
    const elements = createFeedMapElements(feedMapConfig, { isToolbar: false });

    // Attach elements to handler properties
    attachFeedMapToHandler(this, elements);

    // Prepend to status bar (before other sections)
    statusBar.prepend(elements.wrapper);
    statusBar.addClass('has-feed-map');

    // Setup event handlers
    setupFeedMapHandlers(this, elements.map, elements.zoom);

    // Store reference to status bar for other operations
    this.statusBar = statusBar;
  }

  isActive() {
    // Check for bookmarks screen or saved/bookmarks URL path
    const path = window.location.pathname;
    return path.includes('/saved') ||
           path.includes('/bookmarks') ||
           document.querySelector('div[data-testid="bookmarksScreen"]') !== null;
  }

  /**
   * Override refreshToolbars to use saved-page-specific selectors.
   * The saved page doesn't have homeScreenFeedTabs, so we find the
   * feed container and insert the toolbar at the top.
   * Note: Status bar is handled by UIManager via SavedUIAdapter.
   */
  refreshToolbars() {
    // Disconnect any previous observer
    if (this._toolbarObserver) {
      this._toolbarObserver.disconnect();
      this._toolbarObserver = null;
    }

    // Prevent multiple simultaneous setup attempts
    if (this._settingUpToolbars) {
      return;
    }

    // If we already have a toolbar reference and it's in the DOM, we're done
    if (this.toolbarDiv && $.contains(document, this.toolbarDiv[0])) {
      return;
    }

    // Remove any existing toolbar (stale from previous handler)
    $('#bsky-navigator-toolbar').remove();

    // Find the saved page container structure
    const insertPoint = this._findToolbarInsertPoint();
    if (insertPoint) {
      this._settingUpToolbars = true;
      this.addToolbar(insertPoint);
      this._settingUpToolbars = false;
      this._hideSavedPageControls();
      return;
    }

    // Use MutationObserver to wait for content to appear
    this._toolbarObserver = new MutationObserver(() => {
      if (this._settingUpToolbars) {
        return;
      }

      if (this.toolbarDiv && $.contains(document, this.toolbarDiv[0])) {
        this._toolbarObserver.disconnect();
        this._toolbarObserver = null;
        return;
      }

      $('#bsky-navigator-toolbar').remove();

      const point = this._findToolbarInsertPoint();
      if (point) {
        this._toolbarObserver.disconnect();
        this._toolbarObserver = null;
        this._settingUpToolbars = true;
        this.addToolbar(point);
        this._settingUpToolbars = false;
        this._hideSavedPageControls();
      }
    });

    this._toolbarObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Find the correct insertion point for the toolbar on the saved page.
   * Insert inside the max-width container to inherit correct width styling.
   * Uses native DOM to filter to visible, connected elements (avoid stale React elements).
   */
  _findToolbarInsertPoint() {
    // Use native DOM to find visible, connected bookmarksScreen (avoid stale React elements)
    const allScreens = document.querySelectorAll('div[data-testid="bookmarksScreen"]');
    let bookmarksScreen = null;
    for (const screen of allScreens) {
      if (screen.isConnected && screen.offsetParent !== null) {
        bookmarksScreen = $(screen);
        break;
      }
    }
    if (!bookmarksScreen) {
      return null;
    }

    // Strategy 1: Find the max-width container and insert at its start
    // This ensures toolbar inherits the same width as the feed content
    const feedContainer = bookmarksScreen.find('div[style*="max-width"]').first();
    if (feedContainer.length && feedContainer[0].isConnected) {
      // Find first child to insert before (toolbar goes at top of container)
      const firstChild = feedContainer.children().first();
      if (firstChild.length && firstChild[0].isConnected) {
        return firstChild;
      }
    }

    // Strategy 2: Find the first post and insert before it
    const firstPost = bookmarksScreen.find('div[role="link"][tabindex="0"]').first();
    if (firstPost.length && firstPost[0].isConnected) {
      return firstPost;
    }

    // Strategy 3: Fallback to bookmarksScreen's first grandchild
    const firstChild = bookmarksScreen.children().first();
    if (firstChild.length && firstChild[0].isConnected) {
      const firstGrandchild = firstChild.children().first();
      if (firstGrandchild.length && firstGrandchild[0].isConnected) {
        return firstGrandchild;
      }
      return firstChild;
    }

    return null;
  }

  /**
   * Hide controls that don't apply to the saved page
   */
  _hideSavedPageControls() {
    if (!this.toolbarDiv) return;

    // Hide sort order (saved posts use their own order)
    this.toolbarDiv.find('.sort-order-btn').hide();
    this.toolbarDiv.find('#sortIndicator').hide();

    // Hide new posts pill (not applicable)
    this.toolbarDiv.find('#bsky-navigator-new-posts-pill').hide();

    // Hide saved searches (not needed on saved page)
    this.toolbarDiv.find('.saved-searches-btn').hide();

    // Hide load indicators (saved page doesn't have infinite scroll the same way)
    this.toolbarDiv.find('#topLoadIndicator').hide();
    this.toolbarDiv.find('#bottomLoadIndicator').hide();
  }

  /**
   * Override activate to load items with retry since saved page loads async
   */
  activate() {
    super.activate();

    // Saved page feed loads asynchronously, so use retry
    this.loadItemsWithRetry();
  }

  deactivate() {
    // Disconnect any pending toolbar observer
    if (this._toolbarObserver) {
      this._toolbarObserver.disconnect();
      this._toolbarObserver = null;
    }

    // Clear feed map references before calling super (which removes elements)
    this.feedMap = null;
    this.feedMapWrapper = null;
    this.feedMapZoom = null;

    super.deactivate();

    this.uiManagerStatusBar = null;
    this.uiManagerStatusBarLeft = null;
  }
}
