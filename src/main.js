// main.js

import constants from './constants.js';
import { state } from './state.js';
import { BlueskyAPI } from './api.js';
import * as utils from './utils.js';
import { ConfigWrapper } from './ConfigWrapper.js';
import { ListCache } from './ListCache.js';

import style from './assets/css/style.css?raw';
import sidecarTemplatesHtml from './sidecar.html?raw';

const { debounce, waitForElement, observeChanges, observeVisibilityChange } = utils;

import {
  Handler,
  ItemHandler,
  FeedItemHandler,
  PostItemHandler,
  ProfileItemHandler,
  SavedItemHandler,
} from './handlers/index.js';

import UIManager from './components/UIManager.js';
import DefaultUIAdapter from './components/ui-adapters/DefaultUIAdapter.js';
import FeedUIAdapter from './components/ui-adapters/FeedUIAdapter.js';
import PostUIAdapter from './components/ui-adapters/PostUIAdapter.js';
import ProfileUIAdapter from './components/ui-adapters/ProfileUIAdapter.js';
import SavedUIAdapter from './components/ui-adapters/SavedUIAdapter.js';

GM_addStyle(style);

// Show fullscreen loading indicator immediately on first load
// Check config from GM storage (default to true if not set)
const storedConfig = JSON.parse(GM_getValue('bluesky_navigator_config', '{}'));
const showLoadingIndicator = storedConfig.showLoadingIndicator !== false; // default true
if (showLoadingIndicator) {
  // Add class to enable CSS hiding of items
  const addLoadingClass = () => document.body.classList.add('bsky-nav-loading-enabled');
  if (document.body) {
    addLoadingClass();
  } else {
    document.addEventListener('DOMContentLoaded', addLoadingClass);
  }

  const indicator = document.createElement('div');
  indicator.id = 'feedLoadingIndicator';
  indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(255,255,255,0.95);z-index:99999;';
  indicator.innerHTML = `
    <div class="spinner" style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
    <div class="loading-text" style="color:#6b7280;font-size:14px;margin-top:12px;">Loading...</div>
  `;
  // Append to body immediately or wait for it
  if (document.body) {
    document.body.appendChild(indicator);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(indicator));
  }
}

let config;
let handlers;

// Proxy IntersectionObserver immediately to intercept before Bluesky creates its observers
// This must run as early as possible, before the app's code executes
(function proxyIntersectionObserverEarly() {
  const OriginalIntersectionObserver = unsafeWindow.IntersectionObserver;

  // Store reference so we can check config later
  let disableLoadMore = false;

  // Store the load-more callback and sentinel element so we can trigger it manually via the U key
  let loadMoreCallback = null;
  let loadMoreSentinel = null;

  // Function to update the setting (called after config is loaded)
  unsafeWindow.__bskyNavSetDisableLoadMore = (value) => {
    disableLoadMore = value;
  };

  // Function to get the stored callback for manual triggering
  unsafeWindow.__bskyNavGetLoadMoreCallback = () => loadMoreCallback;

  // Function to get the sentinel element
  unsafeWindow.__bskyNavGetLoadMoreSentinel = () => loadMoreSentinel;

  class ProxyIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;

      // Create the real observer with filtered callback
      this.realObserver = new OriginalIntersectionObserver((entries, observer) => {
        if (!disableLoadMore) {
          // If not disabled, pass through all entries
          callback(entries, observer);
          return;
        }

        // Filter out entries that appear to be infinite scroll triggers
        const filteredEntries = entries.filter((entry) => {
          const target = entry.target;

          // Always pass through our own observers (items with .thread or .item class)
          if (target.classList && (
            target.classList.contains('thread') ||
            target.classList.contains('item')
          )) {
            return true;
          }

          // Skip if it's a loading/sentinel element for infinite scroll
          // These are typically empty divs or divs with specific styles at the end of lists
          if (target.matches && (
            // Common infinite scroll sentinel patterns
            target.matches('[data-testid="feedLoadMore"]') ||
            target.matches('[data-testid*="loader"]') ||
            target.matches('[data-testid*="Loader"]') ||
            // Empty divs used as sentinels often have minimal height
            (target.tagName === 'DIV' && target.children.length === 0 && target.offsetHeight < 50)
          )) {
            // Check if this is intersecting (would trigger load)
            if (entry.isIntersecting) {
              return false;
            }
          }
          return true;
        });

        // Only call callback if there are remaining entries
        if (filteredEntries.length > 0) {
          callback(filteredEntries, observer);
        }
      }, options);
    }

    observe(target) {
      // Detect when an observer starts watching feed sentinel elements
      // This helps us identify the correct load-more callback
      if (target && target.matches) {
        const isFeedSentinel =
          target.matches('[data-testid="feedLoadMore"]') ||
          target.matches('[data-testid*="loader"]') ||
          target.matches('[data-testid*="Loader"]') ||
          // Empty divs near feed content are often sentinels
          (target.tagName === 'DIV' && target.children.length === 0);

        if (isFeedSentinel) {
          // Always update - the most recent sentinel is likely the active one
          loadMoreSentinel = target;
          loadMoreCallback = this.callback;
        }
      }
      this.realObserver.observe(target);
    }

    unobserve(target) {
      this.realObserver.unobserve(target);
    }

    disconnect() {
      this.realObserver.disconnect();
    }

    takeRecords() {
      return this.realObserver.takeRecords();
    }
  }

  // Replace global IntersectionObserver
  unsafeWindow.IntersectionObserver = ProxyIntersectionObserver;
})();

