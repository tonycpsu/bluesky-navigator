// ShortcutOverlay.js - Keyboard shortcuts help modal

import { announceToScreenReader, getAnimationDuration } from '../utils.js';

/**
 * Keyboard shortcuts organized by category and context.
 * Each category can specify which contexts it applies to:
 * - contexts: ['feed', 'post', 'profile'] = show in these contexts
 * - contexts: null or undefined = show in all contexts (global)
 */
const SHORTCUTS = {
  'Global Navigation': {
    contexts: null, // Show in all contexts
    shortcuts: [
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
  },
  Navigation: {
    contexts: null, // Show in all contexts
    shortcuts: [
      { keys: ['j'], description: 'Next item (mark read)' },
      { keys: ['k'], description: 'Previous item (mark read)' },
      { keys: ['↓'], description: 'Next item' },
      { keys: ['↑'], description: 'Previous item' },
      { keys: ['J'], description: 'Mark thread read, next post' },
      { keys: ['K'], description: 'Mark thread read, previous post' },
      { keys: ['PgDn'], description: 'Page down (multiple items)' },
      { keys: ['PgUp'], description: 'Page up (multiple items)' },
      { keys: ['Home'], description: 'Go to first item' },
      { keys: ['End'], description: 'Go to last item' },
      { keys: ['g', 'g'], description: 'Go to first item (vim)' },
      { keys: ['G'], description: 'Go to last item (vim)' },
      { keys: ['h'], description: 'Go back' },
      { keys: ['←', '→'], description: 'Toggle focus (post/replies)' },
    ],
  },
  'Post Actions': {
    contexts: ['feed', 'post', 'profile'], // Show on pages with posts
    shortcuts: [
      { keys: ['o', 'Enter'], description: 'Open post' },
      { keys: ['O'], description: 'Open inner post' },
      { keys: ['l'], description: 'Like/Unlike' },
      { keys: ['p'], description: 'Repost menu' },
      { keys: ['P'], description: 'Repost immediately' },
      { keys: ['r'], description: 'Reply' },
      { keys: ['f'], description: 'Follow author' },
      { keys: ['F'], description: 'Unfollow author' },
      { keys: ['+'], description: 'Add author to rules' },
      { keys: ['-'], description: 'Remove author from rules' },
      { keys: ['!'], description: 'Timeout author' },
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
  },
  'Feed Controls': {
    contexts: ['feed', 'profile'], // Feed and profile pages have feed controls
    shortcuts: [
      { keys: ['/'], description: 'Focus search' },
      { keys: ['u'], description: 'Load newer posts' },
      { keys: ['U'], description: 'Load older posts' },
      { keys: [':'], description: 'Toggle sort order' },
      { keys: ['"'], description: 'Toggle hide read' },
      { keys: [','], description: 'Refresh items' },
      { keys: ['.'], description: 'Toggle read status' },
    ],
  },
  'Quick Filters': {
    contexts: ['feed', 'profile'], // Filters apply to feeds
    shortcuts: [
      { keys: ['Alt+1-9'], description: 'Apply filter rule' },
      { keys: ['Alt+Shift+1-9'], description: 'Negate filter rule' },
      { keys: ['Alt+0'], description: 'Clear filter' },
    ],
  },
  'Profile Actions': {
    contexts: ['profile'], // Only on profile pages
    shortcuts: [
      { keys: ['f'], description: 'Follow' },
      { keys: ['F'], description: 'Unfollow' },
      { keys: ['L'], description: 'Add to list' },
      { keys: ['M'], description: 'Mute' },
      { keys: ['B'], description: 'Block' },
      { keys: ['R'], description: 'Report' },
    ],
  },
  Other: {
    contexts: null, // Show in all contexts
    shortcuts: [
      { keys: [';'], description: 'Expand sidecar' },
      { keys: ['x'], description: 'Dismiss oldest toast' },
      { keys: ['1-9'], description: 'Switch to tab' },
      { keys: ['?'], description: 'Show/hide this help' },
      { keys: ['Esc'], description: 'Close overlay' },
    ],
  },
};

// Context display names for the header
const CONTEXT_NAMES = {
  feed: 'Feed',
  post: 'Post',
  profile: 'Profile',
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
    this.ignoreNextQuestionMark = false;
    this.currentContext = null;

    instance = this;
  }

  /**
   * Toggle overlay visibility
   * @param {string} context - The current handler context ('feed', 'post', 'profile')
   */
  toggle(context) {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show(context);
    }
  }

  /**
   * Show the overlay
   * @param {string} context - The current handler context
   */
  show(context) {
    if (this.isVisible) return;

    this.currentContext = context;
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

    // Ignore the '?' key that opened this overlay (but allow Escape immediately)
    this.ignoreNextQuestionMark = true;

    // Add escape listener
    this.escapeHandler = (e) => {
      // Skip if this is the same '?' keydown that opened the overlay
      if (this.ignoreNextQuestionMark && e.key === '?') {
        this.ignoreNextQuestionMark = false;
        return;
      }
      this.ignoreNextQuestionMark = false;

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
      this.currentContext = null;

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

    const contextName = CONTEXT_NAMES[this.currentContext] || 'Page';
    const title = `Keyboard Shortcuts — ${contextName}`;

    overlay.innerHTML = `
      <div class="shortcut-overlay-backdrop"></div>
      <div class="shortcut-overlay-content">
        <div class="shortcut-overlay-header">
          <h2 id="shortcut-overlay-title">${title}</h2>
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
   * Check if a category should be shown for the current context
   */
  shouldShowCategory(category) {
    const contexts = category.contexts;
    // null/undefined means show in all contexts
    if (!contexts) return true;
    // Check if current context is in the list
    return contexts.includes(this.currentContext);
  }

  /**
   * Render all shortcut categories for the current context
   */
  renderCategories() {
    return Object.entries(SHORTCUTS)
      .filter(([, category]) => this.shouldShowCategory(category))
      .map(([name, category]) => `
        <div class="shortcut-category">
          <h3 class="shortcut-category-title">${name}</h3>
          <dl class="shortcut-list">
            ${category.shortcuts.map((s) => this.renderShortcut(s)).join('')}
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
