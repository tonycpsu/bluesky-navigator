// main.js

import constants from './constants.js';
import { state } from './state.js';
import { BlueskyAPI } from './api.js';
import * as utils from './utils.js';
import { ConfigWrapper } from './ConfigWrapper.js';

import style from './assets/css/style.css?raw';
import sidecarTemplatesHtml from './sidecar.html?raw';

const { debounce, waitForElement, observeChanges, observeVisibilityChange } = utils;

import {
  Handler,
  ItemHandler,
  FeedItemHandler,
  PostItemHandler,
  ProfileItemHandler,
} from './handlers/index.js';

GM_addStyle(style);

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
              console.log('[bsky-navigator] Blocked infinite scroll trigger:', target);
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
          console.log('[bsky-navigator] Captured feed load-more callback and sentinel:', target);
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

      // Match explicit allow/deny rules
      const ruleMatch = line.match(/(allow|deny) (all|from|content) "?([^"]+)"?/);
      if (ruleMatch) {
        const [_, action, type, value] = ruleMatch;
        rules[rulesName].push({ action, type, value });
        continue;
      }

      // **Shortcut Parsing**
      if (line.startsWith('@')) {
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
    state.rulesConfig = config.get('rulesConfig');
    state.stateManager.saveStateImmediately(true, true);
    // Update content width dynamically
    updateContentWidth();
    config.close();
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
            #statusBar {
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
            #statusBar {
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
          #statusBar {
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

          console.log('Popup loaded successfully!');
        } catch (error) {
          console.error('Failed to load popup:', error);
        }
      }
      loadSidecarTemplate('body', sidecarTemplatesHtml);
    }

    // Initialize mobileView early so handlers can use it in their constructors
    state.mobileView = window.innerWidth <= 800;
    console.log('Initial mobileView (by width):', state.mobileView, 'width:', window.innerWidth);

    // FIXME: ordering of these is important since posts can tbe in profiles
    handlers = {
      feed: new FeedItemHandler('feed', config, state, api, constants.FEED_ITEM_SELECTOR),
      post: new PostItemHandler('post', config, state, api, constants.POST_ITEM_SELECTOR),
      profile: new ProfileItemHandler('profile', config, state, api, constants.FEED_ITEM_SELECTOR),
      input: new Handler('input', config, state, api),
    };

    // FIXME: find a better place for this
    if (state.rulesConfig) {
      config.set('rulesConfig', state.rulesConfig);
    }
    state.rules = parseRulesConfig(config.get('rulesConfig'));

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

        .sidecar-post {
            margin: 1px;
            ${config.get('replySelectionInactive')}
        }

        /* Sidecar width configuration - only apply when using inline sidecar */
        ${
          !config.get('fixedSidecar')
            ? `
        @media only screen and (min-width: 801px) {
            .item {
                flex: ${100 - (config.get('sidecarWidthPercent') || 30)} !important;
            }
            .sidecar-replies {
                flex: ${config.get('sidecarWidthPercent') || 30} !important;
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

    function setContext(ctx) {
      if (context == ctx) {
        return;
      }
      context = ctx;
      console.log(`context: ${context}`);
      for (const [name, handler] of Object.entries(handlers)) {
        //console.log(name, handler)
        handler.deactivate();
      }
      if (handlers[context]) {
        handlers[context].activate();
      }
    }

    function setContextFromUrl() {
      current_url = window.location.href;

      for (const [name, handler] of Object.entries(handlers)) {
        if (handler.isActive()) {
          setContext(name);
          break;
        }
      }
    }

    function onFocus(e) {
      const target = e.target;
      if (typeof target.tagName === 'undefined') {
        return false;
      }
      const targetTagName = target.tagName.toLowerCase();
      console.log(`onFocus: ${targetTagName}`);
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
      console.log(`onBlur: ${targetTagName}`);
      console.log(e.target);
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
        console.log('viewport element found:', element);
        // Check both element type AND screen width for more reliable detection
        const isMobileByElement = $(element).is(constants.DRAWER_MENU_SELECTOR);
        const isMobileByWidth = window.innerWidth <= 800;
        state.mobileView = isMobileByElement || isMobileByWidth;
        console.log('mobileView:', state.mobileView, '(byElement:', isMobileByElement, ', byWidth:', isMobileByWidth, ')');
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
            console.log('[bsky-nav] Hiding right sidebar');
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
              console.log('[bsky-nav] Hiding "Suggested for you" section');
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

  // Expose config to window for debugging (e.g., config.clearNewConfig())
  unsafeWindow.config = config;

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
