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
    console.log('[DefaultUIAdapter] activate called, handler:', handler ? 'yes' : 'no');
    this.handler = handler;

    // Show status bar, hide toolbar (minimal UI)
    const toolbar = this.uiManager.getToolbarDiv();
    const statusBar = this.uiManager.getStatusBar();
    console.log('[DefaultUIAdapter] toolbar element:', toolbar.length, 'statusBar element:', statusBar.length);

    toolbar.hide();
    statusBar.show();
    console.log('[DefaultUIAdapter] statusBar display after show():', statusBar.css('display'));

    // Hide toolbar rows
    this.uiManager.hideToolbarRow1();
    this.uiManager.hideToolbarRow2();

    // Clear status bar left section (right section has persistent preferences icon)
    this.uiManager.getStatusBarLeft().empty();

    // Set simple info text based on page
    this.updateInfoText();

    // Debug: check status bar visibility
    const sb = this.uiManager.getStatusBar();
    console.log('[DefaultUIAdapter] StatusBar visible:', sb.is(':visible'));
    console.log('[DefaultUIAdapter] StatusBar position:', sb.offset());
    console.log('[DefaultUIAdapter] StatusBar dimensions:', sb.width(), 'x', sb.height());
    console.log('[DefaultUIAdapter] activation complete');
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
