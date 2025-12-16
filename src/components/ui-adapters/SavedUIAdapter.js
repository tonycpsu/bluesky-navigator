/* global $ */

/**
 * SavedUIAdapter - Adapter for saved/bookmarks page
 *
 * SavedItemHandler has its own toolbar (for search/filter).
 * Uses UIManager's fixed-position status bar for the feed map.
 */
class SavedUIAdapter {
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
   * Activate this adapter - called when switching to saved context
   * @param {object} handler - The SavedItemHandler instance
   */
  activate(handler) {
    this.handler = handler;

    // Hide UIManager's toolbar (SavedItemHandler has its own)
    this.uiManager.getToolbarDiv().hide();

    // Show UIManager's fixed-position status bar for feed map
    this.uiManager.getStatusBar().show();

    // Clear status bar sections for handler to populate
    this.uiManager.getStatusBarLeft().empty();

    // Set saved page info text
    this.uiManager.setInfoText('Saved Posts');

    // Give handler access to UIManager's status bar
    if (handler && handler.setUIManagerStatusBar) {
      handler.setUIManagerStatusBar(this.uiManager.getStatusBar(), this.uiManager.getStatusBarLeft());
    }
  }

  /**
   * Deactivate this adapter - called when switching away from saved context
   */
  deactivate() {
    // Clear any feed map elements added to UIManager's status bar
    const statusBar = this.uiManager.getStatusBar();
    statusBar.find('.feed-map-wrapper').remove();
    statusBar.removeClass('has-feed-map');

    // Show UIManager's elements again when leaving saved
    this.uiManager.getToolbarDiv().show();
    this.uiManager.getStatusBar().show();
    this.handler = null;
  }
}

export default SavedUIAdapter;
