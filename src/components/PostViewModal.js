// PostViewModal.js - Full-screen post view modal with sidecar

import { announceToScreenReader, getAnimationDuration } from '../utils.js';
import { NavigableList } from '../utils/NavigableList.js';

// Singleton instance
let instance = null;

/**
 * Creates and manages the full-screen post view modal (singleton)
 */
export class PostViewModal {
  constructor(config, onClose) {
    // Return existing instance if it exists
    if (instance) {
      instance.config = config;
      instance.onClose = onClose;
      return instance;
    }

    this.config = config;
    this.onClose = onClose;
    this.isVisible = false;
    this.modalEl = null;
    this.previousActiveElement = null;
    this.isReaderMode = false;
    this.navList = null;

    instance = this;
  }

  /**
   * Show the modal with post content and sidecar
   * @param {HTMLElement} postElement - The post element to display
   * @param {string} sidecarHtml - HTML content for the sidecar
   * @param {boolean} isUnrolledThread - Whether this is an unrolled thread (navigate posts, not replies)
   */
  show(postElement, sidecarHtml, isUnrolledThread = false) {
    if (this.isVisible) return;

    this.previousActiveElement = document.activeElement;
    this.isVisible = true;
    this.isReaderMode = false;
    this.isUnrolledThread = isUnrolledThread;

    // Create modal
    this.modalEl = this.createModal(postElement, sidecarHtml, isUnrolledThread);
    document.body.appendChild(this.modalEl);

    // Set up navigation lists
    if (isUnrolledThread) {
      // For unrolled threads, create two nav lists: one for posts, one for sidecar
      this.threadNavList = new NavigableList({
        itemSelector: 'div[data-testid="contentHider-post"], .unrolled-reply',
        container: this.modalEl.querySelector('.post-view-modal-post'),
        selectedClass: 'modal-item-selected',
      });
      this.sidecarNavList = new NavigableList({
        itemSelector: '.sidecar-post',
        container: this.modalEl.querySelector('.post-view-modal-sidecar'),
        selectedClass: 'modal-item-selected',
      });
      // Start with thread focused
      this.navList = this.threadNavList;
      this.focusedPane = 'thread';
    } else {
      // For regular posts, just navigate sidecar replies
      this.navList = new NavigableList({
        itemSelector: '.sidecar-post',
        container: this.modalEl,
        selectedClass: 'modal-item-selected',
      });
      this.threadNavList = null;
      this.sidecarNavList = null;
      this.focusedPane = 'sidecar';
    }

    // Focus the close button
    const closeBtn = this.modalEl.querySelector('.post-view-modal-close');
    if (closeBtn) {
      closeBtn.focus();
    }

    // Announce to screen readers
    const navTarget = isUnrolledThread ? 'posts (left/right to switch to replies)' : 'replies';
    announceToScreenReader(`Post view opened. Press Escape to close, j/k to navigate ${navTarget}.`);

    // Add keyboard listener
    this.keyHandler = (e) => this.handleKeydown(e);
    document.addEventListener('keydown', this.keyHandler, true);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  /**
   * Hide the modal
   */
  hide() {
    if (!this.isVisible || !this.modalEl) return;

    const animDuration = getAnimationDuration(200, this.config);
    this.modalEl.classList.add('post-view-modal-hiding');

    // Call onClose callback immediately so feed handler can receive keys again
    if (this.onClose) {
      this.onClose();
    }

    setTimeout(() => {
      if (this.modalEl && this.modalEl.parentNode) {
        this.modalEl.parentNode.removeChild(this.modalEl);
      }
      this.modalEl = null;
      this.isVisible = false;

      // Restore body scroll
      document.body.style.overflow = '';

      // Restore focus
      if (this.previousActiveElement) {
        this.previousActiveElement.focus();
      }
    }, animDuration);

    document.removeEventListener('keydown', this.keyHandler, true);
    announceToScreenReader('Post view closed.');
  }

  /**
   * Create the modal DOM element
   * @param {HTMLElement} postElement - The post element to clone
   * @param {string} sidecarHtml - HTML content for the sidecar
   * @param {boolean} isUnrolledThread - Whether this is an unrolled thread
   */
  createModal(postElement, sidecarHtml, isUnrolledThread = false) {
    const modal = document.createElement('div');
    modal.className = 'post-view-modal';
    if (isUnrolledThread) {
      modal.classList.add('post-view-modal-thread');
    }
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'post-view-modal-title');

    // Clone the post content
    const postClone = postElement.cloneNode(true);
    // Remove any existing selection styling and feed-related attributes from clone
    // This prevents the cloned element from being matched by feed item selectors
    postClone.classList.remove('selected', 'item', 'item-selection-active', 'item-selection-inactive', 'item-read', 'item-unread');
    postClone.classList.add('post-view-modal-cloned-post');
    postClone.removeAttribute('data-bsky-navigator-item-index');
    postClone.removeAttribute('data-bsky-navigator-thread-offset');
    postClone.removeAttribute('data-testid');
    postClone.removeAttribute('tabindex');
    postClone.removeAttribute('role');
    postClone.style.border = 'none';
    postClone.style.width = '100%';
    postClone.style.maxWidth = '100%';
    postClone.style.opacity = '1';

    const title = isUnrolledThread ? 'Thread View' : 'Post View';

    modal.innerHTML = `
      <div class="post-view-modal-backdrop"></div>
      <div class="post-view-modal-content">
        <div class="post-view-modal-header">
          <h2 id="post-view-modal-title">${title}</h2>
          <button class="post-view-modal-close" aria-label="Close">×</button>
        </div>
        <div class="post-view-modal-body">
          <div class="post-view-modal-post"></div>
          <div class="post-view-modal-sidecar"></div>
        </div>
      </div>
    `;

    // Insert cloned post
    const postContainer = modal.querySelector('.post-view-modal-post');
    postContainer.appendChild(postClone);

    // Insert sidecar content
    const sidecarContainer = modal.querySelector('.post-view-modal-sidecar');
    if (sidecarHtml) {
      sidecarContainer.innerHTML = sidecarHtml;
    } else {
      sidecarContainer.innerHTML = '<div class="post-view-modal-loading">Loading replies...</div>';
    }

    // Event listeners
    modal.querySelector('.post-view-modal-backdrop').addEventListener('click', () => this.hide());
    modal.querySelector('.post-view-modal-close').addEventListener('click', () => this.hide());

    return modal;
  }

