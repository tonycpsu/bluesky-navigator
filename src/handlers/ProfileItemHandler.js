// ProfileItemHandler.js - Handler for user profile pages

import { FeedItemHandler } from './FeedItemHandler.js';

/**
 * Handler for profile pages with profile-specific actions (follow, mute, block, etc.).
 */
export class ProfileItemHandler extends FeedItemHandler {
  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
  }

  activate() {
    this.setIndex(0);
    super.activate();
  }

  deactivate() {
    super.deactivate();
  }

  isActive() {
    return window.location.pathname.match(/^\/profile\//);
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
