// NavigableList.js - Reusable keyboard navigation for lists of items

/**
 * Provides keyboard navigation for a list of items within a container.
 * Handles j/k/arrow keys, selection styling, and scroll-into-view.
 */
export class NavigableList {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.itemSelector - CSS selector for navigable items
   * @param {string} options.selectedClass - CSS class to add to selected item (default: 'modal-item-selected')
   * @param {HTMLElement} options.container - Container element to search within
   * @param {Function} options.onSelect - Callback when selection changes (receives element, index)
   */
  constructor(options = {}) {
    this.itemSelector = options.itemSelector;
    this.selectedClass = options.selectedClass || 'modal-item-selected';
    this.container = options.container;
    this.onSelect = options.onSelect;
    this.selectedIndex = 0;
  }

  /**
   * Get all navigable items
   * @returns {HTMLElement[]}
   */
  getItems() {
    if (!this.container) return [];
    return Array.from(this.container.querySelectorAll(this.itemSelector));
  }

  /**
   * Get currently selected item
   * @returns {HTMLElement|null}
   */
  getSelectedItem() {
    const items = this.getItems();
    return items[this.selectedIndex] || null;
  }

  /**
   * Navigate by direction
   * @param {number} direction - 1 for next, -1 for previous
   * @returns {boolean} - True if navigation occurred
   */
  navigate(direction) {
    const items = this.getItems();
    if (!items.length) return false;

    // Clear all selections first (handles stray selections)
    items.forEach(item => item.classList.remove(this.selectedClass));

    // Update index with bounds checking
    const newIndex = this.selectedIndex + direction;
    if (newIndex < 0) {
      this.selectedIndex = 0;
    } else if (newIndex >= items.length) {
      this.selectedIndex = items.length - 1;
    } else {
      this.selectedIndex = newIndex;
    }

    // Add selection to new item and scroll into view
    const newItem = items[this.selectedIndex];
    if (newItem) {
      newItem.classList.add(this.selectedClass);
      newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (this.onSelect) {
        this.onSelect(newItem, this.selectedIndex);
      }
    }

    return true;
  }

  /**
   * Jump to specific index
   * @param {number} index - Target index
   */
  jumpTo(index) {
    const items = this.getItems();
    if (!items.length) return;

    // Clear all selections first (handles stray selections)
    items.forEach(item => item.classList.remove(this.selectedClass));

    // Set new index with bounds checking
    this.selectedIndex = Math.max(0, Math.min(index, items.length - 1));

    // Add selection to new item
    const newItem = items[this.selectedIndex];
    if (newItem) {
      newItem.classList.add(this.selectedClass);
      newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (this.onSelect) {
        this.onSelect(newItem, this.selectedIndex);
      }
    }
  }

  /**
   * Jump to first item
   */
  jumpToFirst() {
    this.jumpTo(0);
  }

  /**
   * Jump to last item
   */
  jumpToLast() {
    const items = this.getItems();
    this.jumpTo(items.length - 1);
  }

  /**
   * Handle keyboard event
   * @param {KeyboardEvent} event
   * @returns {boolean} - True if event was handled
   */
  handleKeydown(event) {
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        this.navigate(1);
        return true;

      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        this.navigate(-1);
        return true;

      case 'Home':
        event.preventDefault();
        this.jumpToFirst();
        return true;

      case 'End':
        event.preventDefault();
        this.jumpToLast();
        return true;

      default:
        return false;
    }
  }

  /**
   * Update selection after items change (e.g., async content load)
   */
  updateSelection() {
    const items = this.getItems();
    // Clear any existing selections
    items.forEach(item => item.classList.remove(this.selectedClass));

    // Ensure index is within bounds
    if (this.selectedIndex >= items.length) {
      this.selectedIndex = Math.max(0, items.length - 1);
    }

    // Apply selection to current item
    const currentItem = items[this.selectedIndex];
    if (currentItem) {
      currentItem.classList.add(this.selectedClass);
    }
  }

  /**
   * Reset selection to first item
   */
  reset() {
    this.selectedIndex = 0;
    this.updateSelection();
  }
}
