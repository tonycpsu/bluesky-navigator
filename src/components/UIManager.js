/* global $ */
import constants from '../constants.js';
import { waitForElement } from '../utils.js';
import icons from '../icons.js';

/**
 * UIManager - Centralized manager for persistent UI elements (toolbar and status bar)
 *
 * Creates and manages toolbar and status bar DOM elements that persist across page transitions.
 * Uses context adapters to customize UI for different page types (feed, post, profile, etc.)
 */
class UIManager {
  constructor(config, state) {
    this.config = config;
    this.state = state;
    this.currentContext = null;
    this.currentAdapter = null;
    this.adapters = new Map();

    // DOM elements
    this.toolbarDiv = null;
    this.toolbarRow1 = null;
    this.toolbarRow2 = null;
    this.statusBar = null;
    this.statusBarLeft = null;
    this.statusBarCenter = null;
    this.statusBarRight = null;

    // Preferences icon (always present)
    this.preferencesIcon = null;

    // Track if we're initialized
    this.initialized = false;
  }

  /**
   * Register a context adapter for a specific page type
   * @param {string} contextName - Name of the context (e.g., 'feed', 'post', 'profile')
   * @param {object} adapter - Adapter object with activate/deactivate methods
   */
  registerAdapter(contextName, adapter) {
    this.adapters.set(contextName, adapter);
    adapter.setUIManager(this);
  }

  /**
   * Initialize the UIManager - creates DOM elements and inserts into page
   * Should be called after main[role="main"] is available
   */
  async initialize() {
    if (this.initialized) return;

    await waitForElement(constants.MAIN_SELECTOR, async (main) => {
      this.createToolbar();
      this.createStatusBar();
      await this.insertIntoDOM();
      this.initialized = true;
    });
  }

  /**
   * Create the toolbar DOM structure
   */
  createToolbar() {
    this.toolbarDiv = $(`<div id="bsky-navigator-global-toolbar" class="bsky-navigator-global-toolbar"/>`);

    // First row: icons (load, sort, filter indicators)
    this.toolbarRow1 = $(`<div class="toolbar-row toolbar-row-1 global-toolbar-row-1"/>`);
    this.toolbarDiv.append(this.toolbarRow1);

    // Second row: search and controls
    this.toolbarRow2 = $(`<div class="toolbar-row toolbar-row-2 global-toolbar-row-2"/>`);
    this.toolbarDiv.append(this.toolbarRow2);

    // Hide by default until an adapter activates
    this.toolbarDiv.hide();
  }

  /**
   * Create the status bar DOM structure
   */
  createStatusBar() {
    this.statusBar = $(`<div id="bsky-navigator-global-statusbar" class="bsky-navigator-global-statusbar"/>`);
    this.statusBarLeft = $(`<div class="statusBarLeft global-statusbar-left"></div>`);
    this.statusBarCenter = $(`<div class="statusBarCenter global-statusbar-center"></div>`);
    this.statusBarRight = $(`<div class="statusBarRight global-statusbar-right"></div>`);

    this.statusBar.append(this.statusBarLeft);
    this.statusBar.append(this.statusBarCenter);
    this.statusBar.append(this.statusBarRight);

    // Info indicator (always present in center)
    this.infoIndicator = $(
      `<div class="global-info-indicator css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div class="global-info-indicator-text"/></div>`
    );
    this.statusBarCenter.append(this.infoIndicator);

    // Preferences icon (always present in right section)
    this.preferencesIcon = $(
      `<div id="globalPreferencesIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="globalPreferencesIcon"><img id="globalPreferencesIconImage" class="indicator-image preferences-icon-overlay" src="${icons.preferencesOutline}"/></div></div>`
    );
    this.preferencesIcon.on('click', () => {
      $('#globalPreferencesIconImage').attr('src', icons.preferencesFilled);
      this.config.open();
    });
    this.statusBarRight.append(this.preferencesIcon);

    // Hide by default until an adapter activates
    this.statusBar.hide();
  }

