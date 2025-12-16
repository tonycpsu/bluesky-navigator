// ProfileItemHandler.js - Handler for user profile pages

import { FeedItemHandler } from './FeedItemHandler.js';
import {
  getFeedMapConfig,
  createFeedMapElements,
  attachFeedMapToHandler,
  setupFeedMapHandlers,
} from './feedMapUtils.js';

/**
 * Handler for profile pages with profile-specific actions (follow, mute, block, etc.).
 */
export class ProfileItemHandler extends FeedItemHandler {
  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
    this.uiManagerStatusBar = null;
    this.uiManagerStatusBarLeft = null;
    this._toolbarObserver = null;
  }

  /**
   * Called by ProfileUIAdapter to provide UIManager's status bar
   * This is called after activate(), and also when navigating between profiles
   * (where context doesn't change but URL does)
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

    // Check if toolbar needs refresh (for profile-to-profile navigation where
    // context doesn't change but DOM may have been updated by React)
    // Must check isConnected AND offsetParent to detect stale React elements
    const toolbarEl = this.toolbarDiv ? this.toolbarDiv[0] : null;
    const toolbarValid = toolbarEl && toolbarEl.isConnected && toolbarEl.offsetParent !== null;
    if (!toolbarValid) {
      this.refreshToolbars();
    }

    // Load items with retry - profile feed takes time to render
    this.loadItemsWithRetry();
  }

  activate() {
    this.setIndex(0);
    super.activate();

    // Start watching for the profile buttons container
    this._watchForProfileButtons();
  }

  /**
   * Watch for profile buttons container and insert our button when ready
   */
  _watchForProfileButtons() {
    // Disconnect any existing observer
    if (this._profileButtonObserver) {
      this._profileButtonObserver.disconnect();
      this._profileButtonObserver = null;
    }

    // Function to try inserting the button
    const tryInsert = () => {
      // Check if already present AND visible
      const existingBtn = $('.bsky-nav-profile-rules-btn');
      if (existingBtn.length) {
        const rect = existingBtn[0].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return true; // Already exists and visible
        }
        // Exists but not visible - remove orphaned element
        existingBtn.closest('.bsky-nav-profile-rules-wrapper').remove();
        existingBtn.remove();
      }

      // Find the "More options" button - use querySelectorAll and filter to the connected, visible one
      // (jQuery can return stale elements from previous pages on SPA navigation)
      const allMoreOptionsBtns = document.querySelectorAll('button[data-testid="profileHeaderDropdownBtn"]');

      let moreOptionsBtn = null;
      for (const btn of allMoreOptionsBtns) {
        const rect = btn.getBoundingClientRect();
        if (btn.isConnected && rect.width > 0 && rect.height > 0) {
          moreOptionsBtn = $(btn);
          break;
        }
      }

      if (!moreOptionsBtn) {
        return false;
      }

      // Get the wrapper div around the more options button
      const moreOptionsWrapper = moreOptionsBtn.parent();
      if (!moreOptionsWrapper.length) return false;

      // Extract handle from URL
      const path = window.location.pathname;
      const handleMatch = path.match(/^\/profile\/([^/]+)/);
      if (!handleMatch) return false;
      const handle = handleMatch[1];

      // Create button with same structure as notification button (wrapped in div)
      const addButton = $(`
        <div class="css-g5y9jx bsky-nav-profile-rules-wrapper">
          <button class="bsky-nav-profile-rules-btn" aria-label="Add @${handle} to filter rules" title="Add @${handle} to filter rules" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>
      `);

      // Insert before the more options wrapper (so it appears between follow and more options)
      moreOptionsWrapper.before(addButton);

      // Verify the button is actually visible after inserting
      const insertedBtn = addButton.find('.bsky-nav-profile-rules-btn')[0];
      const insertedRect = insertedBtn.getBoundingClientRect();

      if (insertedRect.width === 0 || insertedRect.height === 0) {
        // Remove it and try again later
        addButton.remove();
        return false;
      }

      // Handle click
      addButton.find('.bsky-nav-profile-rules-btn').on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btnRect = e.currentTarget.getBoundingClientRect();
        this.showAddToRulesDropdown(btnRect, handle);
      });

      return true;
    };

    // Try immediately
    if (tryInsert()) return;

    // Set up observer to keep trying
    this._profileButtonObserver = new MutationObserver(() => {
      if (tryInsert()) {
        // Keep observer running to re-insert if React removes our button
      }
    });

    this._profileButtonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  deactivate() {
    // Disconnect any pending toolbar observer
    if (this._toolbarObserver) {
      this._toolbarObserver.disconnect();
      this._toolbarObserver = null;
    }

    // Disconnect profile button observer
    if (this._profileButtonObserver) {
      this._profileButtonObserver.disconnect();
      this._profileButtonObserver = null;
    }

    // Remove the profile rules button
    $('.bsky-nav-profile-rules-wrapper').remove();

    // Clear feed map references before calling super (which removes elements)
    this.feedMap = null;
    this.feedMapWrapper = null;
    this.feedMapZoom = null;

    super.deactivate();

    this.uiManagerStatusBar = null;
    this.uiManagerStatusBarLeft = null;
  }

  isActive() {
    return window.location.pathname.match(/^\/profile\//);
  }

  /**
   * Override refreshToolbars to use profile-specific selectors
   * Uses UIManager's fixed status bar instead of creating our own
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

    // If we already have a toolbar reference and it's valid, we're done
    // Must check isConnected AND offsetParent to detect stale React elements
    const toolbarEl = this.toolbarDiv ? this.toolbarDiv[0] : null;
    const toolbarValid = toolbarEl && toolbarEl.isConnected && toolbarEl.offsetParent !== null;
    if (toolbarValid) {
      this.setSortIcons();
      return;
    }

    // Remove any existing toolbar (stale from previous handler)
    $('#bsky-navigator-toolbar').remove();
    this.toolbarDiv = null;

    // Try to insert immediately if element exists
    // Use native DOM to filter to only visible, connected elements (avoid stale React elements)
    const profileFeedTabs = this._findVisibleProfilePager();
    if (profileFeedTabs) {
      this._settingUpToolbars = true;
      this.addToolbar(profileFeedTabs);
      this._settingUpToolbars = false;
      this.setSortIcons();
      this.applyProfileWidth();
      // Load items to populate feed map (for 'Top toolbar' position)
      this.loadItemsWithRetry();
      return;
    }

    // Use MutationObserver to wait for profilePager to appear
    this._toolbarObserver = new MutationObserver((mutations, obs) => {
      // Skip if already setting up
      if (this._settingUpToolbars) {
        return;
      }

      // If we already have a toolbar reference and it's valid, we're done
      const toolbarEl = this.toolbarDiv ? this.toolbarDiv[0] : null;
      const toolbarValid = toolbarEl && toolbarEl.isConnected && toolbarEl.offsetParent !== null;
      if (toolbarValid) {
        obs.disconnect();
        this._toolbarObserver = null;
        return;
      }

      // Remove any existing toolbar (stale)
      $('#bsky-navigator-toolbar').remove();
      this.toolbarDiv = null;

      // Use native DOM to filter to only visible, connected elements
      const profilePager = this._findVisibleProfilePager();
      if (profilePager) {
        obs.disconnect();
        this._toolbarObserver = null;
        this._settingUpToolbars = true;
        this.addToolbar(profilePager);
        this._settingUpToolbars = false;
        this.setSortIcons();
        this.applyProfileWidth();
        // Load items to populate feed map (for 'Top toolbar' position)
        this.loadItemsWithRetry();
      }
    });

    // Observe the document for added nodes
    this._toolbarObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout fallback - disconnect after 10 seconds
    setTimeout(() => {
      if (this._toolbarObserver) {
        this._toolbarObserver.disconnect();
        this._toolbarObserver = null;
      }
    }, 10000);
  }

  /**
   * Find a visible, connected profilePager element.
   * During SPA navigation, React may leave stale elements in the DOM,
   * so we filter to only elements that are connected and visible.
   * @returns {jQuery|null} - jQuery-wrapped visible profilePager or null
   */
  _findVisibleProfilePager() {
    const allProfilePagers = document.querySelectorAll('div[data-testid="profilePager"]');
    for (const pager of allProfilePagers) {
      if (pager.isConnected && pager.offsetParent !== null) {
        return $(pager);
      }
    }
    return null;
  }

  /**
   * Add feed map elements to an existing status bar (UIManager's)
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

  /**
   * Apply configured width to profile page elements
   */
  applyProfileWidth() {
    const contentWidth = this.config.get('postWidthDesktop') || 600;
    if (contentWidth === 600) {
      return; // Default width, no changes needed
    }

    const profilePager = $('div[data-testid="profilePager"]');
    if (profilePager.length) {
      profilePager.css('width', contentWidth + 'px');
    }
  }

  handleInput(event) {
    if (super.handleInput(event)) {
      return;
    }
    if (event.altKey || event.metaKey) {
      return;
    }
    if (event.key == 'f') {
      // f = follow
      $("button[data-testid='followBtn']").click();
    } else if (event.key == 'F') {
      // F = unfollow (distinct shortcut for safety)
      $("button[data-testid='unfollowBtn']").click();
    } else if (event.key == 'L') {
      // L = add to list
      $("button[aria-label^='More options']").click();
      setTimeout(function () {
        $("div[data-testid='profileHeaderDropdownListAddRemoveBtn']").click();
      }, 200);
    } else if (event.key == 'M') {
      // M = mute
      $("button[aria-label^='More options']").click();
      setTimeout(function () {
        $("div[data-testid='profileHeaderDropdownMuteBtn']").click();
      }, 200);
    } else if (event.key == 'B') {
      // B = block
      $("button[aria-label^='More options']").click();
      setTimeout(function () {
        $("div[data-testid='profileHeaderDropdownBlockBtn']").click();
      }, 200);
    } else if (event.key == 'R') {
      // R = report
      $("button[aria-label^='More options']").click();
      setTimeout(function () {
        $("div[data-testid='profileHeaderDropdownReportBtn']").click();
      }, 200);
    }
  }
}
