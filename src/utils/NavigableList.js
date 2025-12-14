// NavigableList.js - Reusable keyboard navigation for lists of items

/**
 * Provides keyboard navigation for a list of items.
 * Handles selection tracking, styling, and optional scroll-into-view.
 *
 * Supports two modes:
 * 1. Selector-based: provide `itemSelector` and `container` to query items dynamically
 * 2. Callback-based: provide `getItems` function to retrieve items (for pre-loaded arrays)
 */
export class NavigableList {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.itemSelector] - CSS selector for navigable items (selector mode)
   * @param {HTMLElement} [options.container] - Container element to search within (selector mode)
   * @param {Function} [options.getItems] - Callback returning array of items (callback mode)
   * @param {string} [options.selectedClass] - CSS class for selected item (default: 'modal-item-selected')
   * @param {Function} [options.onSelect] - Called when selection changes: (element, index, oldIndex)
   * @param {Function} [options.onDeselect] - Called when item is deselected: (element, index)
   * @param {Function} [options.onScroll] - Custom scroll handler: (element). If not provided, uses scrollIntoView
   * @param {boolean} [options.autoScroll] - Whether to auto-scroll on selection (default: true)
   * @param {boolean} [options.wrapAround] - Whether to wrap from end to start (default: false)
   */
  constructor(options = {}) {
    this.itemSelector = options.itemSelector;
    this.container = options.container;
    this._getItemsCallback = options.getItems;
    this.selectedClass = options.selectedClass || 'modal-item-selected';
    this.onSelect = options.onSelect;
    this.onDeselect = options.onDeselect;
    this.onScroll = options.onScroll;
    this.autoScroll = options.autoScroll !== false;
    this.wrapAround = options.wrapAround || false;
    this.selectedIndex = 0;
  }

  /**
   * Get all navigable items
   * @returns {HTMLElement[]}
   */
  getItems() {
    if (this._getItemsCallback) {
      const items = this._getItemsCallback();
      // Handle jQuery objects
      if (items && items.toArray) {
        return items.toArray();
      }
      return Array.isArray(items) ? items : [];
    }
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
   * Get current selection index
   * @returns {number}
   */
  getSelectedIndex() {
    return this.selectedIndex;
  }

  /**
   * Check if we're at the first item
   * @returns {boolean}
   */
  isAtStart() {
    return this.selectedIndex === 0;
  }

  /**
   * Check if we're at the last item
   * @returns {boolean}
   */
  isAtEnd() {
    const items = this.getItems();
    return this.selectedIndex >= items.length - 1;
  }

  /**
   * Navigate by direction
   * @param {number} direction - 1 for next, -1 for previous
   * @returns {boolean} - True if navigation moved to a different item
   */
  navigate(direction) {
    const items = this.getItems();
    if (!items.length) return false;

    const oldIndex = this.selectedIndex;

    // Calculate new index
    let newIndex = this.selectedIndex + direction;

    if (this.wrapAround) {
      if (newIndex < 0) {
        newIndex = items.length - 1;
      } else if (newIndex >= items.length) {
        newIndex = 0;
      }
    } else {
      if (newIndex < 0) {
        newIndex = 0;
      } else if (newIndex >= items.length) {
        newIndex = items.length - 1;
      }
    }

    // Check if we actually moved
    if (newIndex === oldIndex) {
      return false;
    }

    // Clear ALL selections first (handles stray selections)
    items.forEach(item => item.classList.remove(this.selectedClass));

    // Fire deselect callback for old item
    const oldItem = items[oldIndex];
    if (oldItem && this.onDeselect) {
      this.onDeselect(oldItem, oldIndex);
    }

    // Update index
    this.selectedIndex = newIndex;

    // Select new item
    const newItem = items[this.selectedIndex];
    if (newItem) {
      newItem.classList.add(this.selectedClass);

      // Scroll into view
      if (this.autoScroll) {
        if (this.onScroll) {
          this.onScroll(newItem);
        } else {
          newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      if (this.onSelect) {
        this.onSelect(newItem, this.selectedIndex, oldIndex);
      }
    }

    return true;
  }

  /**
   * Jump to specific index
   * @param {number} index - Target index
   * @returns {boolean} - True if selection changed
   */
  jumpTo(index) {
    const items = this.getItems();
    if (!items.length) return false;

    const oldIndex = this.selectedIndex;
    const newIndex = Math.max(0, Math.min(index, items.length - 1));

    if (newIndex === oldIndex) {
      return false;
    }

    // Clear ALL selections first (handles stray selections)
    items.forEach(item => item.classList.remove(this.selectedClass));

    // Fire deselect callback for old item
    const oldItem = items[oldIndex];
    if (oldItem && this.onDeselect) {
      this.onDeselect(oldItem, oldIndex);
    }

    // Update index
    this.selectedIndex = newIndex;

    // Select new item
    const newItem = items[this.selectedIndex];
    if (newItem) {
      newItem.classList.add(this.selectedClass);

      if (this.autoScroll) {
        if (this.onScroll) {
          this.onScroll(newItem);
        } else {
          newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      if (this.onSelect) {
        this.onSelect(newItem, this.selectedIndex, oldIndex);
      }
    }

    return true;
  }

  /**
   * Jump to first item
   * @returns {boolean} - True if selection changed
   */
  jumpToFirst() {
    return this.jumpTo(0);
  }

  /**
   * Jump to last item
   * @returns {boolean} - True if selection changed
   */
  jumpToLast() {
    const items = this.getItems();
    return this.jumpTo(items.length - 1);
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
   * Ensures selectedIndex is within bounds and applies styling
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
   * Clear selection styling from all items
   */
  clearSelection() {
    const items = this.getItems();
    items.forEach(item => item.classList.remove(this.selectedClass));
    if (this.onDeselect && items[this.selectedIndex]) {
      this.onDeselect(items[this.selectedIndex], this.selectedIndex);
    }
  }

  /**
   * Reset selection to first item
   */
  reset() {
    this.selectedIndex = 0;
    this.updateSelection();
  }

  /**
   * Set index without triggering selection callbacks (for external sync)
   * @param {number} index - New index value
   */
  setIndexSilent(index) {
    const items = this.getItems();
    this.selectedIndex = Math.max(0, Math.min(index, items.length - 1));
  }
}
