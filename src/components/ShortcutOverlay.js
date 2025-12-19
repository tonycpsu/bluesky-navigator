// ShortcutOverlay.js - Keyboard shortcuts help modal

import { announceToScreenReader, getAnimationDuration } from '../utils.js';

/**
 * Keyboard shortcuts organized by category
 */
const SHORTCUTS = {
  'Global Navigation': [
    { keys: ['Alt+H'], description: 'Home' },
    { keys: ['Alt+E'], description: 'Explore (Search)' },
    { keys: ['Alt+S'], description: 'Saved' },
    { keys: ['Alt+N'], description: 'Notifications' },
    { keys: ['Alt+M'], description: 'Messages' },
    { keys: ['Alt+F'], description: 'Feeds' },
    { keys: ['Alt+L'], description: 'Lists' },
    { keys: ['Alt+P'], description: 'Profile' },
    { keys: ['Alt+,'], description: 'Settings' },
    { keys: ['Alt+.'], description: 'Extension preferences' },
  ],
  Navigation: [
    { keys: ['j', '↓'], description: 'Next item' },
    { keys: ['k', '↑'], description: 'Previous item' },
    { keys: ['PgDn'], description: 'Page down (multiple items)' },
    { keys: ['PgUp'], description: 'Page up (multiple items)' },
    { keys: ['Home'], description: 'Go to first item' },
    { keys: ['End'], description: 'Go to last item' },
    { keys: ['J'], description: 'Next unread item' },
    { keys: ['g', 'g'], description: 'Go to first item (vim)' },
    { keys: ['G'], description: 'Go to last item (vim)' },
    { keys: ['h'], description: 'Go back' },
    { keys: ['←', '→'], description: 'Toggle focus (post/replies)' },
  ],
  'Post Actions': [
    { keys: ['o', 'Enter'], description: 'Open post' },
    { keys: ['O'], description: 'Open inner post' },
    { keys: ['l'], description: 'Like/Unlike' },
    { keys: ['p'], description: 'Repost menu' },
    { keys: ['P'], description: 'Repost immediately' },
    { keys: ['r'], description: 'Reply' },
    { keys: ['R'], description: 'Add author to rules' },
    { keys: ['s'], description: 'Save/Unsave post' },
    { keys: ['S'], description: 'Share menu' },
    { keys: ['i'], description: 'Open first link' },
    { keys: ['m'], description: 'Toggle media/video' },
    { keys: ['c'], description: 'Screenshot to clipboard' },
    { keys: ['v'], description: 'Full-screen post view' },
    { keys: ['V'], description: 'Reader mode (thread)' },
    { keys: ['t'], description: 'Toggle thread context' },
    { keys: ['a'], description: 'Show author hover card' },
    { keys: ['A'], description: 'Open author profile' },
  ],
  'Feed Controls': [
    { keys: ['/'], description: 'Focus search' },
    { keys: ['u'], description: 'Load newer posts' },
    { keys: ['U'], description: 'Load older posts' },
    { keys: [':'], description: 'Toggle sort order' },
    { keys: ['"'], description: 'Toggle hide read' },
    { keys: [','], description: 'Refresh items' },
    { keys: ['.'], description: 'Toggle read status' },
  ],
  'Quick Filters': [
    { keys: ['Alt+1-9'], description: 'Apply filter rule' },
    { keys: ['Alt+Shift+1-9'], description: 'Negate filter rule' },
    { keys: ['Alt+0'], description: 'Clear filter' },
  ],
  Other: [
    { keys: [';'], description: 'Expand sidecar' },
    { keys: ['1-9'], description: 'Switch to tab' },
    { keys: ['?'], description: 'Show/hide this help' },
    { keys: ['Esc'], description: 'Close overlay' },
  ],
};

// Singleton instance
let instance = null;

/**
 * Creates and manages the keyboard shortcuts overlay (singleton)
 */
export class ShortcutOverlay {
  constructor(config) {
    // Return existing instance if it exists
    if (instance) {
      instance.config = config;
      return instance;
    }

    this.config = config;
    this.isVisible = false;
    this.overlayEl = null;
    this.previousActiveElement = null;
    this.ignoreNextKeydown = false;

    instance = this;
  }

  /**
   * Toggle overlay visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Show the overlay
   */
  show() {
    if (this.isVisible) return;

    this.previousActiveElement = document.activeElement;
    this.isVisible = true;

    // Create overlay
    this.overlayEl = this.createOverlay();
    document.body.appendChild(this.overlayEl);

    // Focus trap
    const firstFocusable = this.overlayEl.querySelector('.shortcut-overlay-close');
    if (firstFocusable) {
      firstFocusable.focus();
    }

    // Announce to screen readers
    announceToScreenReader('Keyboard shortcuts dialog opened. Press Escape to close.');

    // Ignore the current keydown event that opened this overlay
    this.ignoreNextKeydown = true;

    // Add escape listener
    this.escapeHandler = (e) => {
      // Skip if this is the same keydown that opened the overlay
      if (this.ignoreNextKeydown) {
        this.ignoreNextKeydown = false;
        return;
      }

      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);
  }

  /**
   * Hide the overlay
   */
  hide() {
    if (!this.isVisible || !this.overlayEl) return;

    const animDuration = getAnimationDuration(200, this.config);
    this.overlayEl.classList.add('shortcut-overlay-hiding');

    setTimeout(() => {
      if (this.overlayEl && this.overlayEl.parentNode) {
        this.overlayEl.parentNode.removeChild(this.overlayEl);
      }
      this.overlayEl = null;
      this.isVisible = false;

      // Restore focus
      if (this.previousActiveElement) {
        this.previousActiveElement.focus();
      }
    }, animDuration);

    document.removeEventListener('keydown', this.escapeHandler);
    announceToScreenReader('Keyboard shortcuts dialog closed.');
  }

  /**
   * Create the overlay DOM element
   */
  createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'shortcut-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'shortcut-overlay-title');

    overlay.innerHTML = `
      <div class="shortcut-overlay-backdrop"></div>
      <div class="shortcut-overlay-content">
        <div class="shortcut-overlay-header">
          <h2 id="shortcut-overlay-title">Keyboard Shortcuts</h2>
          <button class="shortcut-overlay-close" aria-label="Close">×</button>
        </div>
        <div class="shortcut-overlay-body">
          ${this.renderCategories()}
        </div>
        <div class="shortcut-overlay-footer">
          Press <kbd>?</kbd> or <kbd>Esc</kbd> to close
        </div>
      </div>
    `;

    // Event listeners
    overlay.querySelector('.shortcut-overlay-backdrop').addEventListener('click', () => this.hide());
    overlay.querySelector('.shortcut-overlay-close').addEventListener('click', () => this.hide());

    return overlay;
  }

  /**
   * Render all shortcut categories
   */
  renderCategories() {
    return Object.entries(SHORTCUTS)
      .map(([category, shortcuts]) => `
        <div class="shortcut-category">
          <h3 class="shortcut-category-title">${category}</h3>
          <dl class="shortcut-list">
            ${shortcuts.map((s) => this.renderShortcut(s)).join('')}
          </dl>
        </div>
      `)
      .join('');
  }

  /**
   * Render a single shortcut
   */
  renderShortcut({ keys, description }) {
    const keyHtml = keys.map((key) => `<kbd>${this.escapeHtml(key)}</kbd>`).join(' ');
    return `
      <div class="shortcut-item">
        <dt class="shortcut-keys">${keyHtml}</dt>
        <dd class="shortcut-desc">${this.escapeHtml(description)}</dd>
      </div>
    `;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
