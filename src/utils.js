// utils.js

let debounceTimeout;

export function debounce(func, delay) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * Check if user is currently in a text input context (compose modal, search, etc.)
 * Used to skip expensive observer processing during typing
 */
export function isUserTyping() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;

  // Check for tiptap rich text editor (compose modal)
  if (activeElement.closest('.tiptap')) return true;

  // Check for contenteditable
  if (activeElement.isContentEditable) return true;

  return false;
}

/**
 * Check if any modal dialog is currently open
 * Used to disable keyboard shortcuts when modals are active
 */
export function isModalOpen() {
  // Check for config modal
  if (document.querySelector('.config-modal')) return true;

  // Check for shortcut overlay
  if (document.querySelector('.shortcuts-overlay')) return true;

  // Check for sync dialog
  if (document.querySelector('.sync-dialog-overlay')) return true;

  return false;
}

export function waitForElement(selector, onAdd, onRemove, onChange, ignoreExisting) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (onAdd) {
        mutation.addedNodes.forEach((node) => {
          if (node.matches && node.matches(selector)) onAdd(node);
          node.querySelectorAll?.(selector).forEach((el) => onAdd(el, observer));
        });
      }

      if (onRemove) {
        mutation.removedNodes.forEach((node) => {
          if (node.matches && node.matches(selector)) onRemove(node);
          node.querySelectorAll?.(selector).forEach((el) => onRemove(el, observer));
        });
      }

      if (onChange) {
        if (mutation.type === 'attributes') {
          const attributeName = mutation.attributeName;
          const oldValue = mutation.oldValue;
          const newValue = mutation.target.getAttribute(attributeName);

          if (oldValue !== newValue) {
            onChange(attributeName, oldValue, newValue, mutation.target, observer);
          }
        }
      }
    });
  });

  const processExistingElements = () => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => onAdd(el, observer));
  };

  if (onAdd && !ignoreExisting) {
    processExistingElements();
  }

  observer.observe(document.body, { childList: true, subtree: true, attributes: !!onChange });
  return observer;
}

export function observeChanges(target, callback, subtree) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        const attributeName = mutation.attributeName;
        const oldValue = mutation.oldValue;
        const newValue = mutation.target.getAttribute(attributeName);

        // Only log changes if there's a difference
        if (oldValue !== newValue) {
          callback(attributeName, oldValue, newValue, mutation.target);
        }
      }
    });
  });

  observer.observe(target, {
    attributes: true,
    attributeOldValue: true,
    subtree: !!subtree,
  });

  return observer;
}

export function observeVisibilityChange($element, callback) {
  const target = $element[0]; // Get the DOM element from the jQuery object

  const observer = new MutationObserver(() => {
    // Check visibility using jQuery
    const isVisible = $element.is(':visible');
    callback(isVisible);
  });

  // Observe changes to attributes and child nodes
  observer.observe(target, {
    attributes: true,
    childList: true,
    subtree: false, // Only observe the target element
  });

  // Optional: Return a function to stop observing
  return () => observer.disconnect();
}

export function splitTerms(input) {
  return input.split(/\s+/).filter((term) => term.length > 0); // Split by spaces
}

export function extractLastTerm(input) {
  const terms = splitTerms(input);
  return terms.length > 0 ? terms[terms.length - 1] : '';
}

// Accessibility utilities

/**
 * Check if user prefers reduced motion.
 * @param {Object} config - Config instance (optional)
 * @returns {boolean}
 */
export function prefersReducedMotion(config = null) {
  if (config) {
    const setting = config.get('reducedMotion');
    if (setting === 'Always') return true;
    if (setting === 'Never') return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if user prefers high contrast.
 * @param {Object} config - Config instance (optional)
 * @returns {boolean}
 */
export function prefersHighContrast(config = null) {
  if (config && config.get('highContrastMode')) return true;
  return window.matchMedia('(prefers-contrast: more)').matches;
}

/**
 * Get animation duration respecting reduced motion preference.
 * @param {number} defaultMs - Default duration in milliseconds
 * @param {Object} config - Config instance (optional)
 * @returns {number}
 */
export function getAnimationDuration(defaultMs, config = null) {
  return prefersReducedMotion(config) ? 0 : defaultMs;
}

/**
 * Announce message to screen readers via aria-live region.
 * @param {string} message - Message to announce
 * @param {string} priority - 'polite' or 'assertive'
 */
export function announceToScreenReader(message, priority = 'polite') {
  const el = $('<div>')
    .attr({
      role: 'status',
      'aria-live': priority,
      'aria-atomic': 'true',
    })
    .addClass('sr-only')
    .text(message);
  $('body').append(el);
  setTimeout(() => el.remove(), 1000);
}
