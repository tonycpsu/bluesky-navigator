// main.js

import constants from './constants.js';
import { state } from './state.js';
import { BlueskyAPI } from './api.js';
import * as utils from './utils.js';
import * as configjs from './config.js';

import style from './assets/css/style.css?raw';
import configCss from './assets/css/config.css?raw';
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
const enableLoadMoreItems = false;

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

    state.init(constants.STATE_KEY, stateManagerConfig, onStateInit);
  }

  function onConfigSave() {
    state.rulesConfig = config.get('rulesConfig');
    state.stateManager.saveStateImmediately(true, true);
    config.close();
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
      if (!widthWatcher) {
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
    state.mobileView = false;

    const viewportChangeObserver = waitForElement(
      `${constants.DRAWER_MENU_SELECTOR}, ${constants.LEFT_SIDEBAR_SELECTOR}`,
      (element) => {
        console.log('viewport');
        state.mobileView = $(element).is(constants.DRAWER_MENU_SELECTOR);
        console.log(state.mobileView);
        startMonitor();
        setContextFromUrl();
      }
    );

    // const LEFT_SIDEBAR_SELECTOR = "nav.r-pgf20v"

    function adjustTransformX(el, offset) {
      // debugger;
      let transform = $(el).css('transform');
      const translateX = 0;
      if (!transform || transform == 'none') {
        $(el).css('transform', 'translateX(0px);');
        transform = $(el).css('transform');
      }
      console.log(`translateX = ${translateX}`);
      $(el).css('transform', `translateX(${translateX + offset}px)`);
    }

    function setWidth(leftSidebar, width) {
      const LEFT_TRANSLATE_X_DEFAULT = -540;
      const RIGHT_TRANSLATE_X_DEFAULT = 300;

      const rightSidebar = $(leftSidebar).next();
      if (config.get('hideRightSidebar')) {
        $(rightSidebar).css('display', 'none');
      }

      // // FIXME: the rest of this working recently so we return early
      // return;

      const sidebarDiff = width - 600; // (1 + !config.get("hideRightSidebar"));
      // debugger;
      console.log('sidebarDiff', sidebarDiff);

      if (state.leftSidebarMinimized) {
        console.log('minimized');
        // $(leftSidebar).css("transform", "");
        adjustTransformX(
          leftSidebar,
          LEFT_TRANSLATE_X_DEFAULT - sidebarDiff / 2 + constants.WIDTH_OFFSET
        );
        adjustTransformX('main', sidebarDiff / 2 - constants.WIDTH_OFFSET);
      } else if (sidebarDiff) {
        if (config.get('hideRightSidebar')) {
          adjustTransformX(
            leftSidebar,
            LEFT_TRANSLATE_X_DEFAULT - sidebarDiff / 2 + constants.WIDTH_OFFSET
          );
          adjustTransformX('main', sidebarDiff / 2 - constants.WIDTH_OFFSET);
        } else {
          adjustTransformX(leftSidebar, LEFT_TRANSLATE_X_DEFAULT - sidebarDiff / 2);
          adjustTransformX(rightSidebar, RIGHT_TRANSLATE_X_DEFAULT + sidebarDiff / 2);
        }
      } else {
        console.log('reset sidebars');
        $(leftSidebar).css('transform', `translateX(${LEFT_TRANSLATE_X_DEFAULT}px)`);
        $(rightSidebar).css('transform', `translateX(${RIGHT_TRANSLATE_X_DEFAULT}px)`);
      }

      $(constants.WIDTH_SELECTOR).css('max-width', `${width}px`, '!important');
      $('div[role="tablist"]').css('width', `${width}px`);
      $('#statusBar').css('max-width', `${width}px`);
      $('div[style^="position: fixed; inset: 0px 0px 0px 50%;"]').css('width', `${width}px`);
      // adjustTransformX($('main'), constants.WIDTH_OFFSET);
    }

    state.leftSidebarMinimized = false;
    waitForElement(
      constants.LEFT_SIDEBAR_SELECTOR,
      (leftSidebar) => {
        state.leftSidebarMinimized = !$(leftSidebar).hasClass('r-y46g1k');
        observeChanges(leftSidebar, (attributeName, oldValue, newValue, target) => {
          if ($(leftSidebar).hasClass('r-y46g1k')) {
            state.leftSidebarMinimized = false;
          } else {
            state.leftSidebarMinimized = true;
          }
          console.log(state.leftSidebarMinimized);
        });
      }
      // (leftSidebar) => {
      //     console.log("removed");
      // }
    );

    let resizeTimer;

    function onWindowResize() {
      if (state.mobileView) {
        return;
      }
      console.log('Resized to: ' + $(window).width() + 'x' + $(window).height());
      if (state.mobileView) {
        return;
      } else {
        const leftSidebar = $(constants.LEFT_SIDEBAR_SELECTOR);
        const rightSidebar = $(leftSidebar).next();

        const leftSidebarWidth = $(leftSidebar).outerWidth();
        // debugger;
        const remainingWidth =
          $(window).width() -
          leftSidebarWidth -
          // - (!state.leftSidebarMinimized ? $(rightSidebar).outerWidth() : 0)
          !config.get('hideRightSidebar') * ($(rightSidebar).outerWidth() || 0) -
          constants.WIDTH_OFFSET;
        // debugger;
        console.log('remainingWidth', remainingWidth, 'leftSidebarWidth', leftSidebarWidth);
        if (remainingWidth >= config.get('postWidthDesktop')) {
          setWidth($(constants.LEFT_SIDEBAR_SELECTOR), config.get('postWidthDesktop'));
        } else {
          // console.log("too narrow");
          setWidth($(constants.LEFT_SIDEBAR_SELECTOR), remainingWidth);
        }
      }
    }

    $(window).resize(function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onWindowResize, 500); // Adjust delay as needed
    });

    waitForElement(constants.WIDTH_SELECTOR, onWindowResize);

    function proxyIntersectionObserver() {
      const OriginalIntersectionObserver = unsafeWindow.IntersectionObserver;

      // Create a proxy class
      class ProxyIntersectionObserver {
        constructor(callback, options) {
          // Store the callback and options
          this.callback = callback;
          this.options = options;
          this.enabled = true;
          handlers['feed'].loadOlderItemsCallback = this.callback;
          // Create the "real" IntersectionObserver instance
          this.realObserver = new OriginalIntersectionObserver((entries, observer) => {
            // filter thread divs out
            const filteredEntries = entries.filter(
              (entry) =>
                !(
                  $(entry.target).hasClass('thread') ||
                  $(entry.target).hasClass('item') ||
                  $(entry.target).find('div[data-testid^="feedItem"]').length ||
                  $(entry.target).next()?.attr('style') == 'height: 32px;'
                )
            );

            // if(filteredEntries.length) {
            //     debugger;
            // }

            callback(filteredEntries, observer);
          }, options);
        }

        enable() {
          this.enabled = true;
        }

        disable() {
          this.enabled = false;
        }

        // Custom logic to decide when to override
        shouldOverride(entries, observer) {
          return !enableLoadMoreItems;
        }

        // Custom override behavior
        overrideBehavior(entries, observer) {
          // Example: Do nothing or log the entries
          // console.log("Overridden entries:", entries);
        }

        // Proxy all methods to the real IntersectionObserver
        observe(target) {
          // console.log("Observing:", target);
          this.realObserver.observe(target);
        }

        unobserve(target) {
          // console.log("Unobserving:", target);
          this.realObserver.unobserve(target);
        }

        disconnect() {
          // console.log("Disconnecting observer");
          this.realObserver.disconnect();
        }

        takeRecords() {
          return this.realObserver.takeRecords();
        }
      }

      // Replace the global IntersectionObserver with the proxy
      unsafeWindow.IntersectionObserver = ProxyIntersectionObserver;
    }
    proxyIntersectionObserver();
  }

  const configTitleDiv = `
    <div class="config-title">
      <h1><a href="https://github.com/tonycpsu/bluesky-navigator" target="_blank">Bluesky Navigator</a> v${GM_info.script.version}</h1>
      <h2>Configuration</h2>
    </div>
  `;

  function waitForGMConfig(callback) {
    if (typeof GM_config !== 'undefined') {
      callback();
    } else {
      console.warn('GM_config not available yet. Retrying...');
      setTimeout(() => waitForGMConfig(callback), 100);
    }
  }

  waitForGMConfig(() => {
    config = new GM_config({
      id: 'GM_config',
      title: configTitleDiv,
      fields: configjs.CONFIG_FIELDS,
      events: {
        init: onConfigInit,
        save: onConfigSave,
        close: () =>
          $('#preferencesIconImage').attr('src', handlers['feed'].INDICATOR_IMAGES.preferences[0]),
      },
      css: configCss,
    });
  });

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
