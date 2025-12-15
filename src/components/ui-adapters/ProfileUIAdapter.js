/* global $ */

/**
 * ProfileUIAdapter - Adapter for profile pages
 *
 * Uses UIManager's fixed-position status bar for the feed map,
 * while ProfileItemHandler manages its own toolbar (for search/filter).
 */
class ProfileUIAdapter {
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
   * Activate this adapter - called when switching to profile context
   * @param {object} handler - The ProfileItemHandler instance
   */
  activate(handler) {
    console.log('[ProfileUIAdapter] activate called', { handler: handler?.name, hasMethod: !!handler?.setUIManagerStatusBar });
    this.handler = handler;

    // Hide UIManager's toolbar (ProfileItemHandler has its own for search/filter)
    this.uiManager.getToolbarDiv().hide();

    // Show UIManager's fixed-position status bar for feed map
    this.uiManager.getStatusBar().show();

    // Clear status bar sections for handler to populate
    this.uiManager.getStatusBarLeft().empty();

    // Set profile info text
    this.updateInfoText();

    // Give handler access to UIManager's status bar
    if (handler && handler.setUIManagerStatusBar) {
      console.log('[ProfileUIAdapter] Calling handler.setUIManagerStatusBar');
      handler.setUIManagerStatusBar(this.uiManager.getStatusBar(), this.uiManager.getStatusBarLeft());
    } else {
      console.log('[ProfileUIAdapter] handler or setUIManagerStatusBar not available');
    }
  }

  /**
   * Update info text with profile username
   */
  updateInfoText() {
    const path = window.location.pathname;
    const match = path.match(/\/profile\/([^/]+)/);
    if (match) {
      const handle = match[1];
      // Handle might be a DID or a username
      const displayName = handle.startsWith('did:') ? '' : `@${handle}`;
      this.uiManager.setInfoText(`Profile: ${displayName}`.trim());
    } else {
      this.uiManager.setInfoText('Profile');
    }
  }

  /**
   * Deactivate this adapter - called when switching away from profile context
   */
  deactivate() {
    // Clear any feed map elements added to UIManager's status bar
    const statusBar = this.uiManager.getStatusBar();
    statusBar.find('.feed-map-wrapper').remove();
    statusBar.removeClass('has-feed-map');

    // Show UIManager's elements again when leaving profile
    this.uiManager.getToolbarDiv().show();
    this.uiManager.getStatusBar().show();
    this.handler = null;
  }
}

export default ProfileUIAdapter;
