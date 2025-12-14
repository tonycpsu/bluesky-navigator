/* global $ */

/**
 * FeedUIAdapter - Adapter for the home feed page
 *
 * For feed pages, FeedItemHandler has its own optimized toolbar/status bar.
 * This adapter hides UIManager's global elements to avoid duplication.
 * In a future refactor, this adapter can take over toolbar management.
 */
class FeedUIAdapter {
  constructor() {
    this.uiManager = null;
    this.handler = null;
  }

  /**
   * Set reference to UIManager
   */
  setUIManager(uiManager) {
    this.uiManager = uiManager;
  }

  /**
   * Activate this adapter - called when switching to feed context
   * @param {object} handler - The FeedItemHandler instance
   */
  activate(handler) {
    this.handler = handler;

    // Hide UIManager's toolbar/status bar on feed page
    // FeedItemHandler has its own optimized versions
    this.uiManager.getToolbarDiv().hide();
    this.uiManager.getStatusBar().hide();
  }

  /**
   * Deactivate this adapter - called when switching away from feed context
   */
  deactivate() {
    // Show UIManager's elements again when leaving feed
    this.uiManager.getToolbarDiv().show();
    this.uiManager.getStatusBar().show();
    this.handler = null;
  }
}

export default FeedUIAdapter;
