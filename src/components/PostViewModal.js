// PostViewModal.js - Full-screen post view modal with sidecar

import { announceToScreenReader, getAnimationDuration } from '../utils.js';

// Singleton instance
let instance = null;

/**
 * Creates and manages the full-screen post view modal (singleton)
 */
export class PostViewModal {
  constructor(config) {
    // Return existing instance if it exists
    if (instance) {
      instance.config = config;
      return instance;
    }

    this.config = config;
    this.isVisible = false;
    this.modalEl = null;
    this.previousActiveElement = null;

    instance = this;
  }

  /**
   * Show the modal with post content and sidecar
   * @param {HTMLElement} postElement - The post element to display
   * @param {string} sidecarHtml - HTML content for the sidecar
   */
  show(postElement, sidecarHtml) {
    if (this.isVisible) return;

    this.previousActiveElement = document.activeElement;
    this.isVisible = true;

    // Create modal
    this.modalEl = this.createModal(postElement, sidecarHtml);
    document.body.appendChild(this.modalEl);

    // Focus the close button
    const closeBtn = this.modalEl.querySelector('.post-view-modal-close');
    if (closeBtn) {
      closeBtn.focus();
    }

    // Announce to screen readers
    announceToScreenReader('Post view opened. Press Escape to close.');

    // Add escape listener
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

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

    document.removeEventListener('keydown', this.escapeHandler, true);
    announceToScreenReader('Post view closed.');
  }

  /**
   * Create the modal DOM element
   * @param {HTMLElement} postElement - The post element to clone
   * @param {string} sidecarHtml - HTML content for the sidecar
   */
  createModal(postElement, sidecarHtml) {
    const modal = document.createElement('div');
    modal.className = 'post-view-modal';
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

    modal.innerHTML = `
      <div class="post-view-modal-backdrop"></div>
      <div class="post-view-modal-content">
        <div class="post-view-modal-header">
          <h2 id="post-view-modal-title">Post View</h2>
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

    // Create modal
    this.modalEl = this.createReaderModal(contentHtml, title);
    document.body.appendChild(this.modalEl);

    // Focus the close button
    const closeBtn = this.modalEl.querySelector('.post-view-modal-close');
    if (closeBtn) {
      closeBtn.focus();
    }

    // Announce to screen readers
    announceToScreenReader('Reader view opened. Press Escape to close.');

    // Add escape listener
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

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

    modal.innerHTML = `
      <div class="post-view-modal-backdrop"></div>
      <div class="post-view-modal-content post-view-modal-content-reader">
        <div class="post-view-modal-header">
          <h2 id="post-view-modal-title">${title}</h2>
          <button class="post-view-modal-close" aria-label="Close">×</button>
        </div>
        <div class="post-view-modal-body post-view-modal-body-reader">
          <div class="post-view-modal-reader-content">
            ${contentHtml || '<div class="post-view-modal-loading">Loading thread...</div>'}
          </div>
        </div>
      </div>
    `;

    // Event listeners
    modal.querySelector('.post-view-modal-backdrop').addEventListener('click', () => this.hide());
    modal.querySelector('.post-view-modal-close').addEventListener('click', () => this.hide());

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
    }
  }

  /**
   * Check if modal is currently visible
   */
  get visible() {
    return this.isVisible;
  }
}