  /**
   * Insert toolbar and status bar into the DOM
   */
  async insertIntoDOM() {
    const main = $(constants.MAIN_SELECTOR);
    if (!main.length) {
      console.warn('[UIManager] main[role="main"] not found');
      return;
    }

    // Find the scrollable content container within main
    // Bluesky's structure varies by page type. We need a container that:
    // 1. Is visible
    // 2. Has scrollable content
    // 3. Won't be replaced during SPA navigation

    // Strategy: insert directly into main's first child div
    // This is more stable than going deeper into the structure
    let contentContainer = main.find('> div').first();

    // Last resort: insert directly into main
    if (!contentContainer.length) {
      contentContainer = main;
    }

    // Insert toolbar at the start of the content
    contentContainer.prepend(this.toolbarDiv);

    // Insert status bar at the end (will be sticky positioned at bottom)
    contentContainer.append(this.statusBar);
  }

  /**
   * Set the current context and activate appropriate adapter
   * @param {string} contextName - Name of the context
   * @param {object} handler - The handler for this context (optional)
   */
  setContext(contextName, handler = null) {
    // Check if our elements are still in the DOM (SPA navigation may remove them)
    if (this.initialized && !$.contains(document, this.toolbarDiv[0])) {
      this.insertIntoDOM();
    }

    // Deactivate current adapter
    if (this.currentAdapter) {
      this.currentAdapter.deactivate();
    }

    this.currentContext = contextName;

    // Get adapter for this context, fallback to default
    this.currentAdapter = this.adapters.get(contextName) || this.adapters.get('default');

    if (this.currentAdapter) {
      this.currentAdapter.activate(handler);
    } else {
      // No adapter - show minimal UI
      this.showMinimalUI();
    }
  }

  /**
   * Show minimal UI when no adapter is available
   */
  showMinimalUI() {
    this.hideToolbarRow1();
    this.hideToolbarRow2();
    this.setInfoText('');
  }

  /**
   * Show/hide toolbar row 1 (indicators)
   */
  showToolbarRow1() {
    this.toolbarRow1.show();
  }

  hideToolbarRow1() {
    this.toolbarRow1.hide();
  }

  /**
   * Show/hide toolbar row 2 (search and controls)
   */
  showToolbarRow2() {
    this.toolbarRow2.show();
  }

  hideToolbarRow2() {
    this.toolbarRow2.hide();
  }

  /**
   * Set info text in status bar center
   * @param {string} html - HTML content to display
   */
  setInfoText(html) {
    this.infoIndicator.find('.global-info-indicator-text').html(html);
  }

  /**
   * Get toolbar row 1 element for adapter to populate
   */
  getToolbarRow1() {
    return this.toolbarRow1;
  }

  /**
   * Get toolbar row 2 element for adapter to populate
   */
  getToolbarRow2() {
    return this.toolbarRow2;
  }

  /**
   * Get status bar left section for adapter to populate
   */
  getStatusBarLeft() {
    return this.statusBarLeft;
  }

  /**
   * Get status bar right section for adapter to populate
   */
  getStatusBarRight() {
    return this.statusBarRight;
  }

  /**
   * Get the toolbar div for adding feed map or other elements
   */
  getToolbarDiv() {
    return this.toolbarDiv;
  }

  /**
   * Get the status bar element
   */
  getStatusBar() {
    return this.statusBar;
  }

  /**
   * Check if UIManager is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Reposition UI elements (call when DOM structure changes)
   */
  async reposition() {
    // Remove from current location
    this.toolbarDiv.detach();
    this.statusBar.detach();

    // Re-insert
    await this.insertIntoDOM();
  }

  /**
   * Clean up - remove UI elements from DOM
   */
  destroy() {
    if (this.toolbarDiv) {
      this.toolbarDiv.remove();
    }
    if (this.statusBar) {
      this.statusBar.remove();
    }
    this.initialized = false;
  }
}

export default UIManager;