const screenPredicateMap = {
  search: (element) => $(element).find('div[data-testid="searchScreen"]').length,
  notifications: (element) => $(element).find('div[data-testid="notificationsScreen"]').length,
  chat: (element) => $(element).find('div:contains("Messages")').length,
  feeds: (element) => $(element).find('div[data-testid="FeedsScreen"]').length,
  lists: (element) => $(element).find('div[data-testid="listsScreen"]').length,
  profile: (element) => $(element).find('div[data-testid="profileScreen"]').length,
  settings: (element) => $(element).find('a[aria-label="Account"]').length,
  home: (element) => true,
};

function getScreenFromElement(element) {
  for (const [page, predicate] of Object.entries(screenPredicateMap)) {
    if (predicate(element)) {
      return page;
    }
  }
  // console.log(element[0].outerHTML)
  return 'unknown';
}

(function () {
  let monitor_interval = null;
  let current_url = null;
  const items = { feed: [], post: [] };
  const indexes = { feed: 0, post: 0 };
  let context = null;
  const num_items = { feed: 0, post: 0 };
  const func = null;

  const SCREEN_SELECTOR = 'main > div > div > div';

  function parseRulesConfig(configText) {
    const lines = configText.split('\n');
    const rules = {};
    let rulesName = null;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      const sectionMatch = line.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        rulesName = sectionMatch[1];
        rules[rulesName] = [];
        continue;
      }

      if (!rulesName) continue;

      // Match explicit allow/deny rules (including include and list types)
      const ruleMatch = line.match(/(allow|deny) (all|from|content|include|list) "?([^"]+)"?/);
      if (ruleMatch) {
        const [_, action, type, value] = ruleMatch;
        rules[rulesName].push({ action, type, value });
        continue;
      }

      // **Shortcut Parsing**
      if (line.startsWith('$')) {
        // Interpret "$category" as "allow include category"
        rules[rulesName].push({ action: 'allow', type: 'include', value: line.substring(1) });
      } else if (line.startsWith('&')) {
        // Interpret "&listname" or '&"list name"' as "allow list listname"
        const listMatch = line.match(/^&"?([^"]+)"?$/);
        if (listMatch) {
          rules[rulesName].push({ action: 'allow', type: 'list', value: listMatch[1] });
        }
      } else if (line.startsWith('@')) {
        // Interpret "@foo" as "allow author 'foo'"
        rules[rulesName].push({ action: 'allow', type: 'from', value: line });
      } else {
        // Any other string is interpreted as "allow content 'foobar'"
        rules[rulesName].push({ action: 'allow', type: 'content', value: line });
      }
    }
    return rules;
  }

  function onConfigInit() {
    const stateManagerConfig = {
      stateSyncEnabled: config.get('stateSyncEnabled'),
      stateSyncConfig: config.get('stateSyncConfig'),
      stateSaveTimeout: config.get('stateSaveTimeout'),
      maxEntries: config.get('historyMax'),
    };

    // Update the IntersectionObserver proxy with the config value
    if (unsafeWindow.__bskyNavSetDisableLoadMore) {
      unsafeWindow.__bskyNavSetDisableLoadMore(config.get('disableLoadMoreOnScroll'));
    }

    state.init(constants.STATE_KEY, stateManagerConfig, onStateInit);
  }

  function onConfigSave() {
    state.stateManager.saveStateImmediately(true, true);
    // Update content width dynamically
    updateContentWidth();
    // Recreate toast container with new position
    if (config.get('toastNotifications')) {
      createToastContainer();
    }
    config.close();

    // Refresh rules UI after modal closes
    setTimeout(() => {
      if (handlers) {
        for (const handler of Object.values(handlers)) {
          if (handler.isActive() && typeof handler.onRulesChanged === 'function') {
            handler.onRulesChanged();
          }
        }
      }
    }, 100);
  }

  // Update content width CSS - can be called on config save
  function updateContentWidth() {
    const hideRightSidebar = config.get('hideRightSidebar');
    const maxWidth = config.get('postWidthDesktop');
    const contentWidth = maxWidth || 600;

    const styleId = 'bsky-nav-width-style';
    let styleEl = document.getElementById(styleId);

    if (hideRightSidebar && contentWidth !== 600) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }

      const compactLayout = config.get('compactLayout');

      if (compactLayout) {
        // Nav is 240px wide on desktop, ~80px when collapsed (<=1300px width)
        const navWidthFull = 240;
        const navWidthCollapsed = 80;
        const gap = 20;
        styleEl.textContent = `
          /* Desktop: full nav width */
          @media (min-width: 1301px) {
            main[role="main"] [style*="max-width: 600px"],
            main[role="main"] [style*="max-width:600px"] {
              max-width: ${contentWidth}px !important;
              margin-left: ${navWidthFull + gap}px !important;
              margin-right: auto !important;
              transform: none !important;
            }
            #statusBar,
            #bsky-navigator-global-statusbar {
              max-width: ${contentWidth}px !important;
              margin-left: ${navWidthFull + gap}px !important;
              margin-right: auto !important;
              transform: none !important;
            }
          }
          /* Narrow: collapsed nav width */
          @media (max-width: 1300px) {
            main[role="main"] [style*="max-width: 600px"],
            main[role="main"] [style*="max-width:600px"] {
              max-width: ${contentWidth}px !important;
              margin-left: ${navWidthCollapsed + gap}px !important;
              margin-right: auto !important;
              transform: none !important;
            }
            #statusBar,
            #bsky-navigator-global-statusbar {
              max-width: ${contentWidth}px !important;
              margin-left: ${navWidthCollapsed + gap}px !important;
              margin-right: auto !important;
              transform: none !important;
            }
          }
          div[data-testid="homeScreenFeedTabs"] {
            width: 100% !important;
          }
          /* Position nav from left edge instead of center-relative */
          nav[role="navigation"] {
            left: 0 !important;
            transform: none !important;
            padding-left: 20px !important;
          }
        `;
      } else {
        // Original centered layout with shift
        const extraWidth = contentWidth - 600;
        const shiftRight = Math.floor(extraWidth / 2);
        styleEl.textContent = `
          main[role="main"] [style*="max-width: 600px"],
          main[role="main"] [style*="max-width:600px"] {
            max-width: ${contentWidth}px !important;
            transform: translateX(${shiftRight}px) !important;
          }
          div[data-testid="homeScreenFeedTabs"] {
            width: 100% !important;
          }
          #statusBar,
          #bsky-navigator-global-statusbar {
            max-width: ${contentWidth}px !important;
            transform: translateX(${shiftRight}px) !important;
          }
        `;
      }
    } else if (styleEl) {
      // Remove width styles if sidebar not hidden or width is default
      styleEl.textContent = '';
    }

    // Apply post max height setting
    updatePostMaxHeight();
  }

  function updatePostMaxHeight() {
    const postMaxHeight = config.get('postMaxHeight');
    const styleId = 'bsky-nav-post-height-style';
    let styleEl = document.getElementById(styleId);

    if (postMaxHeight && postMaxHeight !== 'Off') {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }

      // Collapse unfocused posts, expand when selected
      styleEl.textContent = `
        /* Collapse unfocused posts */
        div[data-testid="contentHider-post"] {
          max-height: ${postMaxHeight} !important;
          overflow: hidden !important;
          position: relative !important;
        }
        /* Fade overlay to indicate more content */
        div[data-testid="contentHider-post"]::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 40px;
          background: linear-gradient(transparent, var(--background-color, white));
          pointer-events: none;
        }
        /* Expand when post is selected */
        .item-selection-active div[data-testid="contentHider-post"],
        .item-selection-child-focused div[data-testid="contentHider-post"] {
          max-height: none !important;
          overflow: visible !important;
        }
        .item-selection-active div[data-testid="contentHider-post"]::after,
        .item-selection-child-focused div[data-testid="contentHider-post"]::after {
          display: none;
        }
      `;
    } else if (styleEl) {
      // Remove height styles if disabled
      styleEl.textContent = '';
    }
  }

  // ==========================================================================
  // Toast Notifications
  // ==========================================================================

  // Track seen notifications to avoid duplicates
  const seenNotifications = new Set();
  let toastContainer = null;
  let notificationPollInterval = null;
  let toastApi = null;
  let lastSeenAt = null;

  /**
   * Initialize the toast notification system
   * @param {BlueskyAPI} api - The API instance to use for fetching notifications
   */
  function initToastNotifications(api) {
    if (!config.get('toastNotifications')) {
      return;
    }

    toastApi = api;

    // Create toast container
    createToastContainer();

    // Only start polling if we have an API instance
    if (toastApi) {
      startNotificationPolling();

      // In test mode, show the most recent notification after a short delay
      if (config.get('toastTestMode')) {
        setTimeout(() => {
          fetchAndShowTestNotification();
        }, 2000);
      }
    }
  }

  /**
   * Create the toast container element
   */
  function createToastContainer() {
    if (toastContainer) {
      toastContainer.remove();
    }

    const position = config.get('toastPosition') || 'Top Right';
    const positionClass = position.toLowerCase().replace(' ', '-');

    toastContainer = $(`<div class="bsky-nav-toast-container ${positionClass}"></div>`);
    $('body').append(toastContainer);
  }

  /**
   * Parse notification data from API response
   */
  function parseApiNotification(apiNotification) {
    const notification = {
      id: apiNotification.uri || apiNotification.cid || Date.now().toString(),
      indexedAt: apiNotification.indexedAt,
    };

    // Extract author info
    const author = apiNotification.author;
    if (author) {
      notification.author = author.displayName || author.handle;
      notification.handle = author.handle;
      notification.avatar = author.avatar || '';
    }

    // Map API reason to notification type
    const reason = apiNotification.reason;
    switch (reason) {
      case 'like':
        notification.type = 'like';
        notification.action = 'liked your post';
        break;
      case 'like-via-repost':
        notification.type = 'like';
        notification.action = 'liked your repost';
        break;
      case 'repost':
        notification.type = 'repost';
        notification.action = 'reposted your post';
        break;
      case 'repost-via-repost':
        notification.type = 'repost';
        notification.action = 'reposted your repost';
        break;
      case 'reply':
        notification.type = 'reply';
        notification.action = 'replied to your post';
        break;
      case 'follow':
        notification.type = 'follow';
        notification.action = 'followed you';
        break;
      case 'quote':
        notification.type = 'quote';
        notification.action = 'quoted your post';
        break;
      case 'mention':
        notification.type = 'mention';
        notification.action = 'mentioned you';
        break;
      case 'starterpack-joined':
        notification.type = 'follow';
        notification.action = 'joined your starter pack';
        break;
      default:
        return null; // Unknown notification type
    }

    // Extract preview text from the record if available
    if (apiNotification.record?.text) {
      notification.preview = apiNotification.record.text.substring(0, 150);
    }

    // Format relative time
    if (apiNotification.indexedAt) {
      const date = new Date(apiNotification.indexedAt);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        notification.time = 'now';
      } else if (diffMins < 60) {
        notification.time = `${diffMins}m`;
      } else if (diffHours < 24) {
        notification.time = `${diffHours}h`;
      } else {
        notification.time = `${diffDays}d`;
      }
    }

    // Build URL for navigation
    if (apiNotification.reasonSubject) {
      // For likes/reposts, link to the subject post
      const parts = apiNotification.reasonSubject.split('/');
      const postId = parts[parts.length - 1];
      const did = parts[2];
      notification.url = `/profile/${did}/post/${postId}`;
    } else if (apiNotification.uri && reason !== 'follow') {
      // For replies/quotes/mentions, link to the notification post
      const parts = apiNotification.uri.split('/');
      const postId = parts[parts.length - 1];
      notification.url = `/profile/${notification.handle}/post/${postId}`;
    } else if (reason === 'follow') {
      // For follows, link to the profile
      notification.url = `/profile/${notification.handle}`;
    }

    return notification;
  }

  /**
   * Show a toast notification
   */
  function showToast(notification) {
    if (!toastContainer || !notification) return;

    const iconSvgs = {
      like: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12.489 21.372c8.528-4.78 10.626-10.47 9.022-14.47-.779-1.941-2.414-3.333-4.342-3.763-1.697-.378-3.552.003-5.169 1.287-1.617-1.284-3.472-1.665-5.17-1.287-1.927.43-3.562 1.822-4.34 3.764-1.605 4 .493 9.69 9.021 14.47a1 1 0 0 0 .978 0Z"></path></svg>',
      repost: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.957 2.293a1 1 0 1 0-1.414 1.414L17.836 5H6a3 3 0 0 0-3 3v3a1 1 0 1 0 2 0V8a1 1 0 0 1 1-1h11.836l-1.293 1.293a1 1 0 0 0 1.414 1.414l2.47-2.47a1.75 1.75 0 0 0 0-2.474l-2.47-2.47ZM20 12a1 1 0 0 1 1 1v3a3 3 0 0 1-3 3H6.164l1.293 1.293a1 1 0 1 1-1.414 1.414l-2.47-2.47a1.75 1.75 0 0 1 0-2.474l2.47-2.47a1 1 0 0 1 1.414 1.414L6.164 17H18a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1Z"></path></svg>',
      reply: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.002 7a2 2 0 0 0-2-2h-12a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v1.918l3.375-2.7a1 1 0 0 1 .625-.218h5a2 2 0 0 0 2-2V7Zm2 8a4 4 0 0 1-4 4h-4.648l-4.727 3.781A1.001 1.001 0 0 1 7.002 22v-3h-1a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8Z"></path></svg>',
      follow: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM6 8a6 6 0 1 1 12 0A6 6 0 0 1 6 8Zm2 10a3 3 0 0 0-3 3 1 1 0 1 1-2 0 5 5 0 0 1 5-5h8a5 5 0 0 1 5 5 1 1 0 1 1-2 0 3 3 0 0 0-3-3H8Z"></path></svg>',
      mention: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4a8 8 0 1 0 4.906 14.32 1 1 0 0 1 1.218 1.588A10 10 0 1 1 22 12v1.5a3.5 3.5 0 0 1-6.063 2.395A5 5 0 1 1 17 12v1.5a1.5 1.5 0 0 0 3 0V12a8 8 0 0 0-8-8Zm3 8a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z"></path></svg>',
      quote: '<svg fill="none" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 7H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2 1 1 0 1 0 0 2 4 4 0 0 0 4-4V9a2 2 0 0 0-2-2Zm10 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2 1 1 0 1 0 0 2 4 4 0 0 0 4-4V9a2 2 0 0 0-2-2Z"></path></svg>',
    };

    // Slider position maps to actual seconds: 1, 2, 3, 4, 5, 10, 15, 30, 60, 300, Infinity
    const durationValues = [1, 2, 3, 4, 5, 10, 15, 30, 60, 300, Infinity];
    const sliderPos = config.get('toastDuration') ?? 4; // default position 4 = 5 seconds
    const durationSeconds = durationValues[sliderPos] ?? 5;
    // Infinity means "Until dismissed" (null duration skips auto-remove)
    const duration = durationSeconds === Infinity ? null : durationSeconds * 1000;

    const $toast = $(`
      <div class="bsky-nav-toast">
        <div class="bsky-nav-toast-icon ${notification.type}">
          ${iconSvgs[notification.type] || ''}
        </div>
        <div class="bsky-nav-toast-content">
          <div class="bsky-nav-toast-header">
            ${notification.avatar ? `<img class="bsky-nav-toast-avatar" src="${notification.avatar}" alt="">` : ''}
            <span class="bsky-nav-toast-author">${notification.author || 'Someone'}</span>
          </div>
          <span class="bsky-nav-toast-action">${notification.action}</span>
          ${notification.preview ? `<div class="bsky-nav-toast-preview">${notification.preview}</div>` : ''}
          ${notification.time ? `<span class="bsky-nav-toast-time">${notification.time}</span>` : ''}
        </div>
        <button class="bsky-nav-toast-close" aria-label="Dismiss">×</button>
      </div>
    `);

    // Click to navigate to notifications page
    $toast.on('click', (e) => {
      if (!$(e.target).is('.bsky-nav-toast-close')) {
        window.location.href = '/notifications';
        removeToast($toast);
      }
    });

    // Close button
    $toast.find('.bsky-nav-toast-close').on('click', (e) => {
      e.stopPropagation();
      removeToast($toast);
    });

    toastContainer.append($toast);

    // Animate in
    setTimeout(() => $toast.addClass('visible'), 10);

    // Auto-remove after duration (unless "Until dismissed")
    if (duration !== null) {
      setTimeout(() => removeToast($toast), duration);
    }
  }

  /**
   * Remove a toast with animation
   */
  function removeToast($toast) {
    $toast.removeClass('visible');
    setTimeout(() => $toast.remove(), 300);
  }

  /**
   * Start polling for new notifications via API
   */
  function startNotificationPolling() {
    if (notificationPollInterval) {
      clearInterval(notificationPollInterval);
    }

    // Poll every 30 seconds
    const pollIntervalMs = 30000;

    // Initial fetch to set the baseline (don't show toasts for existing notifications)
    fetchNotifications(true);

    // Start polling
    notificationPollInterval = setInterval(() => {
      if (config.get('toastNotifications') && toastApi) {
        fetchNotifications(false);
      }
    }, pollIntervalMs);
  }

  /**
   * Fetch notifications from the API
   * @param {boolean} isInitial - If true, just record seen notifications without showing toasts
   */
  async function fetchNotifications(isInitial = false) {
    if (!toastApi) return;

    try {
      // Ensure we're logged in before fetching
      if (!toastApi.agent.session) {
        await toastApi.login();
      }

      const result = await toastApi.getNotifications(20);
      const notifications = result.notifications || [];

      // Update lastSeenAt from the API response
      if (result.seenAt) {
        lastSeenAt = new Date(result.seenAt);
      }

      for (const apiNotification of notifications) {
        const notification = parseApiNotification(apiNotification);
        if (!notification) continue;

        // Skip if we've already seen this notification
        if (seenNotifications.has(notification.id)) {
          continue;
        }

        // Mark as seen
        seenNotifications.add(notification.id);

        // On initial load, don't show toasts - just record what we've seen
        if (isInitial) {
          continue;
        }

        // Only show toast if this notification is newer than our last seen time
        if (lastSeenAt && notification.indexedAt) {
          const notificationDate = new Date(notification.indexedAt);
          if (notificationDate <= lastSeenAt) {
            continue;
          }
        }

        // Show the toast
        showToast(notification);
      }

      // Limit the size of seenNotifications to prevent memory issues
      if (seenNotifications.size > 1000) {
        const iterator = seenNotifications.values();
        for (let i = 0; i < 500; i++) {
          seenNotifications.delete(iterator.next().value);
        }
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }

  /**
   * Fetch and show the most recent notification for testing
   */
  async function fetchAndShowTestNotification() {
    if (!toastApi) {
      return;
    }

    try {
      // Ensure we're logged in before fetching
      if (!toastApi.agent.session) {
        await toastApi.login();
      }

      const result = await toastApi.getNotifications(1);
      const notifications = result.notifications || [];

      if (notifications.length > 0) {
        const notification = parseApiNotification(notifications[0]);
        if (notification) {
          // Clear the seen set so the test notification shows
          seenNotifications.clear();
          showToast(notification);
        }
      }
    } catch (error) {
      console.error('Toast test: Failed to fetch notification:', error);
    }
  }

  function onStateInit() {
    let widthWatcher;
    let api;

    if (
      config.get('atprotoService') &&
      config.get('atprotoIdentifier') &&
      config.get('atprotoPassword')
    ) {
      api = new BlueskyAPI(
        config.get('atprotoService'),
        config.get('atprotoIdentifier'),
        config.get('atprotoPassword')
      );
      // FIXME: async race condition
      api.login();

      async function loadSidecarTemplate(selector, html) {
        try {
          // Fetch the popup HTML file from the public directory
          // Append the popup to the body
          const popupContainer = $(selector).append(html);
          // $(popupContainer).append($(html));
          // Close button functionality
          $('.close-btn').on('click', function () {
            $('#bluesky-popup').hide();
          });

        } catch (error) {
          console.error('Failed to load popup:', error);
        }
      }
      loadSidecarTemplate('body', sidecarTemplatesHtml);
    }

    // Initialize list cache for rule filtering
    let listCache = null;
    if (api) {
      listCache = new ListCache(api);
    }

    // Store in state for access by handlers
    state.listCache = listCache;

    // Initialize mobileView early so handlers can use it in their constructors
    state.mobileView = window.innerWidth <= 800;

    // FIXME: ordering of these is important since posts can tbe in profiles
    handlers = {
      feed: new FeedItemHandler('feed', config, state, api, constants.FEED_ITEM_SELECTOR),
      post: new PostItemHandler('post', config, state, api, constants.POST_ITEM_SELECTOR),
      profile: new ProfileItemHandler('profile', config, state, api, constants.FEED_ITEM_SELECTOR),
      saved: new SavedItemHandler('saved', config, state, api, constants.FEED_ITEM_SELECTOR),
      input: new Handler('input', config, state, api),
    };

    // Immediately hide loading indicator if no feed/item handler matches current URL
    // This handles pages like notifications, lists, search, settings
    // Exclude 'input' handler as it always returns true
    const hasActiveItemHandler = ['feed', 'post', 'profile', 'saved']
      .some(name => handlers[name]?.isActive());
    if (!hasActiveItemHandler) {
      const indicator = document.getElementById('feedLoadingIndicator');
      if (indicator) indicator.remove();
      document.body.classList.remove('bsky-nav-loading-enabled');
      document.body.classList.add('bsky-nav-feed-ready');
    }

    // FIXME: find a better place for this
    if (state.rulesConfig) {
      config.set('rulesConfig', state.rulesConfig);
    }
    state.rules = parseRulesConfig(config.get('rulesConfig'));

    // Initialize toast notification system (pass API if available)
    initToastNotifications(api);

    // Initialize UIManager for global toolbar and status bar
    const uiManager = new UIManager(config, state);

    // Register UI adapters
    const defaultAdapter = new DefaultUIAdapter();
    const feedAdapter = new FeedUIAdapter();
    const postAdapter = new PostUIAdapter();
    const profileAdapter = new ProfileUIAdapter();
    const savedAdapter = new SavedUIAdapter();
    uiManager.registerAdapter('default', defaultAdapter);
    uiManager.registerAdapter('input', defaultAdapter); // Use default for input context
    uiManager.registerAdapter('feed', feedAdapter);
    uiManager.registerAdapter('saved', savedAdapter);
    uiManager.registerAdapter('post', postAdapter);
    uiManager.registerAdapter('profile', profileAdapter);

    // Initialize UIManager once main element is available
    uiManager.initialize().then(() => {
      // Set initial context based on current URL/page
      if (context && uiManager.isInitialized()) {
        uiManager.setContext(context, handlers[context] || null);
      }
    });

    if (config.get('showDebuggingInfo')) {
      const logContainer = $(`<div id="logContainer"></div>`);
      $('body').append(logContainer);
      const logHeader = $(`<div id="logHeader"></div>`);
      logHeader.append($(`<button id="clearLogs"/>Clear</button>`));
      logContainer.append(logHeader);
      logContainer.append($(`<div id="logContent"></div>`));
      $('#clearLogs').on('click', function () {
        $('#logContent').empty(); // Clear the logs
      });

      function appendLog(type, args) {
        const message = `[${type.toUpperCase()}] ${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg))
          .join(' ')}`;

        $('#logContent').append(`<div style="margin-bottom: 5px;">${message}</div>`);
        $('#logContent').scrollTop($('#logContent')[0].scrollHeight);
      }

      // Override console methods
      const originalConsole = {};
      ['log', 'warn', 'error', 'info'].forEach((type) => {
        originalConsole[type] = console[type];
        unsafeWindow.console[type] = function (...args) {
          appendLog(type, args);
          originalConsole[type].apply(console, args);
        };
      });
      window.console = unsafeWindow.console;
    }

    // Apply accessibility preferences
    function applyAccessibilityStyles() {
      const reducedMotion = config.get('reducedMotion');
      const highContrast = config.get('highContrastMode');
      const focusRingColor = config.get('focusRingColor') || '#0066cc';
      const focusRingWidth = config.get('focusRingWidth') || 2;

      // Build accessibility CSS overrides
      let accessibilityStyles = `:root {
        --focus-ring-color: ${focusRingColor};
        --focus-ring-width: ${focusRingWidth}px;
      }`;

      // Override reduced motion if user has explicit preference
      if (reducedMotion === 'Always') {
        accessibilityStyles += `
          :root {
            --transition-duration: 0ms;
            --animation-duration: 0ms;
          }
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        `;
      } else if (reducedMotion === 'Never') {
        accessibilityStyles += `
          :root {
            --transition-duration: 200ms;
            --animation-duration: 300ms;
          }
        `;
      }

      // High contrast mode overrides
      if (highContrast) {
        accessibilityStyles += `
          :root {
            --focus-ring-color: #000000;
            --focus-ring-width: 3px;
          }
        `;
      }

      // Inject accessibility styles
      let accessibilityStyleEl = document.getElementById('bsky-nav-accessibility-styles');
      if (!accessibilityStyleEl) {
        accessibilityStyleEl = document.createElement('style');
        accessibilityStyleEl.id = 'bsky-nav-accessibility-styles';
        document.head.appendChild(accessibilityStyleEl);
      }
      accessibilityStyleEl.textContent = accessibilityStyles;
    }

    applyAccessibilityStyles();

    // Define the reusable style
    const stylesheet = `

        /* Feed itmes may be sorted, so we hide them visually and show them later */
        div[data-testid$="FeedPage"] ${constants.FEED_ITEM_SELECTOR} {
            opacity: 0%;
        }

        ${
          config.get('hideLoadNewButton')
            ? `
            ${constants.LOAD_NEW_BUTTON_SELECTOR} {
                display: none;
            }
            `
            : ``
        }

        ${
          config.get('hideSuggestedFollows')
            ? `
            /* Hide "Suggested for you" section - uses .bsky-nav-suggested-hidden class applied by JS */
            .bsky-nav-suggested-hidden {
                display: none !important;
            }
            `
            : ``
        }

        .item  {
            margin: 3px;
            ${config.get('posts')}
        }

        .item > div {
            border: none;
        }

        .item-selection-active {
            ${config.get('selectionActive')}
        }

        .item-selection-inactive {
            ${config.get('selectionInactive')}
        }

        .item-selection-child-focused {
            ${config.get('selectionChildFocused')}
        }

        .reply-selection-active {
            ${config.get('replySelectionActive')};
        }

        .reply-selection-child-focused {
            outline: 1px color-mix(in srgb, var(--focus-ring-color, #0066cc) 35%, transparent) solid !important;
        }

        .sidecar-collapsed {
            border-right: 3px dashed var(--focus-ring-color, #0066cc) !important;
        }

        .sidecar-post {
            margin: 1px;
            ${config.get('replySelectionInactive')}
        }

        /* Sidecar width configuration - only apply when using inline sidecar */
        ${
          config.get('fixedSidecar') !== true && config.get('fixedSidecar') !== 'Fixed'
            ? `
        @media only screen and (min-width: 801px) {
            /* Only narrow items that have sidecar content */
            .item.has-sidecar {
                flex: ${100 - (config.get('sidecarWidthPercent') || 30)} !important;
            }
            .sidecar-replies {
                flex: ${config.get('sidecarWidthPercent') || 30} !important;
            }
            /* Reset item width when inline sidecar is hidden */
            body.inline-sidecar-hidden .item.has-sidecar {
                flex: 1 !important;
            }
            body.inline-sidecar-hidden .sidecar-replies {
                display: none !important;
            }
        }
        `
            : ''
        }

        @media (prefers-color-scheme:light){
            .item-unread {
                ${config.get('unreadPosts')};
                ${config.get('unreadPostsLightMode')};
            }

            .item-read {
                ${config.get('readPosts')};
                ${config.get('readPostsLightMode')};
            }

        }

        @media (prefers-color-scheme:dark){
            .item-unread {
                ${config.get('unreadPosts')};
                ${config.get('unreadPostsDarkMode')};
            }

            .item-read {
                ${config.get('readPosts')};
                ${config.get('readPostsDarkMode')};
            }
        }

        .thread-first {
            margin-top: ${config.get('threadMargin')};
            border-top: 1px rgb(212, 219, 226) solid;
        }

        .thread-last {
            margin-bottom: ${config.get('threadMargin')};
        }

        /* hack to fix last thread item indicator being offset */
        .thread-last div.r-lchren {
            left: 10px;
        }

        div.r-m5arl1 {
            width: ${config.get('threadIndicatorWidth')}px;
            background-color: ${config.get('threadIndicatorColor')} !important;
        }

        div:has(main) {
            overflow-x: clip;
        }

        ${constants.POST_CONTENT_SELECTOR} {
            margin: 1em 1px 1px 1px;
        }

        ${constants.HOME_SCREEN_SELECTOR} .item > div:first-of-type > div:last-of-type > div:last-of-type > div:first-of-type {
            flex: unset !important;
        }



`;

    // Inject the style into the page
    const styleElement = document.createElement('style');
    styleElement.type = 'text/css';
    styleElement.textContent = stylesheet;
    document.head.appendChild(styleElement);

    // Handle window resize events (placeholder for future use)
    function onWindowResize(_element) {
      // Currently unused - can be expanded to handle dynamic width changes
    }

    function updateScreen(screen) {
      if (state.screen == screen) {
        return;
      }
      state.screen = screen;
      if (screen == 'search') {
        if ($(':focus') != $('input[role="search"]')) {
          $('input[role="search"]').focus();
        }
      }
      // Only set up width watcher on desktop
      if (!widthWatcher && !state.mobileView) {
        widthWatcher = waitForElement(constants.WIDTH_SELECTOR, onWindowResize);
      }
    }

    waitForElement(constants.SCREEN_SELECTOR, (element) => {
      updateScreen(getScreenFromElement(element));
      observeVisibilityChange($(element), (isVisible) => {
        if (isVisible) {
          updateScreen(getScreenFromElement(element));
        }
      });
    });

    function setContext(ctx, forceRefresh = false) {
      const contextChanged = context !== ctx;

      if (contextChanged) {
        context = ctx;
        for (const [name, handler] of Object.entries(handlers)) {
          handler.deactivate();
        }
        if (handlers[context]) {
          handlers[context].activate();
        }
      }

      // Always notify UIManager if context changed OR forceRefresh requested
      // This handles URL changes within the same context (e.g., notifications -> search)
      if ((contextChanged || forceRefresh) && uiManager.isInitialized()) {
        uiManager.setContext(ctx, handlers[ctx] || null);
      }
    }

    function setContextFromUrl() {
      const newUrl = window.location.href;
      const urlChanged = newUrl !== current_url;
      current_url = newUrl;

      let matched = false;
      // Check URL-based handlers (exclude 'input' which is focus-based, not URL-based)
      for (const [name, handler] of Object.entries(handlers)) {
        if (name === 'input') continue;
        if (handler.isActive()) {
          setContext(name, urlChanged);
          matched = true;
          break;
        }
      }

      // If no handler matched, use 'default' context for other pages
      // (notifications, search, settings, etc.)
      if (!matched) {
        setContext('default', urlChanged);
        // Hide loading indicator since these pages don't process feed items
        const indicator = document.getElementById('feedLoadingIndicator');
        if (indicator) indicator.remove();
        document.body.classList.remove('bsky-nav-loading-enabled');
        document.body.classList.add('bsky-nav-feed-ready');
      }
    }

    function onFocus(e) {
      const target = e.target;
      if (typeof target.tagName === 'undefined') {
        return false;
      }
      // Ignore focus events on our UI elements - don't switch context
      if ($(target).closest('#bsky-navigator-toolbar, .bsky-nav-rules-dropdown').length) {
        return;
      }
      const targetTagName = target.tagName.toLowerCase();
      switch (targetTagName) {
        case 'input':
        case 'textarea':
          setContext('input');
          break;
        case 'div': {
          const maybeTiptap = $(target).closest('.tiptap');
          if (maybeTiptap.length) {
            waitForElement(
              '.tiptap',
              () => null,
              () => onBlur({ target: maybeTiptap[0] })
            );
            setContext('input');
          } else {
            setContextFromUrl();
          }
          break;
        }
        default:
          setContextFromUrl();
      }
    }

    function onBlur(e) {
      const target = e.target;
      if (typeof target.tagName === 'undefined') {
        return false;
      }
      const targetTagName = target.tagName.toLowerCase();
      switch (targetTagName) {
        case 'input':
        case 'textarea':
          setContextFromUrl();
          //document.addEventListener('keypress', func, true)
          break;
        case 'div':
          if ($(target).closest('.tiptap').length) {
            setContextFromUrl();
          }
          break;
        default:
          setContextFromUrl();
          break;
      }
    }

    document.addEventListener('focus', onFocus, true);
    document.addEventListener('blur', onBlur, true);

    function startMonitor() {
      monitor_interval = setInterval(function () {
        if (window.location.href !== current_url) {
          setContextFromUrl();
        }
      }, constants.URL_MONITOR_INTERVAL);
    }

    // set up observer to detect if mobile interface is active
    // mobileView is already initialized above before handler creation
    const viewportChangeObserver = waitForElement(
      `${constants.DRAWER_MENU_SELECTOR}, ${constants.LEFT_SIDEBAR_SELECTOR}`,
      (element) => {
        // Check both element type AND screen width for more reliable detection
        const isMobileByElement = $(element).is(constants.DRAWER_MENU_SELECTOR);
        const isMobileByWidth = window.innerWidth <= 800;
        state.mobileView = isMobileByElement || isMobileByWidth;
        startMonitor();
        setContextFromUrl();

        // Apply desktop layout on desktop view
        if (!state.mobileView) {
          applyDesktopFullWidth();
        }
      }
    );

    /**
     * Apply layout adjustments for desktop mode
     * Hides right sidebar and adjusts content width
     */
    function applyDesktopFullWidth() {
      // Hide right sidebar if option is enabled
      const hideRightSidebar = config.get('hideRightSidebar');

      if (hideRightSidebar) {
        document.body.classList.add('bsky-nav-hide-right-sidebar');

        waitForElement('input[role="search"]', (searchInput) => {
          // Find the fixed-position container ancestor
          let rightSidebar = searchInput.parentElement;
          while (rightSidebar && !rightSidebar.style.cssText.includes('position: fixed')) {
            rightSidebar = rightSidebar.parentElement;
          }
          if (rightSidebar) {
            rightSidebar.style.display = 'none';
          }
        });

        // Apply custom width
        updateContentWidth();
      }

      // Hide "Suggested for you" sections if option is enabled
      if (config.get('hideSuggestedFollows')) {
        hideSuggestedFollows();
      }
    }

    /**
     * Hide "Suggested for you" sections in the feed
     */
    function hideSuggestedFollows() {
      // Find and hide elements containing "Suggested for you" text
      const observer = new MutationObserver(() => {
        document.querySelectorAll('div[dir="auto"]').forEach((el) => {
          if (el.textContent === 'Suggested for you') {
            // Find the container - go up to find the section with the gray background
            let container = el.closest('div[style*="background-color: rgb(249, 250, 251)"]');
            if (container && !container.classList.contains('bsky-nav-suggested-hidden')) {
              container.classList.add('bsky-nav-suggested-hidden');
            }
          }
        });
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Run once immediately
      document.querySelectorAll('div[dir="auto"]').forEach((el) => {
        if (el.textContent === 'Suggested for you') {
          let container = el.closest('div[style*="background-color: rgb(249, 250, 251)"]');
          if (container) {
            container.classList.add('bsky-nav-suggested-hidden');
          }
        }
      });
    }
  }

  // Initialize config with our custom ConfigWrapper
  config = new ConfigWrapper({
    id: 'bluesky_navigator',
    onInit: onConfigInit,
    onSave: onConfigSave,
  });

  // Expose config and state to window for debugging and access from ConfigModal
  unsafeWindow.config = config;
  unsafeWindow.blueskyNavigatorState = state;

  $(document).ready(function (e) {
    // Store the original play method
    const originalPlay = HTMLMediaElement.prototype.play;

    // Override the play method
    HTMLMediaElement.prototype.play = function () {
      const isUserInitiated = this.dataset.allowPlay === 'true';

      // Allow user-initiated playback or userscript playback
      if (isUserInitiated || config.get('videoPreviewPlayback') == 'Play all') {
        // console.log('Allowing play:', this);
        delete this.dataset.allowPlay; // Clear the flag after use
        return originalPlay.apply(this, arguments);
      }

      // Check if play is triggered by a user click
      else if ($(document.activeElement).is('button[aria-label^="Play"]')) {
        // console.log('Allowing play from user interaction:', this);
        return originalPlay.apply(this, arguments);
      } else {
        // Block all other play calls (likely from the app)
        // console.log('Blocking play call from app:', this);
        return Promise.resolve(); // Return a resolved promise to prevent errors
      }
    };
  });
})();
