// BottomSheet.js - Mobile action sheet component

import { announceToScreenReader, getAnimationDuration } from '../utils.js';

/**
 * Bottom sheet component for mobile actions
 * Triggered by long press on posts
 */
export class BottomSheet {
  constructor(config, itemHandler) {
    this.config = config;
    this.itemHandler = itemHandler;
    this.isVisible = false;
    this.sheetElement = null;
    this.backdropElement = null;
    this.currentItem = null;
    this.longPressTimer = null;
    this.longPressDuration = 500; // ms
    this.startX = 0;
    this.startY = 0;
    this.moveThreshold = 10; // pixels of movement to cancel long press

    this.handleLongPressStart = this.handleLongPressStart.bind(this);
    this.handleLongPressMove = this.handleLongPressMove.bind(this);
    this.handleLongPressEnd = this.handleLongPressEnd.bind(this);
    this.hide = this.hide.bind(this);
  }

  /**
   * Initialize long press detection on an item
   */
  init(item) {
    if (!item) return;

    item.addEventListener('touchstart', this.handleLongPressStart, { passive: true });
    item.addEventListener('touchend', this.handleLongPressEnd, { passive: true });
    item.addEventListener('touchmove', this.handleLongPressMove, { passive: true });
    item.addEventListener('touchcancel', this.handleLongPressEnd, { passive: true });
  }

  /**
   * Remove long press detection from an item
   */
  destroy(item) {
    if (!item) return;

    item.removeEventListener('touchstart', this.handleLongPressStart);
    item.removeEventListener('touchend', this.handleLongPressEnd);
    item.removeEventListener('touchmove', this.handleLongPressMove);
    item.removeEventListener('touchcancel', this.handleLongPressEnd);
  }

  handleLongPressStart(e) {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.currentItem = e.currentTarget;

    this.longPressTimer = setTimeout(() => {
      this.show(this.currentItem);
    }, this.longPressDuration);
  }

  handleLongPressMove(e) {
    if (!this.longPressTimer || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - this.startX);
    const deltaY = Math.abs(touch.clientY - this.startY);

    // Cancel long press if finger moved beyond threshold
    if (deltaX > this.moveThreshold || deltaY > this.moveThreshold) {
      this.handleLongPressEnd();
    }
  }

  handleLongPressEnd() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Show the bottom sheet for an item
   */
  show(item) {
    if (this.isVisible) return;

    this.currentItem = item;
    this.isVisible = true;

    // Create backdrop
    this.backdropElement = document.createElement('div');
    this.backdropElement.className = 'bottom-sheet-backdrop';
    this.backdropElement.addEventListener('click', this.hide);

    // Create sheet
    this.sheetElement = this.createSheet();

    document.body.appendChild(this.backdropElement);
    document.body.appendChild(this.sheetElement);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
      this.backdropElement.classList.add('bottom-sheet-backdrop-visible');
      this.sheetElement.classList.add('bottom-sheet-visible');
    });

    announceToScreenReader('Action sheet opened. Select an action or tap outside to close.');
  }

  /**
   * Hide the bottom sheet
   */
  hide() {
    if (!this.isVisible) return;

    const animDuration = getAnimationDuration(200, this.config);

    this.backdropElement.classList.remove('bottom-sheet-backdrop-visible');
    this.sheetElement.classList.remove('bottom-sheet-visible');

    setTimeout(() => {
      if (this.backdropElement && this.backdropElement.parentNode) {
        this.backdropElement.parentNode.removeChild(this.backdropElement);
      }
      if (this.sheetElement && this.sheetElement.parentNode) {
        this.sheetElement.parentNode.removeChild(this.sheetElement);
      }
      this.backdropElement = null;
      this.sheetElement = null;
      this.isVisible = false;

      // Restore body scroll
      document.body.style.overflow = '';
    }, animDuration);

    announceToScreenReader('Action sheet closed.');
  }

  /**
   * Create the sheet DOM element
   */
  createSheet() {
    const sheet = document.createElement('div');
    sheet.className = 'bottom-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Post actions');

    const actions = this.getActions();

    sheet.innerHTML = `
      <div class="bottom-sheet-handle"></div>
      <div class="bottom-sheet-content">
        ${actions.map(action => `
          <button class="bottom-sheet-action" data-action="${action.id}">
            <span class="bottom-sheet-action-icon">${action.icon}</span>
            <span class="bottom-sheet-action-label">${action.label}</span>
          </button>
        `).join('')}
      </div>
      <button class="bottom-sheet-cancel">Cancel</button>
    `;

    // Event listeners
    sheet.querySelector('.bottom-sheet-cancel').addEventListener('click', this.hide);

    sheet.querySelectorAll('.bottom-sheet-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const actionId = e.currentTarget.dataset.action;
        this.executeAction(actionId);
        this.hide();
      });
    });

    return sheet;
  }

  /**
   * Get available actions for the current item
   */
  getActions() {
    return [
      {
        id: 'like',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        label: 'Like'
      },
      {
        id: 'repost',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
        label: 'Repost'
      },
      {
        id: 'reply',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
        label: 'Reply'
      },
      {
        id: 'open',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
        label: 'Open post'
      },
      {
        id: 'markRead',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
        label: 'Mark as read'
      },
      {
        id: 'screenshot',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
        label: 'Screenshot'
      }
    ];
  }

  /**
   * Execute an action
   */
  executeAction(actionId) {
    if (!this.currentItem || !this.itemHandler) return;

    switch (actionId) {
      case 'like':
        this.itemHandler.likePost(this.currentItem);
        break;
      case 'repost':
        // Trigger repost menu
        $(this.currentItem).find('button[data-testid="repostBtn"]').click();
        break;
      case 'reply':
        // Trigger reply
        $(this.currentItem).find('button[data-testid="replyBtn"]').click();
        break;
      case 'open':
        this.itemHandler.openItem(this.currentItem);
        break;
      case 'markRead':
        $(this.currentItem).removeClass('item-unread').addClass('item-read');
        this.itemHandler.markItemRead(this.currentItem);
        announceToScreenReader('Marked as read');
        break;
      case 'screenshot':
        this.itemHandler.captureScreenshot(this.currentItem);
        break;
    }
  }
}
