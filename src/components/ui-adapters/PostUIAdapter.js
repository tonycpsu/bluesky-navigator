/* global $ */

/**
 * PostUIAdapter - Adapter for post detail pages
 *
 * Shows minimal toolbar and displays post author info in status bar.
 */
class PostUIAdapter {
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
   * Activate this adapter - called when switching to post context
   * @param {object} handler - The PostItemHandler instance
   */
  activate(handler) {
    this.handler = handler;

    // Show status bar, hide toolbar (minimal UI for post pages)
    this.uiManager.getToolbarDiv().hide();
    this.uiManager.getStatusBar().show();

    // Hide toolbar rows
    this.uiManager.hideToolbarRow1();
    this.uiManager.hideToolbarRow2();

    // Clear status bar left section (right section has persistent preferences icon)
    this.uiManager.getStatusBarLeft().empty();

    // Update status bar with post info
    this.updateInfoText();
  }

  /**
   * Deactivate this adapter
   */
  deactivate() {
    this.handler = null;
  }

  /**
   * Update status bar with post info
   */
  updateInfoText() {
    // Extract author from URL: /profile/{handle}/post/{postId}
    const path = window.location.pathname;
    const match = path.match(/\/profile\/([^/]+)\/post\//);

    if (match) {
      const author = match[1];
      this.uiManager.setInfoText(`Post by @${author}`);
    } else {
      this.uiManager.setInfoText('Post detail');
    }
  }
}

export default PostUIAdapter;
