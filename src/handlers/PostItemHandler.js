// PostItemHandler.js - Handler for individual post/thread pages

import { ItemHandler } from './ItemHandler.js';
import { isUserTyping, isModalOpen } from '../utils.js';

/**
 * Handler for viewing individual posts and their thread replies.
 */
export class PostItemHandler extends ItemHandler {
  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
    this.indexMap = {};
    this.handleInput = this.handleInput.bind(this);
  }

  get index() {
    return this.indexMap?.[this.postId] ?? 0;
  }

  set index(value) {
    this.indexMap[this.postId] = value;
  }

  activate() {
    super.activate();
    this.postId = this.postIdFromUrl();
  }

  deactivate() {
    super.deactivate();
  }

  isActive() {
    return window.location.pathname.match(/\/post\//);
  }

  get scrollMargin() {
    return $('div[data-testid="postThreadScreen"] > div:visible').eq(0).outerHeight();
  }

  handleInput(event) {
    // Skip processing when user is typing in an input field
    if (isUserTyping()) {
      return true; // Return true to signal callers to also skip
    }

    // Skip processing when a modal dialog is open
    if (isModalOpen()) {
      return true;
    }

    const item = this.selectedItem;

    if (['o', 'Enter'].includes(event.key) && !(event.altKey || event.metaKey)) {
      const inner = $(item).find("div[aria-label^='Post by']");
      inner.click();
    }

    if (super.handleInput(event)) {
      return;
    }

    if (this.isPopupVisible || event.altKey || event.metaKey) {
      return;
    }

    if (event.key == 'A') {
      // Go to author's profile
      const handle = $.trim($(item).attr('data-testid').split('postThreadItem-by-')[1]);
      $(item)
        .find('div')
        .filter(
          (i, el) =>
            $.trim($(el).text()).replace(/[\u200E\u200F\u202A-\u202E]/g, '') == `@${handle}`
        )[0]
        .click();
    } else if (event.key == 'a') {
      // Show/hide author hover card by simulating mouse hover
      this.toggleAuthorHoverCard(item);
    }
  }
}
