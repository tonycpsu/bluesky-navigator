// ProfileItemHandler.js - Handler for user profile pages

import { FeedItemHandler } from './FeedItemHandler.js';

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
   * This is called after activate(), so we need to setup feed map here
   */
  setUIManagerStatusBar(statusBar, statusBarLeft) {
    console.log('[ProfileItemHandler] setUIManagerStatusBar called', {
      statusBar: statusBar?.length,
      statusBarLeft: statusBarLeft?.length,
      hasFeedMap: statusBar?.find('.feed-map-wrapper').length,
    });
    this.uiManagerStatusBar = statusBar;
    this.uiManagerStatusBarLeft = statusBarLeft;

    // Now that we have UIManager's status bar, setup the feed map
    if (!statusBar.find('.feed-map-wrapper').length) {
      console.log('[ProfileItemHandler] Adding feed map to UIManager status bar');
      this.addFeedMapToStatusBar(statusBar);
    } else {
      console.log('[ProfileItemHandler] Feed map already exists');
    }

    // Load items with retry - profile feed takes time to render
    this.loadItemsWithRetry();
  }

  /**
   * Load items with retry for profile pages where feed loads asynchronously
   */
  loadItemsWithRetry() {
    let retryCount = 0;
    const maxRetries = 10;

    const tryLoad = () => {
      this.loadItems();
      const itemCount = this.items?.length || 0;
      console.log('[ProfileItemHandler] loadItemsWithRetry attempt', retryCount, 'found', itemCount, 'items');

      if (itemCount === 0 && retryCount < maxRetries) {
        retryCount++;
        setTimeout(tryLoad, 300);
      } else if (itemCount > 0) {
        // Items found - update feed map
        console.log('[ProfileItemHandler] Items loaded, updating scroll position');
        this.updateScrollPosition(true);
      }
    };

    // Initial delay to let profile feed render
    setTimeout(tryLoad, 500);
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

    // If we already have a toolbar reference and it's in the DOM, we're done
    if (this.toolbarDiv && $.contains(document, this.toolbarDiv[0])) {
      this.setSortIcons();
      return;
    }

    // Remove any existing toolbar (stale from previous handler)
    $('#bsky-navigator-toolbar').remove();

    // Try to insert immediately if element exists
    const profileFeedTabs = $('div[data-testid="profilePager"]').first();
    if (profileFeedTabs.length) {
      this._settingUpToolbars = true;
      this.addToolbar(profileFeedTabs);
      this._settingUpToolbars = false;
      this.setSortIcons();
      this.applyProfileWidth();
      return;
    }

    // Use MutationObserver to wait for profilePager to appear
    this._toolbarObserver = new MutationObserver((mutations, obs) => {
      // Skip if already setting up
      if (this._settingUpToolbars) {
        return;
      }

      // If we already have a toolbar reference and it's in the DOM, we're done
      if (this.toolbarDiv && $.contains(document, this.toolbarDiv[0])) {
        obs.disconnect();
        this._toolbarObserver = null;
        return;
      }

      // Remove any existing toolbar (stale)
      $('#bsky-navigator-toolbar').remove();

      const profilePager = $('div[data-testid="profilePager"]').first();
      if (profilePager.length) {
        obs.disconnect();
        this._toolbarObserver = null;
        this._settingUpToolbars = true;
        this.addToolbar(profilePager);
        this._settingUpToolbars = false;
        this.setSortIcons();
        this.applyProfileWidth();
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
   * Add feed map elements to an existing status bar (UIManager's)
   */
  addFeedMapToStatusBar(statusBar) {
    const indicatorPosition = this.config.get('feedMapPosition');
    if (indicatorPosition !== 'Bottom status bar') {
      return; // Feed map not configured for status bar
    }

    const indicatorStyle = this.config.get('feedMapStyle') || 'Advanced';
    const isAdvancedStyle = indicatorStyle === 'Advanced';
    const styleClass = isAdvancedStyle ? 'feed-map-advanced' : 'feed-map-basic';
    const indicatorTheme = this.config.get('feedMapTheme') || 'Default';
    const themeClass = `feed-map-theme-${indicatorTheme.toLowerCase()}`;
    const indicatorScale = parseInt(this.config.get('feedMapScale'), 10) || 100;
    const scaleValue = indicatorScale / 100;
    const animationInterval = parseInt(this.config.get('feedMapAnimationSpeed'), 10);
    const animationIntervalValue = (isNaN(animationInterval) ? 100 : animationInterval) / 100;
    const customPropsStyle = `--indicator-scale: ${scaleValue}; --zoom-animation-speed: ${animationIntervalValue};`;

    // Create feed map elements (same as FeedItemHandler.addStatusBar)
    this.feedMapContainer = $(`<div class="feed-map-container"></div>`);
    this.feedMapLabelStart = $(`<span class="feed-map-label feed-map-label-start"></span>`);
    this.feedMapLabelEnd = $(`<span class="feed-map-label feed-map-label-end"></span>`);
    this.feedMap = $(`<div id="feed-map-position-indicator" class="feed-map-position-indicator" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="feed-map-position-fill"></div><div class="feed-map-position-zoom-highlight"></div></div>`);
    this.feedMapContainer.append(this.feedMapLabelStart);
    this.feedMapContainer.append(this.feedMap);
    this.feedMapContainer.append(this.feedMapLabelEnd);

    this.feedMapZoomHighlight = this.feedMap.find('.feed-map-position-zoom-highlight');
    this.feedMapWrapper = $(`<div class="feed-map-wrapper feed-map-wrapper-statusbar ${styleClass} ${themeClass}" style="${customPropsStyle}"></div>`);
    this.feedMapWrapper.append(this.feedMapContainer);

    this.feedMapConnector = $(`<div class="feed-map-connector">
      <svg class="feed-map-connector-svg" preserveAspectRatio="none">
        <path class="feed-map-connector-path feed-map-connector-left" fill="none"/>
        <path class="feed-map-connector-path feed-map-connector-right" fill="none"/>
      </svg>
    </div>`);
    this.feedMapWrapper.append(this.feedMapConnector);

    this.feedMapZoomContainer = $(`<div class="feed-map-container feed-map-zoom-container"></div>`);
    this.feedMapZoomLabelStart = $(`<span class="feed-map-label feed-map-label-start"></span>`);
    this.feedMapZoomLabelEnd = $(`<span class="feed-map-label feed-map-label-end"></span>`);
    this.feedMapZoom = $(`<div id="feed-map-position-indicator-zoom" class="feed-map-position-indicator feed-map-position-indicator-zoom"></div>`);
    this.feedMapZoomContainer.append(this.feedMapZoomLabelStart);
    this.feedMapZoomContainer.append(this.feedMapZoom);
    this.feedMapZoomContainer.append(this.feedMapZoomLabelEnd);
    this.feedMapWrapper.append(this.feedMapZoomContainer);

    // Prepend to status bar (before other sections)
    statusBar.prepend(this.feedMapWrapper);
    statusBar.addClass('has-feed-map');

    // Setup event handlers
    this.setupScrollIndicatorZoomClick();
    this.setupScrollIndicatorClick();
    this.setupScrollIndicatorScroll();
    this.setupFeedMapTooltipHandlers(this.feedMap);
    this.setupFeedMapTooltipHandlers(this.feedMapZoom);

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
