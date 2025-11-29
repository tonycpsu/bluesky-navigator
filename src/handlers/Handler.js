// Handler.js - Base handler class for keyboard input handling

import { ShortcutOverlay } from '../components/ShortcutOverlay.js';

/**
 * Base handler class that provides keyboard binding and global navigation shortcuts.
 * All page-specific handlers extend from this class.
 */
export class Handler {
  constructor(name, config, state, api) {
    this.name = name;
    this.config = config;
    this.state = state;
    this.api = api;
    this.items = [];
    this.handleInput = this.handleInput.bind(this);
    this.shortcutOverlay = new ShortcutOverlay(config);
  }

  activate() {
    this.bindKeys();
  }

  deactivate() {
    this.unbindKeys();
  }

  isActive() {
    return true;
  }

  bindKeys() {
    document.addEventListener('keydown', this.handleInput, true);
  }

  unbindKeys() {
    document.removeEventListener('keydown', this.handleInput, true);
  }

  handleInput(event) {
    if (event.altKey && !event.metaKey) {
      if (event.code === 'KeyH') {
        event.preventDefault();
        $("nav a[aria-label='Home']")[0].click();
      } else if (event.code === 'KeyS') {
        event.preventDefault();
        $("nav a[aria-label='Search']")[0].click();
      } else if (event.code === 'KeyN') {
        event.preventDefault();
        $("nav a[aria-label='Notifications']")[0].click();
      } else if (event.code === 'KeyM') {
        event.preventDefault();
        $("nav a[aria-label='Chat']")[0].click();
      } else if (event.code === 'KeyF') {
        event.preventDefault();
        $("nav a[aria-label='Feeds']")[0].click();
      } else if (event.code === 'KeyL') {
        event.preventDefault();
        $("nav a[aria-label='Lists']")[0].click();
      } else if (event.code === 'KeyP') {
        event.preventDefault();
        $("nav a[aria-label='Profile']")[0].click();
      } else if (event.code === 'Comma') {
        event.preventDefault();
        $("nav a[aria-label='Settings']")[0].click();
      } else if (event.code === 'Period') {
        event.preventDefault();
        this.config.open();
      } else if (event.code === 'Enter' && $('#GM_config').is(':visible')) {
        event.preventDefault();
        this.config.save();
      }
    } else if (!event.altKey && !event.metaKey) {
      if (event.code == 'Escape' && $('#GM_config').is(':visible')) {
        event.preventDefault();
        this.config.close();
      } else if (event.key === '?') {
        event.preventDefault();
        this.shortcutOverlay.toggle();
      }
    }
  }
}