  /**
   * Update the sidecar content (for async loading)
   * @param {string} sidecarHtml - HTML content for the sidecar
   */
  updateSidecar(sidecarHtml) {
    if (!this.modalEl) return;
    const sidecarContainer = this.modalEl.querySelector('.post-view-modal-sidecar');
    if (sidecarContainer) {
      sidecarContainer.innerHTML = sidecarHtml;

      // Recreate sidecar nav list now that content is loaded
      if (this.isUnrolledThread) {
        this.sidecarNavList = new NavigableList({
          itemSelector: '.sidecar-post',
          container: sidecarContainer,
          selectedClass: 'modal-item-selected',
        });
        // If sidecar is currently focused, update the navList reference
        if (this.focusedPane === 'sidecar') {
          this.navList = this.sidecarNavList;
        }
      }

      // Update navigation after content loads
      this.updateSelection();
    }
  }

  /**
   * Show the modal in reader mode (full width, no sidecar)
   * @param {string} contentHtml - HTML content for the reader view
   * @param {string} title - Title for the modal header
   */
  showReaderMode(contentHtml, title = 'Reader View') {
    if (this.isVisible) return;

    this.previousActiveElement = document.activeElement;
    this.isVisible = true;
    this.isReaderMode = true;

    // Create modal
    this.modalEl = this.createReaderModal(contentHtml, title);
    document.body.appendChild(this.modalEl);

    // Set up navigation for reader mode posts
    this.navList = new NavigableList({
      itemSelector: '.reader-mode-post',
      container: this.modalEl,
      selectedClass: 'modal-item-selected',
    });

    // Focus the close button
    const closeBtn = this.modalEl.querySelector('.post-view-modal-close');
    if (closeBtn) {
      closeBtn.focus();
    }

    // Announce to screen readers
    announceToScreenReader('Reader view opened. Press Escape to close, j/k to navigate posts.');

    // Add keyboard listener
    this.keyHandler = (e) => this.handleKeydown(e);
    document.addEventListener('keydown', this.keyHandler, true);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  /**
   * Create the reader mode modal DOM element
   * @param {string} contentHtml - HTML content for the reader view
   * @param {string} title - Title for the modal header
   */
  createReaderModal(contentHtml, title) {
    const modal = document.createElement('div');
    modal.className = 'post-view-modal post-view-modal-reader';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'post-view-modal-title');

    const fontSize = this.config.get('readerModeFontSize') || 16;

    modal.innerHTML = `
      <div class="post-view-modal-backdrop"></div>
      <div class="post-view-modal-content post-view-modal-content-reader">
        <div class="post-view-modal-header">
          <h2 id="post-view-modal-title">${title}</h2>
          <div class="reader-mode-font-controls">
            <button class="reader-mode-font-btn" data-action="decrease" aria-label="Decrease font size">−</button>
            <input type="number" class="reader-mode-font-input" value="${fontSize}" min="10" max="32" aria-label="Font size">
            <button class="reader-mode-font-btn" data-action="increase" aria-label="Increase font size">+</button>
          </div>
          <button class="post-view-modal-close" aria-label="Close">×</button>
        </div>
        <div class="post-view-modal-body post-view-modal-body-reader">
          <div class="post-view-modal-reader-content" style="font-size: ${fontSize}px;">
            ${contentHtml || '<div class="post-view-modal-loading">Loading thread...</div>'}
          </div>
        </div>
      </div>
    `;

    // Event listeners
    modal.querySelector('.post-view-modal-backdrop').addEventListener('click', () => this.hide());
    modal.querySelector('.post-view-modal-close').addEventListener('click', () => this.hide());

    // Font size controls
    const fontInput = modal.querySelector('.reader-mode-font-input');
    const contentEl = modal.querySelector('.post-view-modal-reader-content');

    modal.querySelectorAll('.reader-mode-font-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let newSize = parseInt(fontInput.value, 10);
        if (action === 'increase') {
          newSize = Math.min(32, newSize + 1);
        } else {
          newSize = Math.max(10, newSize - 1);
        }
        fontInput.value = newSize;
        contentEl.style.fontSize = `${newSize}px`;
        this.config.set('readerModeFontSize', newSize);
        announceToScreenReader(`Font size: ${newSize} pixels`);
      });
    });

    fontInput.addEventListener('change', () => {
      let newSize = parseInt(fontInput.value, 10);
      newSize = Math.max(10, Math.min(32, newSize));
      fontInput.value = newSize;
      contentEl.style.fontSize = `${newSize}px`;
      this.config.set('readerModeFontSize', newSize);
    });

    return modal;
  }

  /**
   * Update the reader mode content (for async loading)
   * @param {string} contentHtml - HTML content for the reader view
   */
  updateReaderContent(contentHtml) {
    if (!this.modalEl) return;
    const contentContainer = this.modalEl.querySelector('.post-view-modal-reader-content');
    if (contentContainer) {
      contentContainer.innerHTML = contentHtml;
      // Update navigation after content loads
      this.updateSelection();
    }
  }

  /**
   * Check if modal is currently visible
   */
  get visible() {
    return this.isVisible;
  }

  /**
   * Handle keyboard events for navigation
   * @param {KeyboardEvent} e - The keyboard event
   */
  handleKeydown(e) {
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.hide();
      return;
    }

    // Left/right to switch panes (only in thread view)
    if (this.isUnrolledThread && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'h' || e.key === 'l')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.switchPane(e.key === 'ArrowLeft' || e.key === 'h' ? 'thread' : 'sidecar');
      return;
    }

    // Intercept all navigation keys to prevent feed handler from receiving them
    const navKeys = ['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (navKeys.includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (this.navList) {
        this.navList.handleKeydown(e);
      }
    }
  }

  /**
   * Switch focus between thread and sidecar panes
   * @param {string} pane - 'thread' or 'sidecar'
   */
  switchPane(pane) {
    if (!this.isUnrolledThread || this.focusedPane === pane) return;

    // Clear selection on current pane
    const currentItems = this.navList.getItems();
    currentItems.forEach(item => item.classList.remove('modal-item-selected'));

    // Switch to new pane
    this.focusedPane = pane;
    this.navList = pane === 'thread' ? this.threadNavList : this.sidecarNavList;

    // Update selection on new pane
    this.navList.updateSelection();

    // Announce to screen readers
    const target = pane === 'thread' ? 'thread posts' : 'replies';
    announceToScreenReader(`Now navigating ${target}.`);
  }

  /**
   * Update selection styling after content loads
   */
  updateSelection() {
    if (this.navList) {
      this.navList.updateSelection();
    }
  }
}
