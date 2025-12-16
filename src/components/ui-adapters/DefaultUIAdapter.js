/* global $ */

/**
 * DefaultUIAdapter - Fallback adapter for pages without specific UI requirements
 *
 * Shows minimal UI: hidden toolbar rows, simple page name in status bar.
 * Used for notifications, search results, settings, and other pages.
 */
class DefaultUIAdapter {
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
   * Activate this adapter - called when switching to this context
   * @param {object} handler - The handler for this page (may be null)
   */
  activate(handler) {
    this.handler = handler;

    // Show status bar, hide toolbar (minimal UI)
    const toolbar = this.uiManager.getToolbarDiv();
    const statusBar = this.uiManager.getStatusBar();

    toolbar.hide();
    statusBar.show();

    // Hide toolbar rows
    this.uiManager.hideToolbarRow1();
    this.uiManager.hideToolbarRow2();

    // Hide thread context toggle/panel (only shown on feed/profile/post pages)
    $('#fixed-sidecar-toggle').removeClass('visible');
    $('#fixed-sidecar-panel').removeClass('visible');

    // Clear status bar left section (right section has persistent preferences icon)
    this.uiManager.getStatusBarLeft().empty();

    // Set simple info text based on page
    this.updateInfoText();
  }

  /**
   * Deactivate this adapter - called when switching away
   */
  deactivate() {
    this.handler = null;
  }

  /**
   * Update info text based on current page
   */
  updateInfoText() {
    // Try to determine page type from URL or DOM
    const path = window.location.pathname;
    let pageInfo = '';

    if (path.includes('/notifications')) {
      pageInfo = 'Notifications';
    } else if (path.includes('/search')) {
      pageInfo = 'Explore';
    } else if (path.includes('/settings')) {
      pageInfo = 'Settings';
    } else if (path.includes('/messages')) {
      pageInfo = 'Messages';
    } else if (path.includes('/lists')) {
      pageInfo = 'Lists';
    } else if (path.includes('/feeds')) {
      pageInfo = 'Feeds';
    } else if (path.includes('/saved') || path.includes('/bookmarks') || $('div[data-testid="bookmarksScreen"]').length) {
      pageInfo = 'Saved';
    } else {
      pageInfo = 'Bluesky';
    }

    this.uiManager.setInfoText(pageInfo);
  }
}

export default DefaultUIAdapter;
