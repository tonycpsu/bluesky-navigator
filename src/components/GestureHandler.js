// GestureHandler.js - Touch gesture detection for mobile

import { announceToScreenReader, getAnimationDuration } from '../utils.js';

/**
 * Handles swipe gestures on feed items
 * - Swipe right: Like post
 * - Swipe left: Mark as read and dismiss
 */
export class GestureHandler {
  constructor(config, itemHandler) {
    this.config = config;
    this.itemHandler = itemHandler;
    this.minSwipeDistance = 50;
    this.swipeThreshold = 0.3; // 30% of item width triggers action
    this.activeElement = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.isHorizontalSwipe = null;

    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
  }

  /**
   * Initialize gesture handling on an item
   */
  init(item) {
    if (!item) return;

    item.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    item.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    item.addEventListener('touchend', this.handleTouchEnd, { passive: true });
  }

  /**
   * Remove gesture handling from an item
   */
  destroy(item) {
    if (!item) return;

    item.removeEventListener('touchstart', this.handleTouchStart);
    item.removeEventListener('touchmove', this.handleTouchMove);
    item.removeEventListener('touchend', this.handleTouchEnd);
  }

  handleTouchStart(e) {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.currentX = touch.clientX;
    this.activeElement = e.currentTarget;
    this.isHorizontalSwipe = null;

    // Add swipe indicator containers
    this.createSwipeIndicators();
  }

  handleTouchMove(e) {
    if (!this.activeElement || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;

    // Determine swipe direction on first significant move
    if (this.isHorizontalSwipe === null && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      this.isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
    }

    // Only handle horizontal swipes
    if (this.isHorizontalSwipe) {
      e.preventDefault();
      this.currentX = touch.clientX;

      // Visual feedback - translate the item
      const translateX = Math.max(-100, Math.min(100, deltaX * 0.5));
      this.activeElement.style.transform = `translateX(${translateX}px)`;
      this.activeElement.style.transition = 'none';

      // Show action indicator
      this.updateSwipeIndicators(deltaX);
    }
  }

  handleTouchEnd(e) {
    if (!this.activeElement) return;

    const deltaX = this.currentX - this.startX;
    const itemWidth = this.activeElement.offsetWidth;
    const swipeRatio = Math.abs(deltaX) / itemWidth;

    // Reset transform with animation
    const animDuration = getAnimationDuration(200, this.config);
    this.activeElement.style.transition = `transform ${animDuration}ms ease-out`;
    this.activeElement.style.transform = '';

    // Check if swipe was significant enough
    if (this.isHorizontalSwipe && swipeRatio >= this.swipeThreshold) {
      if (deltaX > this.minSwipeDistance) {
        // Swipe right - Like
        this.onSwipeRight();
      } else if (deltaX < -this.minSwipeDistance) {
        // Swipe left - Mark read and dismiss
        this.onSwipeLeft();
      }
    }

    // Cleanup
    this.removeSwipeIndicators();
    this.activeElement = null;
    this.isHorizontalSwipe = null;
  }

  onSwipeRight() {
    // Like the post
    if (this.itemHandler && this.itemHandler.likePost) {
      this.itemHandler.likePost(this.activeElement);
      announceToScreenReader('Post liked');
    }
  }

  onSwipeLeft() {
    // Mark as read and jump to next
    if (this.itemHandler) {
      $(this.activeElement).removeClass('item-unread').addClass('item-read');
      this.itemHandler.markItemRead(this.activeElement);

      // Animate out and jump to next
      const animDuration = getAnimationDuration(200, this.config);
      $(this.activeElement).css({
        transition: `transform ${animDuration}ms ease-out, opacity ${animDuration}ms ease-out`,
        transform: 'translateX(-100%)',
        opacity: 0
      });

      setTimeout(() => {
        $(this.activeElement).css({
          transform: '',
          opacity: ''
        });
        this.itemHandler.jumpToNextUnseenItem();
      }, animDuration);

      announceToScreenReader('Post marked as read');
    }
  }

  createSwipeIndicators() {
    if (!this.activeElement) return;

    // Create left indicator (dismiss)
    const leftIndicator = document.createElement('div');
    leftIndicator.className = 'swipe-indicator swipe-indicator-left';
    leftIndicator.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;

    // Create right indicator (like)
    const rightIndicator = document.createElement('div');
    rightIndicator.className = 'swipe-indicator swipe-indicator-right';
    rightIndicator.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>
    `;

    // Position relative to item
    this.activeElement.style.position = 'relative';
    this.activeElement.insertBefore(leftIndicator, this.activeElement.firstChild);
    this.activeElement.insertBefore(rightIndicator, this.activeElement.firstChild);
  }

  updateSwipeIndicators(deltaX) {
    const leftIndicator = this.activeElement?.querySelector('.swipe-indicator-left');
    const rightIndicator = this.activeElement?.querySelector('.swipe-indicator-right');

    if (leftIndicator) {
      leftIndicator.classList.toggle('swipe-indicator-active', deltaX < -this.minSwipeDistance);
    }
    if (rightIndicator) {
      rightIndicator.classList.toggle('swipe-indicator-active', deltaX > this.minSwipeDistance);
    }
  }

  removeSwipeIndicators() {
    if (!this.activeElement) return;

    this.activeElement.querySelectorAll('.swipe-indicator').forEach(el => el.remove());
  }
}
