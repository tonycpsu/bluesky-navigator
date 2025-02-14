// ==UserScript==
// @name        bluesky-navigator
// @description Adds Vim-like navigation, read/unread post-tracking, and other features to Bluesky
// @version     1.0.31+291.ed8d6793
// @author      https://bsky.app/profile/tonyc.org
// @namespace   https://tonyc.org/
// @match       https://bsky.app/*
// @require     https://code.jquery.com/jquery-3.7.1.min.js
// @require     https://raw.githubusercontent.com/sizzlemctwizzle/GM_config/refs/heads/master/gm_config.js
// @require     https:code.jquery.com/ui/1.12.1/jquery-ui.min.js
// @downloadURL https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/dist/bluesky-navigator.user.js
// @updateURL   https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/dist/bluesky-navigator.user.js
// @connect     clearsky.services
// @connect     surreal.cloud
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_addStyle
// @grant       GM_xmlhttpRequest
// @grant       GM_info
// @grant       unsafeWindow
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.xmlhttpRequest
// ==/UserScript==

(function() {
  "use strict";
  const constants$1 = {
    URL_MONITOR_INTERVAL: 500,
    STATE_KEY: "bluesky_state",
    DRAWER_MENU_SELECTOR: 'button[aria-label="Open drawer menu"]',
    SCREEN_SELECTOR: "main > div > div > div",
    HOME_SCREEN_SELECTOR: 'div[data-testid="HomeScreen"]',
    get FEED_TAB_SELECTOR() {
      return `${constants$1.HOME_SCREEN_SELECTOR} > div > div`;
    },
    get TOOLBAR_CONTAINER_SELECTOR() {
      return `${constants$1.FEED_TAB_SELECTOR} > div:first-child`;
    },
    LOAD_NEW_BUTTON_SELECTOR: "button[aria-label^='Load new']",
    get LOAD_NEW_INDICATOR_SELECTOR() {
      return `${constants$1.LOAD_NEW_BUTTON_SELECTOR} div[style*="border-color: rgb(197, 207, 217)"]`;
    },
    get FEED_CONTAINER_SELECTOR() {
      return `${constants$1.HOME_SCREEN_SELECTOR} div[data-testid$="FeedPage"] div[style*="removed-body-scroll-bar-size"] > div`;
    },
    get STATUS_BAR_CONTAINER_SELECTOR() {
      return `${constants$1.HOME_SCREEN_SELECTOR} div[data-testid$="FeedPage"] div[style*="removed-body-scroll-bar-size"]`;
    },
    FEED_ITEM_SELECTOR: 'div:not(.css-175oi2r) > div[tabindex="0"][role="link"]:not(.r-1awozwy)',
    LEFT_SIDEBAR_SELECTOR: "nav.r-pgf20v",
    POST_ITEM_SELECTOR: 'div[data-testid^="postThreadItem-by-"]',
    WIDTH_SELECTOR: 'div[style*="removed-body-scroll-bar-size"][style*="width: 100%"]',
    PROFILE_SELECTOR: 'a[aria-label="View profile"]',
    LINK_SELECTOR: 'a[target="_blank"]',
    CLEARSKY_BLOCKED_ALL_CSS: { "background-color": "#ff8080" },
    CLEARSKY_BLOCKED_RECENT_CSS: { "background-color": "#cc4040" }
  };
  const DEFAULT_HISTORY_MAX = 5e3;
  class StateManager {
    constructor(key, defaultState = {}, config2 = {}) {
      this.key = key;
      this.config = config2;
      if (!this.config) {
        debugger;
      }
      this.listeners = [];
      this.debounceTimeout = null;
      this.maxEntries = this.config.maxEntries || DEFAULT_HISTORY_MAX;
      this.state = {};
      this.isLocalStateDirty = false;
      this.localSaveTimeout = null;
      this.remoteSyncTimeout = null;
      this.handleBlockListResponse = this.handleBlockListResponse.bind(this);
      this.saveStateImmediately = this.saveStateImmediately.bind(this);
      window.addEventListener("beforeunload", () => this.saveStateImmediately());
    }
    static async create(key, defaultState = {}, config2 = {}) {
      const instance = new StateManager(key, defaultState, config2);
      await instance.initializeState(defaultState);
      return instance;
    }
    async initializeState(defaultState) {
      this.state = await this.loadState(defaultState);
      this.ensureBlockState();
      this.updateBlockList();
    }
    ensureBlockState() {
      if (!this.state.blocks) {
        this.state.blocks = {
          all: { updated: null, handles: [] },
          recent: { updated: null, handles: [] }
        };
      }
    }
    setSyncStatus(status, title) {
      const overlay = $(".preferences-icon-overlay");
      if (!overlay) {
        console.log("no overlay");
        return;
      }
      $(overlay).attr("title", `sync: ${status} ${title || ""}`);
      for (const s of ["ready", "pending", "success", "failure"]) {
        $(overlay).removeClass(`preferences-icon-overlay-sync-${s}`);
      }
      $(overlay).addClass(`preferences-icon-overlay-sync-${status}`);
      if (status == "success") {
        setTimeout(() => this.setSyncStatus("ready"), 3e3);
      }
    }
    /**
     * Executes a query against the remote database.
     * @param {string} query - The query string to execute.
     * @param {string} successStatus - The status to set on successful execution (e.g., "success").
     * @returns {Promise<Object>} - Resolves with the parsed result of the query.
     */
    async executeRemoteQuery(query, successStatus = "success") {
      const { url, namespace = "bluesky_navigator", database = "state", username, password } = JSON.parse(this.config.stateSyncConfig);
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: `${url.replace(/\/$/, "")}/sql`,
          headers: {
            "Accept": "application/json",
            "Authorization": "Basic " + btoa(`${username}:${password}`)
          },
          data: `USE NS ${namespace} DB ${database}; ${query}`,
          onload: (response) => {
            try {
              if (response.status !== 200) {
                throw new Error(response.statusText);
              }
              const result = JSON.parse(response.responseText)[1]?.result[0];
              this.setSyncStatus(successStatus);
              resolve(result);
            } catch (error) {
              console.error("Error executing query:", error.message);
              this.setSyncStatus("failure", error.message);
              reject(error);
            }
          },
          onerror: (error) => {
            console.error("Network error executing query:", error.message);
            this.setSyncStatus("failure", error.message);
            reject(error);
          }
        });
      });
    }
    async getRemoteStateUpdated() {
      const sinceResult = await this.executeRemoteQuery(`SELECT lastUpdated FROM state:current;`);
      sinceResult["lastUpdated"];
      return sinceResult["lastUpdated"];
    }
    /**
     * Loads state from storage or initializes with the default state.
     */
    async loadState(defaultState) {
      try {
        const savedState = JSON.parse(GM_getValue(this.key, "{}"));
        if (this.config.stateSyncEnabled) {
          const remoteState = await this.loadRemoteState(this.state.lastUpdated);
          return remoteState ? { ...defaultState, ...remoteState } : { ...defaultState, ...savedState };
        } else {
          return { ...defaultState, ...savedState };
        }
      } catch (error) {
        console.error("Error loading state, using defaults:", error);
        return defaultState;
      }
    }
    async loadRemoteState(since) {
      try {
        console.log("Loading remote state...");
        this.setSyncStatus("pending");
        const lastUpdated = await this.getRemoteStateUpdated();
        if (!since || !lastUpdated || new Date(since) < new Date(lastUpdated)) {
          console.log(`Remote state is newer: ${since} < ${lastUpdated}`);
          const result = await this.executeRemoteQuery("SELECT * FROM state:current;");
          const stateObj = result || {};
          delete stateObj.id;
          console.log("Remote state loaded successfully.");
          return stateObj;
        } else {
          console.log(`Local state is newer: ${since} >= ${lastUpdated}`);
          return null;
        }
      } catch (error) {
        console.error("Failed to load remote state:", error);
        return {};
      }
    }
    /**
     * Updates the state and schedules a chained local and remote save.
     */
    updateState(newState) {
      this.state = { ...this.state, ...newState };
      this.state.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
      this.isLocalStateDirty = true;
      this.scheduleLocalSave();
    }
    /**
     * Schedules a local state save after a 1-second delay.
     * Triggers remote sync only if local state is saved.
     */
    scheduleLocalSave() {
      clearTimeout(this.localSaveTimeout);
      this.localSaveTimeout = setTimeout(() => {
        const shouldSyncRemote = this.isLocalStateDirty;
        this.saveLocalState().then(() => {
          if (shouldSyncRemote) {
            this.scheduleRemoteSync();
          }
        });
      }, this.config.stateSaveTimeout);
    }
    /**
     * Saves the local state and resolves a promise.
     * @returns {Promise<void>}
     */
    async saveLocalState() {
      console.log("Saving local state...");
      this.cleanupState();
      GM_setValue(this.key, JSON.stringify(this.state));
      console.log("Local state saved.");
      this.isLocalStateDirty = false;
      this.notifyListeners();
    }
    /**
     * Schedules a remote state synchronization after a longer delay.
     */
    scheduleRemoteSync() {
      if (!this.config.stateSyncEnabled) {
        console.log("sync disabled");
        return;
      }
      clearTimeout(this.remoteSyncTimeout);
      this.remoteSyncTimeout = setTimeout(() => {
        this.saveRemoteState(this.state.lastUpdated);
      }, this.config.stateSyncTimeout);
    }
    /**
     * Saves the remote state if needed.
     */
    async saveRemoteState(since) {
      const { url, namespace = "bluesky_navigator", database = "state", username, password } = JSON.parse(this.config.stateSyncConfig);
      try {
        const lastUpdated = await this.getRemoteStateUpdated();
        if (!since || !lastUpdated || new Date(since) < new Date(lastUpdated)) {
          console.log("Not saving because remote state is newer.");
          return;
        }
        console.log("Saving remote state...");
        this.setSyncStatus("pending");
        await this.executeRemoteQuery(
          `UPSERT state:current MERGE {${JSON.stringify(this.state).slice(1, -1)}, created_at: time::now()}`,
          "success"
        );
      } catch (error) {
        console.error("Failed to save remote state:", error);
      }
    }
    /**
     * Immediately saves both local and remote states.
     */
    saveStateImmediately(saveLocal = true, saveRemote = false) {
      if (saveLocal) {
        this.saveLocalState();
      }
      if (this.config.stateSyncEnabled && saveRemote) {
        this.saveRemoteState(this.state.lastUpdated);
      }
    }
    /**
     * Keeps only the most recent N entries in the state.
     */
    cleanupState() {
      if (this.state.seen) {
        this.state.seen = this.keepMostRecentValues(this.state.seen, this.maxEntries);
      }
    }
    /**
     * Utility to keep only the most recent N entries in an object.
     * Assumes values are ISO date strings for sorting.
     * @param {Object} obj - The object to prune.
     * @param {number} maxEntries - The maximum number of entries to retain.
     */
    keepMostRecentValues(obj, maxEntries) {
      const entries = Object.entries(obj);
      entries.sort(([, dateA], [, dateB]) => new Date(dateB) - new Date(dateA));
      return Object.fromEntries(entries.slice(0, maxEntries));
    }
    /**
     * Resets state to the default value.
     * @param {Object} defaultState - The default state object.
     */
    resetState(defaultState = {}) {
      this.state = defaultState;
    }
    /**
     * Registers a listener for state changes.
     * @param {function} callback - The listener function to invoke on state change.
     */
    addListener(callback) {
      if (typeof callback === "function") {
        this.listeners.push(callback);
      }
    }
    /**
     * Notifies all registered listeners of a state change.
     */
    notifyListeners() {
      this.listeners.forEach((callback) => callback(this.state));
    }
    handleBlockListResponse(response, responseKey, stateKey) {
      var jsonResponse = $.parseJSON(response.response);
      try {
        this.state.blocks[stateKey].handles = jsonResponse.data[responseKey].map(
          (entry) => entry.Handle
        );
        this.state.blocks[stateKey].updated = Date.now();
      } catch (error) {
        console.warn("couldn't fetch block list");
      }
    }
    updateBlockList() {
      const blockConfig = {
        all: {
          url: "https://api.clearsky.services/api/v1/anon/lists/fun-facts",
          responseKey: "blocked"
        },
        recent: {
          url: "https://api.clearsky.services/api/v1/anon/lists/funer-facts",
          responseKey: "blocked24"
        }
      };
      for (const [stateKey, cfg] of Object.entries(blockConfig)) {
        if (this.state.blocks[stateKey].updated == null || Date.now() + constants.CLEARSKY_LIST_REFRESH_INTERVAL > this.state.blocks[stateKey].updated) {
          GM_xmlhttpRequest({
            method: "GET",
            url: cfg.url,
            headers: {
              Accept: "application/json"
            },
            onload: (response) => this.handleBlockListResponse(response, cfg.responseKey, stateKey)
          });
        }
      }
    }
  }
  const DEFAULT_STATE = {
    seen: {},
    lastUpdated: null,
    page: "home",
    "blocks": { "all": [], "recent": [] },
    feedSortReverse: false,
    feedHideRead: false
  };
  let stateManager;
  const target = {
    init(key, config2, onSuccess) {
      StateManager.create(key, DEFAULT_STATE, config2).then((initializedStateManager) => {
        stateManager = initializedStateManager;
        console.log("State initialized");
        console.dir(stateManager.state);
        onSuccess();
      }).catch((error) => {
        console.error("Failed to initialize StateManager:", error);
      });
    }
  };
  const state = new Proxy(target, {
    get(target2, prop, receiver) {
      if (prop in target2) {
        return typeof target2[prop] === "function" ? target2[prop].bind(receiver) : target2[prop];
      } else if (prop == "stateManager") {
        return stateManager;
      } else if (prop in stateManager.state) {
        return stateManager.state[prop];
      }
      console.warn(`State Warning: ${prop} is not defined`);
      return void 0;
    },
    set(target2, prop, value) {
      console.log(`State Update: ${prop} = ${value}`);
      stateManager.state[prop] = value;
      return true;
    }
  });
  let debounceTimeout;
  function debounce(func, delay) {
    return function(...args) {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => func.apply(this, args), delay);
    };
  }
  function waitForElement$2(selector, onAdd, onRemove, onChange, ignoreExisting) {
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
          if (mutation.type === "attributes") {
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
  function observeChanges$1(target2, callback, subtree) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          const attributeName = mutation.attributeName;
          const oldValue = mutation.oldValue;
          const newValue = mutation.target.getAttribute(attributeName);
          if (oldValue !== newValue) {
            callback(attributeName, oldValue, newValue, mutation.target);
          }
        }
      });
    });
    observer.observe(target2, {
      attributes: true,
      attributeOldValue: true,
      subtree: !!subtree
    });
    return observer;
  }
  function observeVisibilityChange$1($element, callback) {
    const target2 = $element[0];
    const observer = new MutationObserver(() => {
      const isVisible = $element.is(":visible");
      callback(isVisible);
    });
    observer.observe(target2, {
      attributes: true,
      childList: true,
      subtree: false
      // Only observe the target element
    });
    return () => observer.disconnect();
  }
  function splitTerms(input) {
    return input.split(/\s+/).filter((term) => term.length > 0);
  }
  function extractLastTerm(input) {
    let terms = splitTerms(input);
    return terms.length > 0 ? terms[terms.length - 1] : "";
  }
  const utils = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    debounce,
    extractLastTerm,
    observeChanges: observeChanges$1,
    observeVisibilityChange: observeVisibilityChange$1,
    splitTerms,
    waitForElement: waitForElement$2
  }, Symbol.toStringTag, { value: "Module" }));
  const CONFIG_FIELDS = {
    "displaySection": {
      "section": [GM_config.create("Display Preferences"), "Customize how items are displayed"],
      "type": "hidden"
    },
    "postWidthDesktop": {
      "label": "Width of posts in pixels when in desktop mode",
      "type": "integer",
      "default": "600"
    },
    "postActionButtonPosition": {
      "label": "Post actino button position",
      "title": "Where to position reply, repost, like, etc. buttons",
      "type": "select",
      "options": ["Bottom", "Left"],
      "default": "Bottom"
    },
    "posts": {
      "label": "CSS Style: All Posts",
      "type": "textarea",
      "default": "padding 1px;"
    },
    "unreadPosts": {
      "label": "CSS Style: Unread Posts",
      "type": "textarea",
      "default": "opacity: 100% !important;"
    },
    "unreadPostsLightMode": {
      "label": "CSS Style: Unread Posts (Light Mode)",
      "type": "textarea",
      "default": "background-color: white;"
    },
    "unreadPostsDarkMode": {
      "label": "CSS Style: Unread Posts (Dark Mode)",
      "type": "textarea",
      "default": "background-color: #202020;"
    },
    "readPosts": {
      "label": "CSS Style: Read Posts",
      "type": "textarea",
      "default": "opacity: 75% !important;"
    },
    "readPostsLightMode": {
      "label": "CSS Style: Read Posts (Light Mode)",
      "type": "textarea",
      "default": "background-color: #f0f0f0;"
    },
    "readPostsDarkMode": {
      "label": "CSS Style: Read Posts (Dark Mode)",
      "type": "textarea",
      "default": "background-color: black;"
    },
    "selectionActive": {
      "label": "CSS Style: Selected Post",
      "type": "textarea",
      "default": "border: 3px rgba(255, 0, 0, .3) solid !important;"
    },
    "selectionInactive": {
      "label": "CSS Style: Unselected Post",
      "type": "textarea",
      "default": "border: 3px solid transparent;"
    },
    "threadIndicatorWidth": {
      "label": "Thread Indicator Width in pixels",
      "type": "integer",
      "default": "4"
    },
    "threadIndicatorColor": {
      "label": "Thread Indicator Color",
      "type": "textarea",
      "default": "rgb(212, 219, 226)"
    },
    "threadMargin": {
      "label": "Thread Margin",
      "type": "textarea",
      "default": "10px"
    },
    "postTimestampFormat": {
      "label": "Post timestamp format",
      "title": "A format string specifying how post timestamps are displayed",
      "type": "textarea",
      "default": "'$age' '('yyyy-MM-dd hh:mmaaa')'"
    },
    "videoPreviewPlayback": {
      "label": "Video Preview Playback",
      "title": "Control playback of video previews",
      "type": "select",
      "options": ["Play all", "Play selected", "Pause all"]
    },
    "hideLoadNewButton": {
      "label": "Hide Load New Button",
      "title": "If checked, the floating button to load new items will be hidden.",
      "type": "checkbox",
      "default": false
    },
    "showPostCounts": {
      "label": "Show Post Counts",
      "title": "Specify whether post counts are displayed in all, selected, or no posts.",
      "type": "select",
      "options": ["All", "Selection", "None"],
      "default": "All"
    },
    "enableSmoothScrolling": {
      "label": "Enable Smooth Scrolling",
      "title": "If checked, scrolling using keyboard navigation will be smooth \u{1F6E5}\uFE0F \u{1F3B7}",
      "type": "checkbox",
      "default": false
    },
    "stateSyncSection": {
      "section": [GM_config.create("State Sync"), 'Sync state between different browsers via cloud storage -- see <a href="https://github.com/tonycpsu/bluesky-navigator/blob/main/doc/remote_state.md" target="_blank">here</a> for details.'],
      "type": "hidden"
    },
    "stateSyncEnabled": {
      "label": "Enable State Sync",
      "title": "If checked, synchronize state to/from the cloud",
      "type": "checkbox",
      "default": false
    },
    "stateSyncConfig": {
      "label": "State Sync Configuration (JSON)",
      "title": "JSON object containing state information",
      "type": "textarea"
    },
    "stateSyncTimeout": {
      "label": "State Sync Timeout",
      "title": "Number of milliseconds of idle time before syncing state",
      "type": "int",
      "default": 5e3
    },
    "rulesSection": {
      "section": [GM_config.create("Rules"), "Post Rules"],
      "type": "hidden"
    },
    "rulesConfig": {
      "label": "Filters Configuration",
      "type": "textarea"
    },
    "miscellaneousSection": {
      "section": [GM_config.create("Miscellaneous"), "Other settings"],
      "type": "hidden"
    },
    "markReadOnScroll": {
      "label": "Mark Read on Scroll",
      "title": "If checked, items will be marked read while scrolling",
      "type": "checkbox",
      "default": false
    },
    "disableLoadMoreOnScroll": {
      "label": "Disable Load More on Scroll",
      "title": 'If checked, the default behavior of loading more items when scrolling will be disabled. You can still press "U" to load more manually.',
      "type": "checkbox",
      "default": false
    },
    "savePostState": {
      "label": "Save Post State",
      "title": "If checked, read/unread state is kept for post items in addition to feed items",
      "type": "checkbox",
      "default": false
    },
    "stateSaveTimeout": {
      "label": "State Save Timeout",
      "title": "Number of milliseconds of idle time before saving state locally",
      "type": "int",
      "default": 1e3
    },
    "historyMax": {
      "label": "History Max Size",
      "title": "Maximum number of posts to remember for saving read state",
      "type": "int",
      "default": constants$1.DEFAULT_HISTORY_MAX
    },
    "showDebuggingInfo": {
      "label": "Enable Debugging",
      "title": "If checked, some debugging info will be shown in posts",
      "type": "checkbox",
      "default": false
    }
  };
  const style = '/* style.css */\n\ndiv[style^="position: fixed; inset: 0px 0px 0px 50%;"] {\n    border: none;\n}\n\ndiv#logContainer {\n    width: 100%;\n    bottom: 0;\n    pointer-events: none;\n    height: 25%;\n    position: fixed;\n    background: rgba(0, 0, 0, 0.2);\n    color: #e0e0e0;\n    font-family: monospace;\n    font-size: 12px;\n    z-index: 10000;\n    padding: 10px;\n    padding-top: 30px;\n}\n\n#logHeader {\n    position: relative;\n    width: 100%;\n    background: #333;\n    color: white;\n    padding: 5px 10px;\n    box-sizing: border-box;\n    pointer-events: auto;\n}\n\nbutton#clearLogs {\n    position: absolute;\n    top: 0;\n    left: 0;\n    width: 100px;\n    background: red;\n    color: white;\n    border: none;\n    padding: 2px 5px;\n    cursor: pointer;\n}\n\n#logContent {\n    overflow-y: auto;\n    max-height: calc(70% - 30px);\n    padding: 10px;\n    box-sizing: border-box;\n}\n\ndiv#bsky-navigator-toolbar {\n    display: flex;\n    flex-direction: row;\n    position: sticky;\n    top: 0;\n    align-items: center;\n    background-color: rgb(255, 255, 255);\n    width: 100%;\n    height: 32px;\n    border-bottom: 1px solid rgb(192, 192, 192);\n}\n\n.toolbar-icon {\n    margin: 0px;\n    width: 24px;\n    height: 24px;\n    padding: 0px 8px;\n    flex: 1;\n}\n\n.toolbar-icon-pending {\n    animation: fadeInOut 1s infinite !important;\n}\n\n.indicator-image {\n    width: 24px;\n    height: 24px;\n}\n\n/* img#loadNewerIndicatorImage { */\n/*     opacity: 0.2; */\n/* } */\n\n/* img#loadOlderIndicatorImage { */\n/*     opacity: 0.2; */\n/* } */\n\ndiv#infoIndicator {\n    flex: 3;\n}\n\ndiv#infoIndicatorText {\n    font-size: 0.8em;\n}\n\ndiv#itemTimestampStats {\n    font-size: 0.7em;\n}\n\n#bsky-navigator-search {\n    flex: 1;\n    margin: 0px 8px;\n    z-index: 10;\n    font: 14px "DejaVu Sans Mono", "Lucida Console", "Courier New", monospace;\n}\n\n.ui-autocomplete {\n    position: absolute !important;\n    background-color: white !important;\n    border: 1px solid #ccc !important;\n    z-index: 1000 !important;\n    max-height: 200px !important;\n    overflow-y: auto !important;\n    list-style-type: none !important;\n    font: 14px "DejaVu Sans Mono", "Lucida Console", "Courier New", monospace;\n    padding: 2px !important;\n}\n\n.ui-menu-item {\n    padding: 2px !important;\n    font-size: 14px !important;\n    color: black !important;\n}\n\n/* Highlight hovered item */\n.ui-state-active {\n    background-color: #007bff !important;\n    color: white !important;\n}\n\n@media only screen and not (max-width: 800px) {\n    div#statusBar {\n        display: flex;\n        width: 100%;\n        height: 32px;\n        margin-left: auto;\n        margin-right: auto;\n        position: sticky;\n        z-index: 10;\n        align-items: center;\n        background-color: rgb(255, 255, 255);\n        bottom: 0;\n        font-size: 1em;\n        padding: 1px;\n        border-top: 1px solid rgb(192, 192, 192);\n    }\n}\n\n@media only screen and (max-width: 800px) {\n    div#statusBar {\n        display: flex;\n        width: 100%;\n        height: 32px;\n        margin-left: auto;\n        margin-right: auto;\n        position: sticky;\n        z-index: 10;\n        align-items: center;\n        background-color: rgb(255, 255, 255);\n        bottom: 58px;\n        font-size: 1em;\n        padding: 1px;\n    }\n}\n\ndiv#statusBarLeft {\n    display: flex;\n    flex: 1;\n    text-align: left;\n    padding: 1px;\n}\n\ndiv#statusBarCenter {\n    display: flex;\n    flex: 1 1 auto;\n    text-align: center;\n    padding: 1px;\n}\n\ndiv#statusBarRight {\n    display: flex;\n    flex: 1;\n    text-align: right;\n    padding: 1px;\n}\n\n#prevButton {\n    z-index: 1000;\n    position: absolute;\n    top: 30%;\n    right: -10px;\n    opacity: 20%;\n}\n\n#prevButton.mobile {\n    position: fixed;\n    left: 1%;\n    top: 25%;\n}\n\n#nextButton {\n    z-index: 1000;\n    position: absolute;\n    bottom: 30%;\n    right: -10px;\n    opacity: 20%;\n}\n\n#nextButton.mobile {\n    position: fixed;\n    left: 1%;\n    bottom: 20%;\n}\n\nnav.r-1wyvozj {\n    overflow: inherit;\n}\n\n@keyframes oscillateBorderBottom {\n    0% {\n        border-bottom-color: rgba(0, 128, 0, 1);\n    }\n    50% {\n        border-bottom-color: rgba(0, 128, 0, 0.3);\n    }\n    100% {\n        border-bottom-color: rgba(0, 128, 0, 1);\n    }\n}\n\n@keyframes oscillateBorderTop {\n    0% {\n        border-top-color: rgba(0, 128, 0, 1);\n    }\n    50% {\n        border-top-color: rgba(0, 128, 0, 0.3);\n    }\n    100% {\n        border-top-color: rgba(0, 128, 0, 1);\n    }\n}\n\n@keyframes fadeInOut {\n    0% {\n        opacity: 0.2;\n    }\n    50% {\n        opacity: 1;\n    }\n    100% {\n        opacity: 0.2;\n    }\n}\n\ndiv.loading-indicator-reverse {\n    border-bottom: 10px solid;\n    animation: oscillateBorderBottom 0.2s infinite;\n}\n\ndiv.loading-indicator-forward {\n    border-top: 10px solid;\n    animation: oscillateBorderTop 0.2s infinite;\n}\n\n.filtered {\n    display: none !important;\n}\n\n#messageContainer {\n    inset: 5%;\n    padding: 10px;\n}\n\n.messageTitle {\n    font-size: 1.5em;\n    text-align: center;\n}\n\n.messageBody {\n    font-size: 1.2em;\n}\n\n#messageActions a {\n    color: #8040c0;\n}\n\n#messageActions a:hover {\n    text-decoration: underline;\n    cursor: pointer;\n}\n\n.preferences-icon-overlay {\n    background-color: #cccccc;\n    cursor: pointer;\n    justify-content: center;\n    z-index: 1000;\n}\n\n.preferences-icon-overlay-sync-ready {\n    background-color: #d5f5e3;\n}\n\n.preferences-icon-overlay-sync-pending {\n    animation: fadeInOut 1s infinite;\n    background-color: #f9e79f;\n}\n\n.preferences-icon-overlay-sync-success {\n    background-color: #2ecc71;\n}\n\n.preferences-icon-overlay-sync-failure {\n    background-color: #ec7063 ;\n}\n\n.preferences-icon-overlay span {\n    color: white;\n    font-size: 16px;\n}\n\ndiv.item-banner {\n    position: absolute;\n    top: 0;\n    left: 0;\n    font-family: "Lucida Console", "Courier New", monospace;\n    font-size: 0.7em;\n    z-index: 10;\n    color: black;\n    text-shadow: 1px 1px rgba(255, 255, 255,0.8);\n    background: rgba(128, 192, 192, 0.3);\n    padding: 3px;\n    border-radius: 4px;\n}\n\n.image-highlight {\n    filter: invert(36%) sepia(28%) saturate(5764%) hue-rotate(194deg) brightness(102%) contrast(105%);\n}\n\n.load-time-icon {\n    position: absolute;\n    bottom: 2px;\n    width: 24px;\n    height: 24px;\n    opacity: 0.8;\n    filter: invert(93%) sepia(49%) saturate(2805%) hue-rotate(328deg) brightness(99%) contrast(96%) drop-shadow( 0.2px  0px 0px black)\n        drop-shadow(-0.2px  0px 0px black)\n        drop-shadow( 0px  0.2px 0px black)\n        drop-shadow( 0px -0.2px 0px black);\n}\n\n.image-flip-x {\n    transform: scaleX(-1);\n    -webkit-transform: scaleX(-1);\n}\n';
  const configCss = "h1 {\n    font-size: 18pt;\n}\n\nh2 {\n    font-size: 14pt;\n}\n.config_var textarea {\n    width: 100%;\n    height: 1.5em;\n}\n\n#GM_config_rulesConfig_var textarea {\n    height: 10em;\n}\n\n#GM_config_stateSyncConfig_var textarea {\n    height: 10em;\n}\n";
  const millisecondsInWeek = 6048e5;
  const millisecondsInDay = 864e5;
  const constructFromSymbol = Symbol.for("constructDateFrom");
  function constructFrom(date, value) {
    if (typeof date === "function") return date(value);
    if (date && typeof date === "object" && constructFromSymbol in date)
      return date[constructFromSymbol](value);
    if (date instanceof Date) return new date.constructor(value);
    return new Date(value);
  }
  function toDate(argument, context) {
    return constructFrom(context || argument, argument);
  }
  let defaultOptions = {};
  function getDefaultOptions() {
    return defaultOptions;
  }
  function startOfWeek(date, options) {
    const defaultOptions2 = getDefaultOptions();
    const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
    const _date = toDate(date, options?.in);
    const day = _date.getDay();
    const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
    _date.setDate(_date.getDate() - diff);
    _date.setHours(0, 0, 0, 0);
    return _date;
  }
  function startOfISOWeek(date, options) {
    return startOfWeek(date, { ...options, weekStartsOn: 1 });
  }
  function getISOWeekYear(date, options) {
    const _date = toDate(date, options?.in);
    const year = _date.getFullYear();
    const fourthOfJanuaryOfNextYear = constructFrom(_date, 0);
    fourthOfJanuaryOfNextYear.setFullYear(year + 1, 0, 4);
    fourthOfJanuaryOfNextYear.setHours(0, 0, 0, 0);
    const startOfNextYear = startOfISOWeek(fourthOfJanuaryOfNextYear);
    const fourthOfJanuaryOfThisYear = constructFrom(_date, 0);
    fourthOfJanuaryOfThisYear.setFullYear(year, 0, 4);
    fourthOfJanuaryOfThisYear.setHours(0, 0, 0, 0);
    const startOfThisYear = startOfISOWeek(fourthOfJanuaryOfThisYear);
    if (_date.getTime() >= startOfNextYear.getTime()) {
      return year + 1;
    } else if (_date.getTime() >= startOfThisYear.getTime()) {
      return year;
    } else {
      return year - 1;
    }
  }
  function getTimezoneOffsetInMilliseconds(date) {
    const _date = toDate(date);
    const utcDate = new Date(
      Date.UTC(
        _date.getFullYear(),
        _date.getMonth(),
        _date.getDate(),
        _date.getHours(),
        _date.getMinutes(),
        _date.getSeconds(),
        _date.getMilliseconds()
      )
    );
    utcDate.setUTCFullYear(_date.getFullYear());
    return +date - +utcDate;
  }
  function normalizeDates(context, ...dates) {
    const normalize = constructFrom.bind(
      null,
      dates.find((date) => typeof date === "object")
    );
    return dates.map(normalize);
  }
  function startOfDay(date, options) {
    const _date = toDate(date, options?.in);
    _date.setHours(0, 0, 0, 0);
    return _date;
  }
  function differenceInCalendarDays(laterDate, earlierDate, options) {
    const [laterDate_, earlierDate_] = normalizeDates(
      options?.in,
      laterDate,
      earlierDate
    );
    const laterStartOfDay = startOfDay(laterDate_);
    const earlierStartOfDay = startOfDay(earlierDate_);
    const laterTimestamp = +laterStartOfDay - getTimezoneOffsetInMilliseconds(laterStartOfDay);
    const earlierTimestamp = +earlierStartOfDay - getTimezoneOffsetInMilliseconds(earlierStartOfDay);
    return Math.round((laterTimestamp - earlierTimestamp) / millisecondsInDay);
  }
  function startOfISOWeekYear(date, options) {
    const year = getISOWeekYear(date, options);
    const fourthOfJanuary = constructFrom(date, 0);
    fourthOfJanuary.setFullYear(year, 0, 4);
    fourthOfJanuary.setHours(0, 0, 0, 0);
    return startOfISOWeek(fourthOfJanuary);
  }
  function isDate(value) {
    return value instanceof Date || typeof value === "object" && Object.prototype.toString.call(value) === "[object Date]";
  }
  function isValid(date) {
    return !(!isDate(date) && typeof date !== "number" || isNaN(+toDate(date)));
  }
  function startOfYear(date, options) {
    const date_ = toDate(date, options?.in);
    date_.setFullYear(date_.getFullYear(), 0, 1);
    date_.setHours(0, 0, 0, 0);
    return date_;
  }
  const formatDistanceLocale = {
    lessThanXSeconds: {
      one: "less than a second",
      other: "less than {{count}} seconds"
    },
    xSeconds: {
      one: "1 second",
      other: "{{count}} seconds"
    },
    halfAMinute: "half a minute",
    lessThanXMinutes: {
      one: "less than a minute",
      other: "less than {{count}} minutes"
    },
    xMinutes: {
      one: "1 minute",
      other: "{{count}} minutes"
    },
    aboutXHours: {
      one: "about 1 hour",
      other: "about {{count}} hours"
    },
    xHours: {
      one: "1 hour",
      other: "{{count}} hours"
    },
    xDays: {
      one: "1 day",
      other: "{{count}} days"
    },
    aboutXWeeks: {
      one: "about 1 week",
      other: "about {{count}} weeks"
    },
    xWeeks: {
      one: "1 week",
      other: "{{count}} weeks"
    },
    aboutXMonths: {
      one: "about 1 month",
      other: "about {{count}} months"
    },
    xMonths: {
      one: "1 month",
      other: "{{count}} months"
    },
    aboutXYears: {
      one: "about 1 year",
      other: "about {{count}} years"
    },
    xYears: {
      one: "1 year",
      other: "{{count}} years"
    },
    overXYears: {
      one: "over 1 year",
      other: "over {{count}} years"
    },
    almostXYears: {
      one: "almost 1 year",
      other: "almost {{count}} years"
    }
  };
  const formatDistance = (token, count, options) => {
    let result;
    const tokenValue = formatDistanceLocale[token];
    if (typeof tokenValue === "string") {
      result = tokenValue;
    } else if (count === 1) {
      result = tokenValue.one;
    } else {
      result = tokenValue.other.replace("{{count}}", count.toString());
    }
    if (options?.addSuffix) {
      if (options.comparison && options.comparison > 0) {
        return "in " + result;
      } else {
        return result + " ago";
      }
    }
    return result;
  };
  function buildFormatLongFn(args) {
    return (options = {}) => {
      const width = options.width ? String(options.width) : args.defaultWidth;
      const format2 = args.formats[width] || args.formats[args.defaultWidth];
      return format2;
    };
  }
  const dateFormats = {
    full: "EEEE, MMMM do, y",
    long: "MMMM do, y",
    medium: "MMM d, y",
    short: "MM/dd/yyyy"
  };
  const timeFormats = {
    full: "h:mm:ss a zzzz",
    long: "h:mm:ss a z",
    medium: "h:mm:ss a",
    short: "h:mm a"
  };
  const dateTimeFormats = {
    full: "{{date}} 'at' {{time}}",
    long: "{{date}} 'at' {{time}}",
    medium: "{{date}}, {{time}}",
    short: "{{date}}, {{time}}"
  };
  const formatLong = {
    date: buildFormatLongFn({
      formats: dateFormats,
      defaultWidth: "full"
    }),
    time: buildFormatLongFn({
      formats: timeFormats,
      defaultWidth: "full"
    }),
    dateTime: buildFormatLongFn({
      formats: dateTimeFormats,
      defaultWidth: "full"
    })
  };
  const formatRelativeLocale = {
    lastWeek: "'last' eeee 'at' p",
    yesterday: "'yesterday at' p",
    today: "'today at' p",
    tomorrow: "'tomorrow at' p",
    nextWeek: "eeee 'at' p",
    other: "P"
  };
  const formatRelative = (token, _date, _baseDate, _options) => formatRelativeLocale[token];
  function buildLocalizeFn(args) {
    return (value, options) => {
      const context = options?.context ? String(options.context) : "standalone";
      let valuesArray;
      if (context === "formatting" && args.formattingValues) {
        const defaultWidth = args.defaultFormattingWidth || args.defaultWidth;
        const width = options?.width ? String(options.width) : defaultWidth;
        valuesArray = args.formattingValues[width] || args.formattingValues[defaultWidth];
      } else {
        const defaultWidth = args.defaultWidth;
        const width = options?.width ? String(options.width) : args.defaultWidth;
        valuesArray = args.values[width] || args.values[defaultWidth];
      }
      const index = args.argumentCallback ? args.argumentCallback(value) : value;
      return valuesArray[index];
    };
  }
  const eraValues = {
    narrow: ["B", "A"],
    abbreviated: ["BC", "AD"],
    wide: ["Before Christ", "Anno Domini"]
  };
  const quarterValues = {
    narrow: ["1", "2", "3", "4"],
    abbreviated: ["Q1", "Q2", "Q3", "Q4"],
    wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
  };
  const monthValues = {
    narrow: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
    abbreviated: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ],
    wide: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ]
  };
  const dayValues = {
    narrow: ["S", "M", "T", "W", "T", "F", "S"],
    short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    abbreviated: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    wide: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday"
    ]
  };
  const dayPeriodValues = {
    narrow: {
      am: "a",
      pm: "p",
      midnight: "mi",
      noon: "n",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night"
    },
    abbreviated: {
      am: "AM",
      pm: "PM",
      midnight: "midnight",
      noon: "noon",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night"
    },
    wide: {
      am: "a.m.",
      pm: "p.m.",
      midnight: "midnight",
      noon: "noon",
      morning: "morning",
      afternoon: "afternoon",
      evening: "evening",
      night: "night"
    }
  };
  const formattingDayPeriodValues = {
    narrow: {
      am: "a",
      pm: "p",
      midnight: "mi",
      noon: "n",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night"
    },
    abbreviated: {
      am: "AM",
      pm: "PM",
      midnight: "midnight",
      noon: "noon",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night"
    },
    wide: {
      am: "a.m.",
      pm: "p.m.",
      midnight: "midnight",
      noon: "noon",
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night"
    }
  };
  const ordinalNumber = (dirtyNumber, _options) => {
    const number = Number(dirtyNumber);
    const rem100 = number % 100;
    if (rem100 > 20 || rem100 < 10) {
      switch (rem100 % 10) {
        case 1:
          return number + "st";
        case 2:
          return number + "nd";
        case 3:
          return number + "rd";
      }
    }
    return number + "th";
  };
  const localize = {
    ordinalNumber,
    era: buildLocalizeFn({
      values: eraValues,
      defaultWidth: "wide"
    }),
    quarter: buildLocalizeFn({
      values: quarterValues,
      defaultWidth: "wide",
      argumentCallback: (quarter) => quarter - 1
    }),
    month: buildLocalizeFn({
      values: monthValues,
      defaultWidth: "wide"
    }),
    day: buildLocalizeFn({
      values: dayValues,
      defaultWidth: "wide"
    }),
    dayPeriod: buildLocalizeFn({
      values: dayPeriodValues,
      defaultWidth: "wide",
      formattingValues: formattingDayPeriodValues,
      defaultFormattingWidth: "wide"
    })
  };
  function buildMatchFn(args) {
    return (string, options = {}) => {
      const width = options.width;
      const matchPattern = width && args.matchPatterns[width] || args.matchPatterns[args.defaultMatchWidth];
      const matchResult = string.match(matchPattern);
      if (!matchResult) {
        return null;
      }
      const matchedString = matchResult[0];
      const parsePatterns = width && args.parsePatterns[width] || args.parsePatterns[args.defaultParseWidth];
      const key = Array.isArray(parsePatterns) ? findIndex(parsePatterns, (pattern) => pattern.test(matchedString)) : (
        // [TODO] -- I challenge you to fix the type
        findKey(parsePatterns, (pattern) => pattern.test(matchedString))
      );
      let value;
      value = args.valueCallback ? args.valueCallback(key) : key;
      value = options.valueCallback ? (
        // [TODO] -- I challenge you to fix the type
        options.valueCallback(value)
      ) : value;
      const rest = string.slice(matchedString.length);
      return { value, rest };
    };
  }
  function findKey(object, predicate) {
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key) && predicate(object[key])) {
        return key;
      }
    }
    return void 0;
  }
  function findIndex(array, predicate) {
    for (let key = 0; key < array.length; key++) {
      if (predicate(array[key])) {
        return key;
      }
    }
    return void 0;
  }
  function buildMatchPatternFn(args) {
    return (string, options = {}) => {
      const matchResult = string.match(args.matchPattern);
      if (!matchResult) return null;
      const matchedString = matchResult[0];
      const parseResult = string.match(args.parsePattern);
      if (!parseResult) return null;
      let value = args.valueCallback ? args.valueCallback(parseResult[0]) : parseResult[0];
      value = options.valueCallback ? options.valueCallback(value) : value;
      const rest = string.slice(matchedString.length);
      return { value, rest };
    };
  }
  const matchOrdinalNumberPattern = /^(\d+)(th|st|nd|rd)?/i;
  const parseOrdinalNumberPattern = /\d+/i;
  const matchEraPatterns = {
    narrow: /^(b|a)/i,
    abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
    wide: /^(before christ|before common era|anno domini|common era)/i
  };
  const parseEraPatterns = {
    any: [/^b/i, /^(a|c)/i]
  };
  const matchQuarterPatterns = {
    narrow: /^[1234]/i,
    abbreviated: /^q[1234]/i,
    wide: /^[1234](th|st|nd|rd)? quarter/i
  };
  const parseQuarterPatterns = {
    any: [/1/i, /2/i, /3/i, /4/i]
  };
  const matchMonthPatterns = {
    narrow: /^[jfmasond]/i,
    abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
  };
  const parseMonthPatterns = {
    narrow: [
      /^j/i,
      /^f/i,
      /^m/i,
      /^a/i,
      /^m/i,
      /^j/i,
      /^j/i,
      /^a/i,
      /^s/i,
      /^o/i,
      /^n/i,
      /^d/i
    ],
    any: [
      /^ja/i,
      /^f/i,
      /^mar/i,
      /^ap/i,
      /^may/i,
      /^jun/i,
      /^jul/i,
      /^au/i,
      /^s/i,
      /^o/i,
      /^n/i,
      /^d/i
    ]
  };
  const matchDayPatterns = {
    narrow: /^[smtwf]/i,
    short: /^(su|mo|tu|we|th|fr|sa)/i,
    abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
    wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
  };
  const parseDayPatterns = {
    narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
    any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
  };
  const matchDayPeriodPatterns = {
    narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
    any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
  };
  const parseDayPeriodPatterns = {
    any: {
      am: /^a/i,
      pm: /^p/i,
      midnight: /^mi/i,
      noon: /^no/i,
      morning: /morning/i,
      afternoon: /afternoon/i,
      evening: /evening/i,
      night: /night/i
    }
  };
  const match = {
    ordinalNumber: buildMatchPatternFn({
      matchPattern: matchOrdinalNumberPattern,
      parsePattern: parseOrdinalNumberPattern,
      valueCallback: (value) => parseInt(value, 10)
    }),
    era: buildMatchFn({
      matchPatterns: matchEraPatterns,
      defaultMatchWidth: "wide",
      parsePatterns: parseEraPatterns,
      defaultParseWidth: "any"
    }),
    quarter: buildMatchFn({
      matchPatterns: matchQuarterPatterns,
      defaultMatchWidth: "wide",
      parsePatterns: parseQuarterPatterns,
      defaultParseWidth: "any",
      valueCallback: (index) => index + 1
    }),
    month: buildMatchFn({
      matchPatterns: matchMonthPatterns,
      defaultMatchWidth: "wide",
      parsePatterns: parseMonthPatterns,
      defaultParseWidth: "any"
    }),
    day: buildMatchFn({
      matchPatterns: matchDayPatterns,
      defaultMatchWidth: "wide",
      parsePatterns: parseDayPatterns,
      defaultParseWidth: "any"
    }),
    dayPeriod: buildMatchFn({
      matchPatterns: matchDayPeriodPatterns,
      defaultMatchWidth: "any",
      parsePatterns: parseDayPeriodPatterns,
      defaultParseWidth: "any"
    })
  };
  const enUS = {
    code: "en-US",
    formatDistance,
    formatLong,
    formatRelative,
    localize,
    match,
    options: {
      weekStartsOn: 0,
      firstWeekContainsDate: 1
    }
  };
  function getDayOfYear(date, options) {
    const _date = toDate(date, options?.in);
    const diff = differenceInCalendarDays(_date, startOfYear(_date));
    const dayOfYear = diff + 1;
    return dayOfYear;
  }
  function getISOWeek(date, options) {
    const _date = toDate(date, options?.in);
    const diff = +startOfISOWeek(_date) - +startOfISOWeekYear(_date);
    return Math.round(diff / millisecondsInWeek) + 1;
  }
  function getWeekYear(date, options) {
    const _date = toDate(date, options?.in);
    const year = _date.getFullYear();
    const defaultOptions2 = getDefaultOptions();
    const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
    const firstWeekOfNextYear = constructFrom(options?.in || date, 0);
    firstWeekOfNextYear.setFullYear(year + 1, 0, firstWeekContainsDate);
    firstWeekOfNextYear.setHours(0, 0, 0, 0);
    const startOfNextYear = startOfWeek(firstWeekOfNextYear, options);
    const firstWeekOfThisYear = constructFrom(options?.in || date, 0);
    firstWeekOfThisYear.setFullYear(year, 0, firstWeekContainsDate);
    firstWeekOfThisYear.setHours(0, 0, 0, 0);
    const startOfThisYear = startOfWeek(firstWeekOfThisYear, options);
    if (+_date >= +startOfNextYear) {
      return year + 1;
    } else if (+_date >= +startOfThisYear) {
      return year;
    } else {
      return year - 1;
    }
  }
  function startOfWeekYear(date, options) {
    const defaultOptions2 = getDefaultOptions();
    const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
    const year = getWeekYear(date, options);
    const firstWeek = constructFrom(options?.in || date, 0);
    firstWeek.setFullYear(year, 0, firstWeekContainsDate);
    firstWeek.setHours(0, 0, 0, 0);
    const _date = startOfWeek(firstWeek, options);
    return _date;
  }
  function getWeek(date, options) {
    const _date = toDate(date, options?.in);
    const diff = +startOfWeek(_date, options) - +startOfWeekYear(_date, options);
    return Math.round(diff / millisecondsInWeek) + 1;
  }
  function addLeadingZeros(number, targetLength) {
    const sign = number < 0 ? "-" : "";
    const output = Math.abs(number).toString().padStart(targetLength, "0");
    return sign + output;
  }
  const lightFormatters = {
    // Year
    y(date, token) {
      const signedYear = date.getFullYear();
      const year = signedYear > 0 ? signedYear : 1 - signedYear;
      return addLeadingZeros(token === "yy" ? year % 100 : year, token.length);
    },
    // Month
    M(date, token) {
      const month = date.getMonth();
      return token === "M" ? String(month + 1) : addLeadingZeros(month + 1, 2);
    },
    // Day of the month
    d(date, token) {
      return addLeadingZeros(date.getDate(), token.length);
    },
    // AM or PM
    a(date, token) {
      const dayPeriodEnumValue = date.getHours() / 12 >= 1 ? "pm" : "am";
      switch (token) {
        case "a":
        case "aa":
          return dayPeriodEnumValue.toUpperCase();
        case "aaa":
          return dayPeriodEnumValue;
        case "aaaaa":
          return dayPeriodEnumValue[0];
        case "aaaa":
        default:
          return dayPeriodEnumValue === "am" ? "a.m." : "p.m.";
      }
    },
    // Hour [1-12]
    h(date, token) {
      return addLeadingZeros(date.getHours() % 12 || 12, token.length);
    },
    // Hour [0-23]
    H(date, token) {
      return addLeadingZeros(date.getHours(), token.length);
    },
    // Minute
    m(date, token) {
      return addLeadingZeros(date.getMinutes(), token.length);
    },
    // Second
    s(date, token) {
      return addLeadingZeros(date.getSeconds(), token.length);
    },
    // Fraction of second
    S(date, token) {
      const numberOfDigits = token.length;
      const milliseconds = date.getMilliseconds();
      const fractionalSeconds = Math.trunc(
        milliseconds * Math.pow(10, numberOfDigits - 3)
      );
      return addLeadingZeros(fractionalSeconds, token.length);
    }
  };
  const dayPeriodEnum = {
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  };
  const formatters = {
    // Era
    G: function(date, token, localize2) {
      const era = date.getFullYear() > 0 ? 1 : 0;
      switch (token) {
        // AD, BC
        case "G":
        case "GG":
        case "GGG":
          return localize2.era(era, { width: "abbreviated" });
        // A, B
        case "GGGGG":
          return localize2.era(era, { width: "narrow" });
        // Anno Domini, Before Christ
        case "GGGG":
        default:
          return localize2.era(era, { width: "wide" });
      }
    },
    // Year
    y: function(date, token, localize2) {
      if (token === "yo") {
        const signedYear = date.getFullYear();
        const year = signedYear > 0 ? signedYear : 1 - signedYear;
        return localize2.ordinalNumber(year, { unit: "year" });
      }
      return lightFormatters.y(date, token);
    },
    // Local week-numbering year
    Y: function(date, token, localize2, options) {
      const signedWeekYear = getWeekYear(date, options);
      const weekYear = signedWeekYear > 0 ? signedWeekYear : 1 - signedWeekYear;
      if (token === "YY") {
        const twoDigitYear = weekYear % 100;
        return addLeadingZeros(twoDigitYear, 2);
      }
      if (token === "Yo") {
        return localize2.ordinalNumber(weekYear, { unit: "year" });
      }
      return addLeadingZeros(weekYear, token.length);
    },
    // ISO week-numbering year
    R: function(date, token) {
      const isoWeekYear = getISOWeekYear(date);
      return addLeadingZeros(isoWeekYear, token.length);
    },
    // Extended year. This is a single number designating the year of this calendar system.
    // The main difference between `y` and `u` localizers are B.C. years:
    // | Year | `y` | `u` |
    // |------|-----|-----|
    // | AC 1 |   1 |   1 |
    // | BC 1 |   1 |   0 |
    // | BC 2 |   2 |  -1 |
    // Also `yy` always returns the last two digits of a year,
    // while `uu` pads single digit years to 2 characters and returns other years unchanged.
    u: function(date, token) {
      const year = date.getFullYear();
      return addLeadingZeros(year, token.length);
    },
    // Quarter
    Q: function(date, token, localize2) {
      const quarter = Math.ceil((date.getMonth() + 1) / 3);
      switch (token) {
        // 1, 2, 3, 4
        case "Q":
          return String(quarter);
        // 01, 02, 03, 04
        case "QQ":
          return addLeadingZeros(quarter, 2);
        // 1st, 2nd, 3rd, 4th
        case "Qo":
          return localize2.ordinalNumber(quarter, { unit: "quarter" });
        // Q1, Q2, Q3, Q4
        case "QQQ":
          return localize2.quarter(quarter, {
            width: "abbreviated",
            context: "formatting"
          });
        // 1, 2, 3, 4 (narrow quarter; could be not numerical)
        case "QQQQQ":
          return localize2.quarter(quarter, {
            width: "narrow",
            context: "formatting"
          });
        // 1st quarter, 2nd quarter, ...
        case "QQQQ":
        default:
          return localize2.quarter(quarter, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // Stand-alone quarter
    q: function(date, token, localize2) {
      const quarter = Math.ceil((date.getMonth() + 1) / 3);
      switch (token) {
        // 1, 2, 3, 4
        case "q":
          return String(quarter);
        // 01, 02, 03, 04
        case "qq":
          return addLeadingZeros(quarter, 2);
        // 1st, 2nd, 3rd, 4th
        case "qo":
          return localize2.ordinalNumber(quarter, { unit: "quarter" });
        // Q1, Q2, Q3, Q4
        case "qqq":
          return localize2.quarter(quarter, {
            width: "abbreviated",
            context: "standalone"
          });
        // 1, 2, 3, 4 (narrow quarter; could be not numerical)
        case "qqqqq":
          return localize2.quarter(quarter, {
            width: "narrow",
            context: "standalone"
          });
        // 1st quarter, 2nd quarter, ...
        case "qqqq":
        default:
          return localize2.quarter(quarter, {
            width: "wide",
            context: "standalone"
          });
      }
    },
    // Month
    M: function(date, token, localize2) {
      const month = date.getMonth();
      switch (token) {
        case "M":
        case "MM":
          return lightFormatters.M(date, token);
        // 1st, 2nd, ..., 12th
        case "Mo":
          return localize2.ordinalNumber(month + 1, { unit: "month" });
        // Jan, Feb, ..., Dec
        case "MMM":
          return localize2.month(month, {
            width: "abbreviated",
            context: "formatting"
          });
        // J, F, ..., D
        case "MMMMM":
          return localize2.month(month, {
            width: "narrow",
            context: "formatting"
          });
        // January, February, ..., December
        case "MMMM":
        default:
          return localize2.month(month, { width: "wide", context: "formatting" });
      }
    },
    // Stand-alone month
    L: function(date, token, localize2) {
      const month = date.getMonth();
      switch (token) {
        // 1, 2, ..., 12
        case "L":
          return String(month + 1);
        // 01, 02, ..., 12
        case "LL":
          return addLeadingZeros(month + 1, 2);
        // 1st, 2nd, ..., 12th
        case "Lo":
          return localize2.ordinalNumber(month + 1, { unit: "month" });
        // Jan, Feb, ..., Dec
        case "LLL":
          return localize2.month(month, {
            width: "abbreviated",
            context: "standalone"
          });
        // J, F, ..., D
        case "LLLLL":
          return localize2.month(month, {
            width: "narrow",
            context: "standalone"
          });
        // January, February, ..., December
        case "LLLL":
        default:
          return localize2.month(month, { width: "wide", context: "standalone" });
      }
    },
    // Local week of year
    w: function(date, token, localize2, options) {
      const week = getWeek(date, options);
      if (token === "wo") {
        return localize2.ordinalNumber(week, { unit: "week" });
      }
      return addLeadingZeros(week, token.length);
    },
    // ISO week of year
    I: function(date, token, localize2) {
      const isoWeek = getISOWeek(date);
      if (token === "Io") {
        return localize2.ordinalNumber(isoWeek, { unit: "week" });
      }
      return addLeadingZeros(isoWeek, token.length);
    },
    // Day of the month
    d: function(date, token, localize2) {
      if (token === "do") {
        return localize2.ordinalNumber(date.getDate(), { unit: "date" });
      }
      return lightFormatters.d(date, token);
    },
    // Day of year
    D: function(date, token, localize2) {
      const dayOfYear = getDayOfYear(date);
      if (token === "Do") {
        return localize2.ordinalNumber(dayOfYear, { unit: "dayOfYear" });
      }
      return addLeadingZeros(dayOfYear, token.length);
    },
    // Day of week
    E: function(date, token, localize2) {
      const dayOfWeek = date.getDay();
      switch (token) {
        // Tue
        case "E":
        case "EE":
        case "EEE":
          return localize2.day(dayOfWeek, {
            width: "abbreviated",
            context: "formatting"
          });
        // T
        case "EEEEE":
          return localize2.day(dayOfWeek, {
            width: "narrow",
            context: "formatting"
          });
        // Tu
        case "EEEEEE":
          return localize2.day(dayOfWeek, {
            width: "short",
            context: "formatting"
          });
        // Tuesday
        case "EEEE":
        default:
          return localize2.day(dayOfWeek, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // Local day of week
    e: function(date, token, localize2, options) {
      const dayOfWeek = date.getDay();
      const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
      switch (token) {
        // Numerical value (Nth day of week with current locale or weekStartsOn)
        case "e":
          return String(localDayOfWeek);
        // Padded numerical value
        case "ee":
          return addLeadingZeros(localDayOfWeek, 2);
        // 1st, 2nd, ..., 7th
        case "eo":
          return localize2.ordinalNumber(localDayOfWeek, { unit: "day" });
        case "eee":
          return localize2.day(dayOfWeek, {
            width: "abbreviated",
            context: "formatting"
          });
        // T
        case "eeeee":
          return localize2.day(dayOfWeek, {
            width: "narrow",
            context: "formatting"
          });
        // Tu
        case "eeeeee":
          return localize2.day(dayOfWeek, {
            width: "short",
            context: "formatting"
          });
        // Tuesday
        case "eeee":
        default:
          return localize2.day(dayOfWeek, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // Stand-alone local day of week
    c: function(date, token, localize2, options) {
      const dayOfWeek = date.getDay();
      const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
      switch (token) {
        // Numerical value (same as in `e`)
        case "c":
          return String(localDayOfWeek);
        // Padded numerical value
        case "cc":
          return addLeadingZeros(localDayOfWeek, token.length);
        // 1st, 2nd, ..., 7th
        case "co":
          return localize2.ordinalNumber(localDayOfWeek, { unit: "day" });
        case "ccc":
          return localize2.day(dayOfWeek, {
            width: "abbreviated",
            context: "standalone"
          });
        // T
        case "ccccc":
          return localize2.day(dayOfWeek, {
            width: "narrow",
            context: "standalone"
          });
        // Tu
        case "cccccc":
          return localize2.day(dayOfWeek, {
            width: "short",
            context: "standalone"
          });
        // Tuesday
        case "cccc":
        default:
          return localize2.day(dayOfWeek, {
            width: "wide",
            context: "standalone"
          });
      }
    },
    // ISO day of week
    i: function(date, token, localize2) {
      const dayOfWeek = date.getDay();
      const isoDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
      switch (token) {
        // 2
        case "i":
          return String(isoDayOfWeek);
        // 02
        case "ii":
          return addLeadingZeros(isoDayOfWeek, token.length);
        // 2nd
        case "io":
          return localize2.ordinalNumber(isoDayOfWeek, { unit: "day" });
        // Tue
        case "iii":
          return localize2.day(dayOfWeek, {
            width: "abbreviated",
            context: "formatting"
          });
        // T
        case "iiiii":
          return localize2.day(dayOfWeek, {
            width: "narrow",
            context: "formatting"
          });
        // Tu
        case "iiiiii":
          return localize2.day(dayOfWeek, {
            width: "short",
            context: "formatting"
          });
        // Tuesday
        case "iiii":
        default:
          return localize2.day(dayOfWeek, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // AM or PM
    a: function(date, token, localize2) {
      const hours = date.getHours();
      const dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
      switch (token) {
        case "a":
        case "aa":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "abbreviated",
            context: "formatting"
          });
        case "aaa":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "abbreviated",
            context: "formatting"
          }).toLowerCase();
        case "aaaaa":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "narrow",
            context: "formatting"
          });
        case "aaaa":
        default:
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // AM, PM, midnight, noon
    b: function(date, token, localize2) {
      const hours = date.getHours();
      let dayPeriodEnumValue;
      if (hours === 12) {
        dayPeriodEnumValue = dayPeriodEnum.noon;
      } else if (hours === 0) {
        dayPeriodEnumValue = dayPeriodEnum.midnight;
      } else {
        dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
      }
      switch (token) {
        case "b":
        case "bb":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "abbreviated",
            context: "formatting"
          });
        case "bbb":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "abbreviated",
            context: "formatting"
          }).toLowerCase();
        case "bbbbb":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "narrow",
            context: "formatting"
          });
        case "bbbb":
        default:
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // in the morning, in the afternoon, in the evening, at night
    B: function(date, token, localize2) {
      const hours = date.getHours();
      let dayPeriodEnumValue;
      if (hours >= 17) {
        dayPeriodEnumValue = dayPeriodEnum.evening;
      } else if (hours >= 12) {
        dayPeriodEnumValue = dayPeriodEnum.afternoon;
      } else if (hours >= 4) {
        dayPeriodEnumValue = dayPeriodEnum.morning;
      } else {
        dayPeriodEnumValue = dayPeriodEnum.night;
      }
      switch (token) {
        case "B":
        case "BB":
        case "BBB":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "abbreviated",
            context: "formatting"
          });
        case "BBBBB":
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "narrow",
            context: "formatting"
          });
        case "BBBB":
        default:
          return localize2.dayPeriod(dayPeriodEnumValue, {
            width: "wide",
            context: "formatting"
          });
      }
    },
    // Hour [1-12]
    h: function(date, token, localize2) {
      if (token === "ho") {
        let hours = date.getHours() % 12;
        if (hours === 0) hours = 12;
        return localize2.ordinalNumber(hours, { unit: "hour" });
      }
      return lightFormatters.h(date, token);
    },
    // Hour [0-23]
    H: function(date, token, localize2) {
      if (token === "Ho") {
        return localize2.ordinalNumber(date.getHours(), { unit: "hour" });
      }
      return lightFormatters.H(date, token);
    },
    // Hour [0-11]
    K: function(date, token, localize2) {
      const hours = date.getHours() % 12;
      if (token === "Ko") {
        return localize2.ordinalNumber(hours, { unit: "hour" });
      }
      return addLeadingZeros(hours, token.length);
    },
    // Hour [1-24]
    k: function(date, token, localize2) {
      let hours = date.getHours();
      if (hours === 0) hours = 24;
      if (token === "ko") {
        return localize2.ordinalNumber(hours, { unit: "hour" });
      }
      return addLeadingZeros(hours, token.length);
    },
    // Minute
    m: function(date, token, localize2) {
      if (token === "mo") {
        return localize2.ordinalNumber(date.getMinutes(), { unit: "minute" });
      }
      return lightFormatters.m(date, token);
    },
    // Second
    s: function(date, token, localize2) {
      if (token === "so") {
        return localize2.ordinalNumber(date.getSeconds(), { unit: "second" });
      }
      return lightFormatters.s(date, token);
    },
    // Fraction of second
    S: function(date, token) {
      return lightFormatters.S(date, token);
    },
    // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
    X: function(date, token, _localize) {
      const timezoneOffset = date.getTimezoneOffset();
      if (timezoneOffset === 0) {
        return "Z";
      }
      switch (token) {
        // Hours and optional minutes
        case "X":
          return formatTimezoneWithOptionalMinutes(timezoneOffset);
        // Hours, minutes and optional seconds without `:` delimiter
        // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
        // so this token always has the same output as `XX`
        case "XXXX":
        case "XX":
          return formatTimezone(timezoneOffset);
        // Hours, minutes and optional seconds with `:` delimiter
        // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
        // so this token always has the same output as `XXX`
        case "XXXXX":
        case "XXX":
        // Hours and minutes with `:` delimiter
        default:
          return formatTimezone(timezoneOffset, ":");
      }
    },
    // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
    x: function(date, token, _localize) {
      const timezoneOffset = date.getTimezoneOffset();
      switch (token) {
        // Hours and optional minutes
        case "x":
          return formatTimezoneWithOptionalMinutes(timezoneOffset);
        // Hours, minutes and optional seconds without `:` delimiter
        // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
        // so this token always has the same output as `xx`
        case "xxxx":
        case "xx":
          return formatTimezone(timezoneOffset);
        // Hours, minutes and optional seconds with `:` delimiter
        // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
        // so this token always has the same output as `xxx`
        case "xxxxx":
        case "xxx":
        // Hours and minutes with `:` delimiter
        default:
          return formatTimezone(timezoneOffset, ":");
      }
    },
    // Timezone (GMT)
    O: function(date, token, _localize) {
      const timezoneOffset = date.getTimezoneOffset();
      switch (token) {
        // Short
        case "O":
        case "OO":
        case "OOO":
          return "GMT" + formatTimezoneShort(timezoneOffset, ":");
        // Long
        case "OOOO":
        default:
          return "GMT" + formatTimezone(timezoneOffset, ":");
      }
    },
    // Timezone (specific non-location)
    z: function(date, token, _localize) {
      const timezoneOffset = date.getTimezoneOffset();
      switch (token) {
        // Short
        case "z":
        case "zz":
        case "zzz":
          return "GMT" + formatTimezoneShort(timezoneOffset, ":");
        // Long
        case "zzzz":
        default:
          return "GMT" + formatTimezone(timezoneOffset, ":");
      }
    },
    // Seconds timestamp
    t: function(date, token, _localize) {
      const timestamp = Math.trunc(+date / 1e3);
      return addLeadingZeros(timestamp, token.length);
    },
    // Milliseconds timestamp
    T: function(date, token, _localize) {
      return addLeadingZeros(+date, token.length);
    }
  };
  function formatTimezoneShort(offset, delimiter = "") {
    const sign = offset > 0 ? "-" : "+";
    const absOffset = Math.abs(offset);
    const hours = Math.trunc(absOffset / 60);
    const minutes = absOffset % 60;
    if (minutes === 0) {
      return sign + String(hours);
    }
    return sign + String(hours) + delimiter + addLeadingZeros(minutes, 2);
  }
  function formatTimezoneWithOptionalMinutes(offset, delimiter) {
    if (offset % 60 === 0) {
      const sign = offset > 0 ? "-" : "+";
      return sign + addLeadingZeros(Math.abs(offset) / 60, 2);
    }
    return formatTimezone(offset, delimiter);
  }
  function formatTimezone(offset, delimiter = "") {
    const sign = offset > 0 ? "-" : "+";
    const absOffset = Math.abs(offset);
    const hours = addLeadingZeros(Math.trunc(absOffset / 60), 2);
    const minutes = addLeadingZeros(absOffset % 60, 2);
    return sign + hours + delimiter + minutes;
  }
  const dateLongFormatter = (pattern, formatLong2) => {
    switch (pattern) {
      case "P":
        return formatLong2.date({ width: "short" });
      case "PP":
        return formatLong2.date({ width: "medium" });
      case "PPP":
        return formatLong2.date({ width: "long" });
      case "PPPP":
      default:
        return formatLong2.date({ width: "full" });
    }
  };
  const timeLongFormatter = (pattern, formatLong2) => {
    switch (pattern) {
      case "p":
        return formatLong2.time({ width: "short" });
      case "pp":
        return formatLong2.time({ width: "medium" });
      case "ppp":
        return formatLong2.time({ width: "long" });
      case "pppp":
      default:
        return formatLong2.time({ width: "full" });
    }
  };
  const dateTimeLongFormatter = (pattern, formatLong2) => {
    const matchResult = pattern.match(/(P+)(p+)?/) || [];
    const datePattern = matchResult[1];
    const timePattern = matchResult[2];
    if (!timePattern) {
      return dateLongFormatter(pattern, formatLong2);
    }
    let dateTimeFormat;
    switch (datePattern) {
      case "P":
        dateTimeFormat = formatLong2.dateTime({ width: "short" });
        break;
      case "PP":
        dateTimeFormat = formatLong2.dateTime({ width: "medium" });
        break;
      case "PPP":
        dateTimeFormat = formatLong2.dateTime({ width: "long" });
        break;
      case "PPPP":
      default:
        dateTimeFormat = formatLong2.dateTime({ width: "full" });
        break;
    }
    return dateTimeFormat.replace("{{date}}", dateLongFormatter(datePattern, formatLong2)).replace("{{time}}", timeLongFormatter(timePattern, formatLong2));
  };
  const longFormatters = {
    p: timeLongFormatter,
    P: dateTimeLongFormatter
  };
  const dayOfYearTokenRE = /^D+$/;
  const weekYearTokenRE = /^Y+$/;
  const throwTokens = ["D", "DD", "YY", "YYYY"];
  function isProtectedDayOfYearToken(token) {
    return dayOfYearTokenRE.test(token);
  }
  function isProtectedWeekYearToken(token) {
    return weekYearTokenRE.test(token);
  }
  function warnOrThrowProtectedError(token, format2, input) {
    const _message = message(token, format2, input);
    console.warn(_message);
    if (throwTokens.includes(token)) throw new RangeError(_message);
  }
  function message(token, format2, input) {
    const subject = token[0] === "Y" ? "years" : "days of the month";
    return `Use \`${token.toLowerCase()}\` instead of \`${token}\` (in \`${format2}\`) for formatting ${subject} to the input \`${input}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
  }
  const formattingTokensRegExp = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g;
  const longFormattingTokensRegExp = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g;
  const escapedStringRegExp = /^'([^]*?)'?$/;
  const doubleQuoteRegExp = /''/g;
  const unescapedLatinCharacterRegExp = /[a-zA-Z]/;
  function format(date, formatStr, options) {
    const defaultOptions2 = getDefaultOptions();
    const locale = defaultOptions2.locale ?? enUS;
    const firstWeekContainsDate = defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
    const weekStartsOn = defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
    const originalDate = toDate(date, options?.in);
    if (!isValid(originalDate)) {
      throw new RangeError("Invalid time value");
    }
    let parts = formatStr.match(longFormattingTokensRegExp).map((substring) => {
      const firstCharacter = substring[0];
      if (firstCharacter === "p" || firstCharacter === "P") {
        const longFormatter = longFormatters[firstCharacter];
        return longFormatter(substring, locale.formatLong);
      }
      return substring;
    }).join("").match(formattingTokensRegExp).map((substring) => {
      if (substring === "''") {
        return { isToken: false, value: "'" };
      }
      const firstCharacter = substring[0];
      if (firstCharacter === "'") {
        return { isToken: false, value: cleanEscapedString(substring) };
      }
      if (formatters[firstCharacter]) {
        return { isToken: true, value: substring };
      }
      if (firstCharacter.match(unescapedLatinCharacterRegExp)) {
        throw new RangeError(
          "Format string contains an unescaped latin alphabet character `" + firstCharacter + "`"
        );
      }
      return { isToken: false, value: substring };
    });
    if (locale.localize.preprocessor) {
      parts = locale.localize.preprocessor(originalDate, parts);
    }
    const formatterOptions = {
      firstWeekContainsDate,
      weekStartsOn,
      locale
    };
    return parts.map((part) => {
      if (!part.isToken) return part.value;
      const token = part.value;
      if (isProtectedWeekYearToken(token) || isProtectedDayOfYearToken(token)) {
        warnOrThrowProtectedError(token, formatStr, String(date));
      }
      const formatter = formatters[token[0]];
      return formatter(originalDate, token, locale.localize, formatterOptions);
    }).join("");
  }
  function cleanEscapedString(input) {
    const matched = input.match(escapedStringRegExp);
    if (!matched) {
      return input;
    }
    return matched[1].replace(doubleQuoteRegExp, "'");
  }
  const {
    waitForElement: waitForElement$1
  } = utils;
  class Handler {
    constructor(name, config2, state2) {
      this.name = name;
      this.config = config2;
      this.state = state2;
      this.items = [];
      this.handleInput = this.handleInput.bind(this);
    }
    activate() {
      this.bindKeys();
    }
    deactivate() {
      this.unbindKeys();
    }
    isActive() {
      return true;
    }
    bindKeys() {
      document.addEventListener("keydown", this.handleInput, true);
    }
    unbindKeys() {
      document.removeEventListener("keydown", this.handleInput, true);
    }
    handleInput(event) {
      if (event.altKey && !event.metaKey) {
        if (event.code === "KeyH") {
          event.preventDefault();
          $("nav a[aria-label='Home']")[0].click();
        } else if (event.code === "KeyS") {
          event.preventDefault();
          $("nav a[aria-label='Search']")[0].click();
        } else if (event.code === "KeyN") {
          event.preventDefault();
          $("nav a[aria-label='Notifications']")[0].click();
        } else if (event.code === "KeyM") {
          event.preventDefault();
          $("nav a[aria-label='Chat']")[0].click();
        } else if (event.code === "KeyF") {
          event.preventDefault();
          $("nav a[aria-label='Feeds']")[0].click();
        } else if (event.code === "KeyL") {
          event.preventDefault();
          $("nav a[aria-label='Lists']")[0].click();
        } else if (event.code === "KeyP") {
          event.preventDefault();
          $("nav a[aria-label='Profile']")[0].click();
        } else if (event.code === "Comma") {
          event.preventDefault();
          $("nav a[aria-label='Settings']")[0].click();
        } else if (event.code === "Period") {
          event.preventDefault();
          this.config.open();
        }
      }
    }
  }
  class ItemHandler extends Handler {
    // POPUP_MENU_SELECTOR = "div[data-radix-popper-content-wrapper]"
    POPUP_MENU_SELECTOR = "div[aria-label^='Context menu backdrop']";
    // FIXME: this belongs in PostItemHandler
    THREAD_PAGE_SELECTOR = "main > div > div > div";
    MOUSE_MOVEMENT_THRESHOLD = 10;
    FLOATING_BUTTON_IMAGES = {
      prev: [
        // 'https://www.svgrepo.com/show/491060/prev.svg'
        "https://www.svgrepo.com/show/238452/up-arrow.svg"
      ],
      next: [
        // 'https://www.svgrepo.com/show/491054/next.svg'
        "https://www.svgrepo.com/show/238463/down-arrow-multimedia-option.svg"
      ]
    };
    constructor(name, config2, state2, selector) {
      super(name);
      this.config = config2;
      this.state = state2;
      this.selector = selector;
      this._index = null;
      this.postId = null;
      this.loadNewerCallback = null;
      this.debounceTimeout = null;
      this.lastMousePosition = null;
      this.isPopupVisible = false;
      this.ignoreMouseMovement = false;
      this.onPopupAdd = this.onPopupAdd.bind(this);
      this.onPopupRemove = this.onPopupRemove.bind(this);
      this.onIntersection = this.onIntersection.bind(this);
      this.onFooterIntersection = this.onFooterIntersection.bind(this);
      this.onItemAdded = this.onItemAdded.bind(this);
      this.onScroll = this.onScroll.bind(this);
      this.handleNewThreadPage = this.handleNewThreadPage.bind(this);
      this.onItemMouseOver = this.onItemMouseOver.bind(this);
      this.didMouseMove = this.didMouseMove.bind(this);
      this.getTimestampForItem = this.getTimestampForItem.bind(this);
      this.loading = false;
      this.loadingNew = false;
      this.enableScrollMonitor = false;
      this.enableIntersectionObserver = false;
      this.handlingClick = false;
      this.itemStats = {};
      this.visibleItems = [];
      this.scrollTick = false;
      this.scrollTop = 0;
      this.scrollDirection = 0;
    }
    isActive() {
      return false;
    }
    activate() {
      this.keyState = [];
      this.popupObserver = waitForElement$1(this.POPUP_MENU_SELECTOR, this.onPopupAdd, this.onPopupRemove);
      this.intersectionObserver = new IntersectionObserver(this.onIntersection, {
        root: null,
        // Observing within the viewport
        // rootMargin: `-${ITEM_SCROLL_MARGIN}px 0px 0px 0px`,
        threshold: Array.from({ length: 101 }, (_, i) => i / 100)
      });
      this.setupIntersectionObserver();
      this.footerIntersectionObserver = new IntersectionObserver(this.onFooterIntersection, {
        root: null,
        // Observing within the viewport
        // threshold: [1]
        threshold: Array.from({ length: 101 }, (_, i) => i / 100)
      });
      const safeSelector = `${this.selector}:not(.thread ${this.selector})`;
      this.observer = waitForElement$1(safeSelector, (element) => {
        this.onItemAdded(element), this.onItemRemoved(element);
      });
      this.loadNewerObserver = waitForElement$1(constants$1.LOAD_NEW_INDICATOR_SELECTOR, (button) => {
        this.loadNewerButton = $(button)[0];
        $("a#loadNewerIndicatorLink").on("click", () => this.loadNewerItems());
        $("img#loadNewerIndicatorImage").addClass("image-highlight");
        $("img#loadNewerIndicatorImage").removeClass("toolbar-icon-pending");
        if ($("#loadNewerAction").length == 0) {
          $("#messageActions").append($('<div id="loadNewerAction"><a> Load newer posts</a></div>'));
          $("#loadNewerAction > a").on("click", () => this.loadNewerItems());
        }
        this.loadNewerButton.addEventListener(
          "click",
          (event) => {
            if (this.loadingNew) {
              return;
            }
            event.target;
            event.stopImmediatePropagation();
            setTimeout(() => {
              this.loadNewerItems();
            }, 0);
          },
          true
          // Capture phase
        );
      });
      this.enableIntersectionObserver = true;
      $(document).on("scroll", this.onScroll);
      $(document).on("scrollend", () => {
        setTimeout(
          () => this.ignoreMouseMovement = false,
          500
        );
      });
      console.log(this.state.mobileView);
      this.floatingButtonsObserver = waitForElement$1(
        this.state.mobileView ? constants$1.HOME_SCREEN_SELECTOR : constants$1.LEFT_SIDEBAR_SELECTOR,
        (container) => {
          console.log(container);
          if (!this.prevButton) {
            this.prevButton = $(`<div id="prevButton" title="previous post" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="prevButtonImage" class="indicator-image" src="${this.FLOATING_BUTTON_IMAGES.prev[0]}"/></div>`);
            $(container).append(this.prevButton);
            if (this.state.mobileView) {
              $("#prevButton").addClass("mobile");
            }
            $("#prevButton").on("click", (event) => {
              event.preventDefault();
              this.jumpToPrev(true);
            });
          }
          if (!this.nextButton) {
            this.nextButton = $(`<div id="nextButton" title="next post" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="nextButtonImage" class="indicator-image" src="${this.FLOATING_BUTTON_IMAGES.next[0]}"/></div>`);
            $(this.prevButton).after(this.nextButton);
            if (this.state.mobileView) {
              $("#nextButton").addClass("mobile");
            }
            $("#nextButton").on("click", (event) => {
              event.preventDefault();
              this.jumpToNext(true);
            });
          }
        }
      );
      super.activate();
    }
    deactivate() {
      if (this.floatingButtonsObserver) {
        this.floatingButtonsObserver.disconnect();
      }
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.popupObserver) {
        this.popupObserver.disconnect();
      }
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
      }
      this.disableFooterObserver();
      $(this.selector).off("mouseover mouseleave");
      $(document).off("scroll", this.onScroll);
      super.deactivate();
    }
    get index() {
      return this._index;
    }
    set index(value) {
      this._index = value;
      this.postId = this.postIdForItem(this.items[this.index]);
      this.updateInfoIndicator();
    }
    onItemAdded(element) {
      this.applyItemStyle(element);
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = setTimeout(() => {
        this.loadItems();
      }, 500);
    }
    onItemRemoved(element) {
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect(element);
      }
    }
    onScroll(event) {
      if (!this.enableScrollMonitor) {
        console.log("!this.enableScrollMonitor");
        return;
      }
      this.ignoreMouseMovement = true;
      if (!this.scrollTick) {
        requestAnimationFrame(() => {
          let currentScroll = $(window).scrollTop();
          if (currentScroll > this.scrollTop) {
            this.scrollDirection = -1;
          } else if (currentScroll < this.scrollTop) {
            this.scrollDirection = 1;
          }
          this.scrollTop = currentScroll;
          this.scrollTick = false;
        });
        this.scrollTick = true;
      }
    }
    scrollToElement(target2) {
      this.enableIntersectionObserver = false;
      target2.scrollIntoView(
        { behavior: this.config.get("enableSmoothScrolling") ? "smooth" : "instant" }
      );
    }
    // Function to programmatically play a video from the userscript
    playVideo(video) {
      video.dataset.allowPlay = "true";
      video.play();
    }
    pauseVideo(video) {
      video.dataset.allowPlay = "true";
      video.pause();
    }
    setupIntersectionObserver(entries) {
      if (this.intersectionObserver) {
        $(this.items).each(
          (i, item) => {
            this.intersectionObserver.observe($(item)[0]);
          }
        );
      }
    }
    onIntersection(entries) {
      if (!this.enableIntersectionObserver || this.loading || this.loadingNew) {
        return;
      }
      let target2 = null;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.visibleItems = this.visibleItems.filter(
            (item) => item.target != entry.target
          );
          this.visibleItems.push(entry);
        } else {
          const oldLength = this.visibleItems.length;
          this.visibleItems = this.visibleItems.filter(
            (item) => item.target != entry.target
          );
          if (this.visibleItems.length < oldLength) {
            console.log("removed", entry.target);
            if (this.config.get("markReadOnScroll")) {
              var index2 = this.getIndexFromItem(entry.target);
              this.markItemRead(index2, true);
            }
          }
        }
      });
      const visibleItems = this.visibleItems.sort(
        (a, b) => this.scrollDirection == 1 ? b.target.getBoundingClientRect().top - a.target.getBoundingClientRect().top : a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top
      );
      if (!visibleItems.length) {
        return;
      }
      for (const [i, item] of visibleItems.entries()) {
        var index = this.getIndexFromItem(item.target);
        if (item.intersectionRatio == 1) {
          target2 = item.target;
          break;
        }
      }
      if (target2 == null) {
        target2 = this.scrollDirection == -1 ? visibleItems[0].target : visibleItems.slice(-1)[0].target;
        var index = this.getIndexFromItem(target2);
      }
      var index = this.getIndexFromItem(target2);
      this.setIndex(index);
    }
    onFooterIntersection(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target;
          this.disableFooterObserver();
          this.loadOlderItems();
        }
      });
    }
    enableFooterObserver() {
      if (this.config.get("disableLoadMoreOnScroll")) {
        return;
      }
      if (!this.state.feedSortReverse && this.items.length > 0) {
        this.footerIntersectionObserver.observe(this.items.slice(-1)[0]);
      }
    }
    disableFooterObserver() {
      if (this.footerIntersectionObserver) {
        this.footerIntersectionObserver.disconnect();
      }
    }
    onPopupAdd() {
      this.isPopupVisible = true;
    }
    onPopupRemove() {
      this.isPopupVisible = false;
    }
    get scrollMargin() {
      var margin;
      if (this.state.mobileView) {
        var el = $(`${constants$1.HOME_SCREEN_SELECTOR} > div > div > div`);
        el = el.first().children().filter(":visible").first();
        if (this.index) {
          var transform = el[0].style.transform;
          var translateY = transform.indexOf("(") == -1 ? 0 : parseInt(transform.split("(")[1].split("px")[0]);
          margin = el.outerHeight() + translateY;
        } else {
          margin = el.outerHeight();
        }
      } else {
        var el = $(`${constants$1.HOME_SCREEN_SELECTOR} > div > div`).eq(2);
        margin = el.outerHeight();
      }
      return margin;
    }
    applyItemStyle(element, selected) {
      $(element).addClass("item");
      if (this.config.get("postActionButtonPosition") == "Left") {
        const postContainer = $(element).find('div[data-testid="contentHider-post"]').prev();
        if (postContainer.length) {
          postContainer.css("flex", "");
        }
      }
      const postTimestampElement = $(element).find('a[href^="/profile/"][data-tooltip*=" at "]').first();
      if (!postTimestampElement.attr("data-bsky-navigator-age")) {
        postTimestampElement.attr("data-bsky-navigator-age", postTimestampElement.text());
      }
      const userFormat = this.config.get("postTimestampFormat");
      const postTimeString = postTimestampElement.attr("aria-label");
      if (postTimeString && userFormat) {
        const postTimestamp = new Date(postTimeString.replace(" at", ""));
        if (userFormat) {
          const formattedDate = format(postTimestamp, userFormat).replace("$age", postTimestampElement.attr("data-bsky-navigator-age"));
          if (this.config.get("showDebuggingInfo")) {
            postTimestampElement.text(`${formattedDate} (${$(element).parent().parent().attr("data-bsky-navigator-thread-index")}, ${$(element).attr("data-bsky-navigator-item-index")})`);
          } else {
            postTimestampElement.text(formattedDate);
          }
        }
      }
      const threadIndicator = $(element).find("div.r-lchren, div.r-1mhb1uw > svg");
      const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]');
      $(element).parent().parent().addClass("thread");
      if (this.config.get("showPostCounts") == "All" || selected && this.config.get("showPostCounts") == "Selection") {
        const bannerDiv = $(element).find("div.item-banner").first().length ? $(element).find("div.item-banner").first() : $(element).find("div").first().prepend($('<div class="item-banner"/>')).children(".item-banner").last();
        $(bannerDiv).html(`<strong>${this.getIndexFromItem(element) + 1}</strong>/<strong>${this.itemStats.shownCount}</strong>`);
      }
      $(element).css("scroll-margin-top", `${this.scrollMargin}px`, `!important`);
      $(element).find("video").each(
        (i, video) => {
          if (this.config.get("videoPreviewPlayback") == "Pause all" || this.config.get("videoPreviewPlayback") == "Play selected" && !selected) {
            this.pauseVideo(video);
          } else if (this.config.get("videoPreviewPlayback") == "Play selected" && selected) {
            this.playVideo(video);
          }
        }
      );
      if (selected) {
        $(element).parent().parent().addClass("thread-selection-active");
        $(element).parent().parent().removeClass("thread-selection-inactive");
      } else {
        $(element).parent().parent().removeClass("thread-selection-active");
        $(element).parent().parent().addClass("thread-selection-inactive");
      }
      if (threadIndicator.length) {
        var parent = threadIndicator.parents().has(avatarDiv).first();
        var children = parent.find("*");
        if (threadIndicator.length == 1) {
          var parent = threadIndicator.parents().has(avatarDiv).first();
          var children = parent.find("*");
          if (children.index(threadIndicator) < children.index(avatarDiv)) {
            $(element).parent().parent().addClass("thread-last");
          } else {
            $(element).parent().parent().addClass("thread-first");
          }
        } else {
          $(element).parent().parent().addClass("thread-middle");
        }
      } else {
        $(element).parent().parent().addClass(["thread-first", "thread-middle", "thread-last"]);
      }
      if (selected) {
        $(element).addClass("item-selection-active");
        $(element).removeClass("item-selection-inactive");
      } else {
        $(element).removeClass("item-selection-active");
        $(element).addClass("item-selection-inactive");
      }
      var postId = this.postIdForItem($(element));
      if (postId != null && this.state.seen[postId]) {
        $(element).addClass("item-read");
        $(element).removeClass("item-unread");
      } else {
        $(element).addClass("item-unread");
        $(element).removeClass("item-read");
      }
      const handle = this.handleFromItem(element);
      if (this.state.blocks.all.includes(handle)) {
        $(element).find(constants$1.PROFILE_SELECTOR).css(constants$1.CLEARSKY_BLOCKED_ALL_CSS);
      }
      if (this.state.blocks.recent.includes(handle)) {
        $(element).find(constants$1.PROFILE_SELECTOR).css(constants$1.CLEARSKY_BLOCKED_RECENT_CSS);
      }
    }
    didMouseMove(event) {
      const currentPosition = { x: event.pageX, y: event.pageY };
      if (this.lastMousePosition) {
        const distanceMoved = Math.sqrt(
          Math.pow(currentPosition.x - this.lastMousePosition.x, 2) + Math.pow(currentPosition.y - this.lastMousePosition.y, 2)
        );
        this.lastMousePosition = currentPosition;
        if (distanceMoved >= this.MOUSE_MOVEMENT_THRESHOLD) {
          return true;
        }
      } else {
        this.lastMousePosition = currentPosition;
      }
      return false;
    }
    onItemMouseOver(event) {
      if (this.ignoreMouseMovement) {
        return;
      }
      var target2 = $(event.target).closest(this.selector);
      var index = this.getIndexFromItem(target2);
      if (index != this.index) {
        this.applyItemStyle(this.items[this.index], false);
      }
      this.setIndex(index);
    }
    handleInput(event) {
      if (this.handleMovementKey(event)) {
        return event.key;
      } else if (this.handleItemKey(event)) {
        return event.key;
      } else if (event.key == "U") {
        this.loadOlderItems();
      } else {
        return super.handleInput(event);
      }
    }
    filterItems() {
      return;
    }
    sortItems() {
      return;
    }
    showMessage(title, message2) {
      this.hideMessage();
      this.messageContainer = $('<div id="messageContainer">');
      if (title) {
        const messageTitle = $('<div class="messageTitle">');
        $(messageTitle).html(title);
        this.messageContainer.append(messageTitle);
      }
      const messageBody = $('<div class="messageBody">');
      this.messageContainer.append(messageBody);
      $(messageBody).html(message2);
      $(constants$1.FEED_CONTAINER_SELECTOR).filter(":visible").append(this.messageContainer);
      window.scrollTo(0, 0);
    }
    hideMessage() {
      $("#messageContainer").remove();
      this.messageContainer = null;
    }
    getTimestampForItem(item) {
      const postTimestampElement = $(item).find('a[href^="/profile/"][data-tooltip*=" at "]').first();
      const postTimeString = postTimestampElement.attr("aria-label");
      if (!postTimeString) {
        return null;
      }
      return new Date(postTimeString.replace(" at", ""));
    }
    loadItems(focusedPostId) {
      this.items.length;
      this.index;
      const classes = ["thread-first", "thread-middle", "thread-last"];
      let set = [];
      $(this.items).css("opacity", "0%");
      let itemIndex = 0;
      let threadIndex = 0;
      $(this.selector).filter(":visible").each((i, item) => {
        $(item).attr("data-bsky-navigator-item-index", itemIndex++);
        $(item).parent().parent().attr("data-bsky-navigator-thread-index", threadIndex);
        const threadDiv = $(item).parent().parent();
        if (classes.some((cls) => $(threadDiv).hasClass(cls))) {
          set.push(threadDiv[0]);
          if ($(threadDiv).hasClass("thread-last")) {
            threadIndex++;
          }
        }
      });
      this.sortItems();
      this.filterItems();
      this.items = $(this.selector).filter(":visible");
      this.itemStats.oldest = this.itemStats.newest = null;
      $(this.selector).filter(":visible").each((i, item) => {
        const timestamp = this.getTimestampForItem(item);
        if (!this.itemStats.oldest || timestamp < this.itemStats.oldest) {
          this.itemStats.oldest = timestamp;
        }
        if (!this.itemStats.newest || timestamp > this.itemStats.newest) {
          this.itemStats.newest = timestamp;
        }
      });
      this.setupIntersectionObserver();
      this.enableFooterObserver();
      if (this.index != null) {
        this.applyItemStyle(this.items[this.index], true);
      }
      $("div.r-1mhb1uw").each(
        (i, el) => {
          const ancestor = $(el).parent().parent().parent().parent();
          $(el).parent().parent().parent().addClass("item-selection-inactive");
          if ($(ancestor).prev().find("div.item-unread").length) {
            $(el).parent().parent().parent().addClass("item-unread");
            $(el).parent().parent().parent().removeClass("item-read");
          } else {
            $(el).parent().parent().parent().addClass("item-read");
            $(el).parent().parent().parent().removeClass("item-unread");
          }
        }
      );
      $("div.r-1mhb1uw svg").each(
        (i, el) => {
          $(el).find("line").attr("stroke", this.config.get("threadIndicatorColor"));
          $(el).find("circle").attr("fill", this.config.get("threadIndicatorColor"));
        }
      );
      $(this.selector).on("mouseover", this.onItemMouseOver);
      $(this.selector).on("mouseleave", this.onItemMouseLeave);
      $(this.selector).closest("div.thread").addClass("bsky-navigator-seen");
      $(this.selector).closest("div.thread").removeClass(["loading-indicator-reverse", "loading-indicator-forward"]);
      this.refreshItems();
      this.loading = false;
      $("img#loadOlderIndicatorImage").addClass("image-highlight");
      $("img#loadOlderIndicatorImage").removeClass("toolbar-icon-pending");
      if (focusedPostId) {
        this.jumpToPost(focusedPostId);
      } else if (!this.jumpToPost(this.postId)) {
        this.setIndex(0);
      }
      this.updateInfoIndicator();
      this.enableFooterObserver();
      if ($(this.items).filter(":visible").length == 0) {
        this.showMessage("No more unread posts.", `
<p>
You're all caught up.
</p>

<div id="messageActions"/>
`);
        if ($("#loadOlderAction").length == 0) {
          $("#messageActions").append($('<div id="loadOlderAction"><a>Load older posts</a></div>'));
          $("#loadOlderAction > a").on("click", () => this.loadOlderItems());
        }
        if ($("img#loadNewerIndicatorImage").hasClass("image-highlight")) {
          $("#messageActions").append($('<div id="loadNewerAction"><a>Load newer posts</a></div>'));
          $("#loadNewerAction > a").on("click", () => this.loadNewerItems());
        }
      } else {
        this.hideMessage();
      }
      this.ignoreMouseMovement = false;
    }
    refreshItems() {
      $(this.items).each(
        (index, item) => {
          this.applyItemStyle(this.items[index], index == this.index);
        }
      );
      $(this.items).css("opacity", "100%");
    }
    updateInfoIndicator() {
      this.itemStats.unreadCount = this.items.filter(
        (i, item) => $(item).hasClass("item-unread")
      ).length;
      this.itemStats.filteredCount = this.items.filter(".filtered").length;
      this.itemStats.shownCount = this.items.length - this.itemStats.filteredCount;
      const index = this.itemStats.shownCount ? this.index + 1 : 0;
      $("div#infoIndicatorText").html(`
<div id="itemCountStats">
<strong>${index}</strong>/<strong>${this.itemStats.shownCount}</strong> (<strong>${this.itemStats.filteredCount}</strong> filtered, <strong>${this.itemStats.unreadCount}</strong> new)
</div>
<div id="itemTimestampStats">
${this.itemStats.oldest ? `${format(this.itemStats.oldest, "yyyy-MM-dd hh:mmaaa")} - ${format(this.itemStats.newest, "yyyy-MM-dd hh:mmaaa")}</div>` : ``}`);
    }
    loadNewerItems() {
      if (!this.loadNewerButton) {
        console.log("no button");
        return;
      }
      this.loadingNew = true;
      this.applyItemStyle(this.items[this.index], false);
      let oldPostId = this.postIdForItem(this.items[this.index]);
      $(this.loadNewerButton).click();
      setTimeout(() => {
        this.loadItems(oldPostId);
        $("img#loadNewerIndicatorImage").removeClass("image-highlight");
        $("img#loadNewerIndicatorImage").removeClass("toolbar-icon-pending");
        $("#loadNewerAction").remove();
        this.loadingNew = false;
      }, 1e3);
    }
    loadOlderItems() {
      if (this.loading) {
        return;
      }
      console.log("loading more");
      $("img#loadOlderIndicatorImage").removeClass("image-highlight");
      $("img#loadOlderIndicatorImage").addClass("toolbar-icon-pending");
      this.loading = true;
      const reversed = this.state.feedSortReverse;
      const index = reversed ? 0 : this.items.length - 1;
      this.setIndex(index);
      this.updateItems();
      var indicatorElement = this.items.length ? this.items[index] : $(this.selector).eq(index)[0];
      var loadElement = this.items.length ? this.items[this.items.length - 1] : $(this.selector).first()[0];
      $(indicatorElement).closest("div.thread").addClass(this.state.feedSortReverse ? "loading-indicator-forward" : "loading-indicator-reverse");
      this.loadOlderItemsCallback(
        [
          {
            time: performance.now(),
            target: loadElement,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: loadElement.getBoundingClientRect(),
            intersectionRect: loadElement.getBoundingClientRect(),
            rootBounds: document.documentElement.getBoundingClientRect()
          }
        ]
      );
    }
    postIdFromUrl() {
      return window.location.href.split("/")[6];
    }
    postIdForItem(item) {
      try {
        return $(item).find("a[href*='/post/']").attr("href").split("/")[4];
      } catch (e) {
        return this.postIdFromUrl();
      }
    }
    handleFromItem(item) {
      return $.trim($(item).find(constants$1.PROFILE_SELECTOR).find("span").eq(1).text().replace(/[\u200E\u200F\u202A-\u202E]/g, "")).slice(1);
    }
    displayNameFromItem(item) {
      return $.trim($(item).find(constants$1.PROFILE_SELECTOR).find("span").eq(0).text().replace(/[\u200E\u200F\u202A-\u202E]/g, ""));
    }
    getHandles() {
      return Array.from(new Set(this.items.map((i, item) => this.handleFromItem(item))));
    }
    getDisplayNames() {
      return Array.from(new Set(this.items.map((i, item) => this.displayNameFromItem(item))));
    }
    getAuthors() {
      const authors = $(this.items).get().map((item) => ({
        handle: this.handleFromItem(item),
        displayName: this.displayNameFromItem(item)
      })).filter(
        (author) => author.handle.length > 0
      );
      const uniqueMap = /* @__PURE__ */ new Map();
      authors.forEach((author) => {
        uniqueMap.set(author.handle, author);
      });
      return Array.from(uniqueMap.values());
    }
    updateItems() {
      this.enableScrollMonitor = false;
      this.ignoreMouseMovement = true;
      if (this.index == 0) {
        window.scrollTo(0, 0);
      } else if (this.items[this.index]) {
        this.scrollToElement($(this.items[this.index])[0]);
      } else ;
      setTimeout(() => {
        console.log("enable");
        this.ignoreMouseMovement = false;
        this.enableScrollMonitor = true;
      }, 2e3);
    }
    setIndex(index, mark, update) {
      let oldIndex = this.index;
      if (oldIndex != null) {
        if (mark) {
          this.markItemRead(oldIndex, true);
        }
      }
      if (index < 0 || index >= this.items.length) {
        return;
      }
      this.applyItemStyle(this.items[oldIndex], false);
      this.index = index;
      this.applyItemStyle(this.items[this.index], true);
      if (update) {
        this.updateItems();
      }
      return true;
    }
    jumpToPost(postId) {
      for (const [i, item] of $(this.items).get().entries()) {
        const other = this.postIdForItem(item);
        if (postId == other) {
          this.setIndex(i);
          this.updateItems();
          return true;
        }
      }
      return false;
    }
    markItemRead(index, isRead) {
      if (this.name == "post" && !this.config.get("savePostState")) {
        return;
      }
      let postId = this.postIdForItem(this.items[index]);
      if (!postId) {
        return;
      }
      this.markPostRead(postId, isRead);
      this.applyItemStyle(this.items[index], index == this.index);
      this.updateInfoIndicator();
    }
    markPostRead(postId, isRead) {
      const currentTime = (/* @__PURE__ */ new Date()).toISOString();
      const seen = { ...this.state.seen };
      if (isRead || isRead == null && !seen[postId]) {
        seen[postId] = currentTime;
      } else {
        seen[postId] = null;
      }
      this.state.stateManager.updateState({ seen, lastUpdated: currentTime });
    }
    markVisibleRead() {
      $(this.items).each(
        (i, item) => {
          this.markItemRead(i, true);
        }
      );
    }
    // FIXME: move to PostItemHanler
    handleNewThreadPage(element) {
      console.log(this.items.length);
      this.loadPageObserver.disconnect();
    }
    jumpToPrev(mark) {
      this.setIndex(this.index - 1, mark, true);
      return true;
    }
    jumpToNext(mark) {
      if (this.index < this.items.length) {
        this.setIndex(this.index + 1, mark, true);
      } else {
        var next = $(this.items[this.index]).parent().parent().parent().next();
        if (next && $.trim(next.text()) == "Continue thread...") {
          this.loadPageObserver = waitForElement$1(
            this.THREAD_PAGE_SELECTOR,
            this.handleNewThreadPage
          );
          console.log(this.loadPageObserver);
          $(next).find("div").click();
        }
      }
      return true;
    }
    handleMovementKey(event) {
      var moved = false;
      var mark = false;
      this.index;
      if (this.isPopupVisible) {
        return;
      }
      this.ignoreMouseMovement = true;
      if (this.keyState.length == 0) {
        if (["j", "k", "ArrowDown", "ArrowUp", "J", "G"].includes(event.key)) {
          if (["j", "ArrowDown"].indexOf(event.key) != -1) {
            event.preventDefault();
            moved = this.jumpToNext(event.key == "j");
          } else if (["k", "ArrowUp"].indexOf(event.key) != -1) {
            event.preventDefault();
            moved = this.jumpToPrev(event.key == "k");
          } else if (event.key == "G") {
            moved = this.setIndex(this.items.length - 1, false, true);
          } else if (event.key == "J") {
            mark = true;
            this.jumpToNextUnseenItem(mark);
          }
          moved = true;
        } else if (event.key == "g") {
          this.keyState.push(event.key);
        }
      } else if (this.keyState[0] == "g") {
        if (event.key == "g") {
          if (this.index < this.items.length) {
            this.setIndex(0, false, true);
          }
          moved = true;
        }
        this.keyState = [];
      }
      if (moved) {
        this.lastMousePosition = null;
      }
    }
    jumpToNextUnseenItem(mark) {
      var i;
      for (i = this.index + 1; i < this.items.length - 1; i++) {
        var postId = this.postIdForItem(this.items[i]);
        if (!this.state.seen[postId]) {
          break;
        }
      }
      this.setIndex(i, mark);
      this.updateItems();
    }
    getIndexFromItem(item) {
      return $(".item").filter(":visible").index(item);
    }
    handleItemKey(event) {
      if (this.isPopupVisible) {
        return false;
      } else if (event.altKey && !event.metaKey) {
        if (event.code.startsWith("Digit")) {
          const num = parseInt(event.code.substr(5)) - 1;
          $("#bsky-navigator-search").autocomplete("disable");
          if (num >= 0) {
            const ruleName = Object.keys(this.state.rules)[num];
            console.log(ruleName);
            $("#bsky-navigator-search").val(`${event.shiftKey ? "!" : ""}$${ruleName}`);
          } else {
            $("#bsky-navigator-search").val(null);
          }
          $("#bsky-navigator-search").trigger("input");
          $("#bsky-navigator-search").autocomplete("enable");
          return event.key;
        } else {
          return false;
        }
      } else if (!event.metaKey) {
        var item = this.items[this.index];
        if (["o", "Enter"].includes(event.key) && !this.isPopupVisible) {
          $(item).click();
        } else if (event.key == "O") {
          var inner = $(item).find("div[aria-label^='Post by']");
          inner.click();
        } else if (event.key == "i") {
          if ($(item).find(constants$1.LINK_SELECTOR).length) {
            $(item).find(constants$1.LINK_SELECTOR)[0].click();
          }
        } else if (event.key == "m") {
          var media = $(item).find("img[src*='feed_thumbnail']");
          if (media.length > 0) {
            media[0].click();
          } else {
            const video = $(item).find("video")[0];
            if (video) {
              event.preventDefault();
              if (video.muted) {
                video.muted = false;
              }
              if (video.paused) {
                this.playVideo(video);
              } else {
                this.pauseVideo(video);
              }
            }
          }
        } else if (event.key == "r") {
          var button = $(item).find("button[aria-label^='Reply']");
          button.focus();
          button.click();
        } else if (event.key == "l") {
          $(item).find("button[data-testid='likeBtn']").click();
        } else if (event.key == "p") {
          $(item).find("button[aria-label^='Repost']").click();
        } else if (event.key == "P") {
          $(item).find("button[aria-label^='Repost']").click();
          setTimeout(function() {
            $("div[aria-label^='Repost'][role='menuitem']").click();
          }, 1e3);
        } else if (event.key == ".") {
          this.markItemRead(this.index, null);
        } else if (event.key == "A") {
          this.markVisibleRead();
        } else if (event.key == "h") {
          var back_button = $("button[aria-label^='Back' i]").filter(":visible");
          if (back_button.length) {
            back_button.click();
          } else {
            history.back(1);
          }
        } else if (!isNaN(parseInt(event.key))) {
          $("div[role='tablist'] > div > div > div").filter(":visible")[parseInt(event.key) - 1].click();
        } else {
          return false;
        }
      }
      return event.key;
    }
  }
  class FeedItemHandler extends ItemHandler {
    INDICATOR_IMAGES = {
      loadTop: [
        "https://www.svgrepo.com/show/502348/circleupmajor.svg"
      ],
      loadBottom: [
        "https://www.svgrepo.com/show/502338/circledownmajor.svg"
      ],
      loadTime: [
        "https://www.svgrepo.com/show/446075/time-history.svg"
      ],
      filter: [
        "https://www.svgrepo.com/show/347140/mail.svg",
        "https://www.svgrepo.com/show/347147/mail-unread.svg"
      ],
      sort: [
        "https://www.svgrepo.com/show/506581/sort-numeric-alt-down.svg",
        "https://www.svgrepo.com/show/506582/sort-numeric-up.svg"
      ],
      preferences: [
        "https://www.svgrepo.com/show/522235/preferences.svg",
        "https://www.svgrepo.com/show/522236/preferences.svg"
      ]
    };
    constructor(name, config2, state2, selector) {
      super(name, config2, state2, selector);
      this.toggleSortOrder = this.toggleSortOrder.bind(this);
      this.onSearchAutocomplete = this.onSearchAutocomplete.bind(this);
      this.onSearchKeydown = this.onSearchKeydown.bind(this);
      this.setFilter = this.setFilter.bind(this);
      this.feedTabObserver = waitForElement$1(
        constants$1.FEED_TAB_SELECTOR,
        (tab) => {
          observeChanges$1(
            tab,
            (attributeName, oldValue, newValue, target2) => {
              if (attributeName == "class" && newValue.includes("r-13awgt0")) {
                console.log("refresh");
                this.refreshItems();
              }
            },
            false
          );
        }
      );
    }
    applyItemStyle(element, selected) {
      super.applyItemStyle(element, selected);
      const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]');
      if (this.config.get("postActionButtonPosition") == "Left") {
        const buttonsDiv = $(element).find('button[data-testid="postDropdownBtn"]').parent().parent().parent();
        $(buttonsDiv).parent().css(
          {
            "min-height": "160px",
            "min-width": "80px"
            // "margin-left": "10px"
          }
        );
        buttonsDiv.css(
          {
            "display": "flex",
            "flex-direction": "column",
            "align-items": "flex-start",
            "position": "absolute",
            "bottom": "0px",
            "z-index": "10"
          }
        );
        $(buttonsDiv).find("> div").css(
          {
            "margin-left": "0px",
            "width": "100%"
          }
        );
        $(buttonsDiv).find("> div > div").css(
          {
            "width": "100%"
          }
        );
        const buttons = $(buttonsDiv).find('button[data-testid!="postDropdownBtn"]');
        buttons.each(
          (i, button) => {
            $(button).css(
              {
                "display": "flex",
                "align-items": "center",
                /* Ensures vertical alignment */
                "justify-content": "space-between",
                /* Pushes text to the right */
                "gap": "12px",
                /* Space between the icon and text */
                "width": "100%",
                "padding": "5px 2px"
              }
            );
            const div = $(button).find("> div").first();
            if (div.length) {
              $(div).css({
                "display": "flex",
                "align-items": "center",
                /* Ensures vertical alignment */
                "justify-content": "space-between",
                /* Pushes text to the right */
                "gap": "12px",
                /* Space between the icon and text */
                // "width": "100%",
                "padding": "0px"
              });
            }
            if ($(button).attr("aria-label").startsWith("Repost")) {
              $(div).css(
                "width",
                "100%"
              );
            }
            const svg = $(button).find("svg").first();
            $(svg).css({
              "flex-shrink": "0",
              /* Prevents icon from resizing */
              // "vertical-align": "middle", /* Ensures SVG is aligned with the text */
              "display": "block"
              /* Removes inline spacing issues */
            });
          }
        );
        avatarDiv.closest("div.r-c97pre").children().eq(0).after(buttonsDiv);
      }
    }
    addToolbar(beforeDiv) {
      this.toolbarDiv = $(`<div id="bsky-navigator-toolbar"/>`);
      $(beforeDiv).before(this.toolbarDiv);
      this.topLoadIndicator = $(`
<div id="topLoadIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
</div>`);
      $(this.toolbarDiv).append(this.topLoadIndicator);
      this.sortIndicator = $(`<div id="sortIndicator" title="change sort order" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="sortIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.sort[0]}"/></div>`);
      $(this.toolbarDiv).append(this.sortIndicator);
      $(".indicator-image path").attr("fill", "currentColor");
      $("#sortIndicator").on("click", (event) => {
        event.preventDefault();
        this.toggleSortOrder();
      });
      this.filterIndicator = $(`<div id="filterIndicator" title="show all or unread" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="filterIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.filter[0]}"/></div>`);
      $(this.toolbarDiv).append(this.filterIndicator);
      $("#filterIndicator").on("click", (event) => {
        event.preventDefault();
        this.toggleHideRead();
      });
      this.searchField = $(`<input id="bsky-navigator-search" type="text"/>`);
      $(this.toolbarDiv).append(this.searchField);
      $("#bsky-navigator-search").autocomplete({
        minLength: 0,
        appendTo: 'div[data-testid="homeScreenFeedTabs"]',
        source: this.onSearchAutocomplete,
        focus: function(event, ui) {
          event.preventDefault();
        },
        focus: function(event, ui) {
          event.preventDefault();
        },
        select: function(event, ui) {
          event.preventDefault();
          let input = this;
          let terms = splitTerms(input.value);
          terms.pop();
          terms.push(ui.item.value);
          input.value = terms.join(" ") + " ";
          $(this).autocomplete("close");
        }
      });
      $("#bsky-navigator-search").on("keydown", function(event) {
        if (event.key === "Tab") {
          let autocompleteMenu = $(".ui-autocomplete:visible");
          let firstItem = autocompleteMenu.children(".ui-menu-item").first();
          if (firstItem.length) {
            let uiItem = firstItem.data("ui-autocomplete-item");
            $(this).autocomplete("close");
            let terms = splitTerms(this.value);
            terms.pop();
            terms.push(uiItem.value);
            this.value = terms.join(" ") + " ";
            event.preventDefault();
          }
        }
      });
      this.onSearchUpdate = (event) => {
        const val = $(event.target).val();
        console.log(val);
        if (val === "/") {
          $("#bsky-navigator-search").val("");
          $(this.searchField).autocomplete("close");
          $("a[aria-label='Search']")[0].click();
          return;
        }
        this.debouncedSearchUpdate(event);
      };
      this.debouncedSearchUpdate = debounce((event) => {
        const val = $(event.target).val();
        this.setFilter(val.trim());
        this.loadItems();
      }, 300);
      this.onSearchUpdate = this.onSearchUpdate.bind(this);
      $(this.searchField).on("keydown", this.onSearchKeydown);
      $(this.searchField).on("input", this.onSearchUpdate);
      $(this.searchField).on("focus", function() {
        $(this).autocomplete("search", "");
      });
      $(this.searchField).on("autocompletechange autocompleteclose", this.onSearchUpdate);
      $(this.searchField).on("autocompleteselect", this.onSearchUpdate);
      waitForElement$1(
        "#bsky-navigator-toolbar",
        null,
        (div) => {
          this.addToolbar(beforeDiv);
        }
      );
    }
    onSearchKeydown(event) {
      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        this.handleInput(event);
      }
    }
    refreshToolbars() {
      waitForElement$1(
        constants$1.TOOLBAR_CONTAINER_SELECTOR,
        (indicatorContainer) => {
          waitForElement$1(
            'div[data-testid="homeScreenFeedTabs"]',
            (homeScreenFeedTabsDiv) => {
              if (!$("#bsky-navigator-toolbar").length) {
                this.addToolbar(homeScreenFeedTabsDiv);
              }
            }
          );
        }
      );
      waitForElement$1(
        constants$1.STATUS_BAR_CONTAINER_SELECTOR,
        (statusBarContainer, observer) => {
          if (!$("#statusBar").length) {
            this.addStatusBar($(statusBarContainer).parent().parent().parent().parent().parent());
            observer.disconnect();
          }
        }
      );
      waitForElement$1(
        "#bsky-navigator-toolbar",
        (div) => {
          waitForElement$1(
            "#statusBar",
            (div2) => {
              this.setSortIcons();
            }
          );
        }
      );
    }
    onSearchAutocomplete(request, response) {
      const authors = this.getAuthors().sort((a, b) => a.handle.localeCompare(b.handle, void 0, { sensitivity: "base" }));
      const rules = Object.keys(this.state.rules);
      let term = extractLastTerm(request.term).toLowerCase();
      let isNegation = term.startsWith("!");
      if (isNegation) term = term.substring(1);
      let results = [];
      if (term === "") {
        results = rules.map((r) => ({ label: `$${r}`, value: `$${r}` }));
      } else if (term.startsWith("@") || term.startsWith("$")) {
        let type = term.charAt(0);
        let search = term.substring(1).toLowerCase();
        if (type === "@") {
          results = authors.filter(
            (a) => a.handle.toLowerCase().includes(search) || a.displayName.toLowerCase().includes(search)
          ).map((a) => ({
            label: `${isNegation ? "!" : ""}@${a.handle} (${a.displayName})`,
            value: `${isNegation ? "!" : ""}@${a.handle}`
          }));
        } else if (type === "$") {
          results = rules.filter((r) => r.toLowerCase().includes(search)).map((r) => ({
            label: `${isNegation ? "!" : ""}$${r}`
          }));
        }
      }
      response(results);
    }
    addStatusBar(statusBarContainer) {
      this.statusBar = $(`<div id="statusBar"></div>`);
      this.statusBarLeft = $(`<div id="statusBarLeft"></div>`);
      this.statusBarCenter = $(`<div id="statusBarCenter"></div>`);
      this.statusBarRight = $(`<div id="statusBarRight"></div>`);
      $(this.statusBar).append(this.statusBarLeft);
      $(this.statusBar).append(this.statusBarCenter);
      $(this.statusBar).append(this.statusBarRight);
      $(statusBarContainer).append(this.statusBar);
      this.bottomLoadIndicator = $(`
<div id="bottomLoadIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"/>
`);
      $(this.statusBarLeft).append(this.bottomLoadIndicator);
      if (!this.infoIndicator) {
        this.infoIndicator = $(`<div id="infoIndicator" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="infoIndicatorText"/></div>`);
        $(this.statusBarCenter).append(this.infoIndicator);
      }
      if (!this.preferencesIcon) {
        this.preferencesIcon = $(`<div id="preferencesIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="preferencesIcon"><img id="preferencesIconImage" class="indicator-image preferences-icon-overlay" src="${this.INDICATOR_IMAGES.preferences[0]}"/></div></div>`);
        $(this.preferencesIcon).on("click", () => {
          $("#preferencesIconImage").attr("src", this.INDICATOR_IMAGES.preferences[1]);
          this.config.open();
        });
        $(this.statusBarRight).append(this.preferencesIcon);
      }
    }
    activate() {
      super.activate();
      this.refreshToolbars();
      waitForElement$1(
        "#bsky-navigator-search",
        (el) => {
          $(el).val(this.state.filter);
        }
      );
    }
    deactivate() {
      super.deactivate();
    }
    isActive() {
      return window.location.pathname == "/";
    }
    toggleSortOrder() {
      this.state.stateManager.updateState({ feedSortReverse: !this.state.feedSortReverse });
      this.setSortIcons();
      $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen");
      this.loadItems();
    }
    setSortIcons() {
      ["top", "bottom"].forEach(
        (bar) => {
          const which = !this.state.feedSortReverse && bar == "bottom" || this.state.feedSortReverse && bar == "top" ? "Older" : "Newer";
          const img = this.INDICATOR_IMAGES[`load${bar.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())}`][0];
          $(`#${bar}LoadIndicator`).empty();
          $(`#${bar}LoadIndicator`).append(`
<div id="load${which}Indicator" title="Load ${which.toLowerCase()} items" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
      <a id="load${which}IndicatorLink">
<img id="load${which}IndicatorImage" class="indicator-image" src="${img}"/>
<img id="loadTime${which}IndicatorImage" class="indicator-image load-time-icon ${which == "Newer" ? "image-flip-x" : ""}" src="${this.INDICATOR_IMAGES.loadTime[0]}"/>
</a>
</div>
`);
        }
      );
      $("img#loadOlderIndicatorImage").addClass("image-highlight");
      $("a#loadOlderIndicatorLink").on("click", () => this.loadOlderItems());
    }
    toggleHideRead() {
      this.state.stateManager.updateState({ feedHideRead: !this.state.feedHideRead });
      $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen");
      this.loadItems();
    }
    setFilter(text) {
      this.state.stateManager.saveStateImmediately(true, true);
      this.state.filter = text;
    }
    filterItem(item, thread) {
      if (this.state.feedHideRead) {
        if ($(item).hasClass("item-read")) {
          return false;
        }
      }
      if (this.state.filter && this.state.rules) {
        const activeRules = this.state.filter.split(/[ ]+/).map(
          (ruleStatement) => {
            const [_, invert, matchType, query] = ruleStatement.match(/(!)?([$@%])?"?([^"]+)"?/);
            return {
              invert,
              matchType,
              query
            };
          }
        );
        return activeRules.map(
          (activeRule) => {
            var allowed = null;
            switch (activeRule.matchType) {
              case "$":
                const rules = this.state.rules[activeRule.query];
                if (!rules) {
                  console.log(`no rule ${activeRule.query}`);
                  return null;
                }
                rules.forEach((rule) => {
                  if (rule.type === "all") {
                    allowed = rule.action === "allow";
                  } else if (rule.type === "from" && !!this.filterAuthor(item, rule.value.substring(1))) {
                    allowed = allowed || rule.action === "allow";
                  } else if (rule.type === "content" && !!this.filterContent(item, rule.value)) {
                    allowed = allowed || rule.action === "allow";
                  }
                });
                break;
              case "@":
                allowed = !!this.filterAuthor(item, activeRule.query);
                break;
              case "%":
                allowed = !!this.filterContent(item, activeRule.query);
                break;
              default:
                allowed = !!this.filterAuthor(item, activeRule.query) || !!this.filterContent(item, activeRule.query);
                break;
            }
            return activeRule.invert ? !allowed : allowed;
          }
        ).every((allowed) => allowed == true);
      }
      return true;
    }
    filterAuthor(item, author) {
      const pattern = new RegExp(author, "i");
      const handle = this.handleFromItem(item);
      const displayName = this.displayNameFromItem(item);
      if (!handle.match(pattern) && !displayName.match(pattern)) {
        return false;
      }
      return true;
    }
    filterContent(item, query) {
      const pattern = new RegExp(query, "i");
      const content = $(item).find('div[data-testid="postText"]').text();
      return content.match(pattern);
    }
    filterThread(thread) {
      return $(thread).find(".item").length != $(thread).find(".filtered").length;
    }
    filterItems() {
      const hideRead = this.state.feedHideRead;
      $("#filterIndicatorImage").attr("src", this.INDICATOR_IMAGES.filter[+hideRead]);
      $("#filterIndicator").attr("title", `show all or unread (currently ${hideRead ? "unread" : "all"})`);
      const parent = $(this.selector).first().closest(".thread").parent();
      const unseenThreads = parent.find(".thread");
      $(unseenThreads).map(
        (i, thread) => {
          $(thread).find(".item").each(
            (i2, item) => {
              if (this.filterItem(item, thread)) {
                $(item).removeClass("filtered");
              } else {
                $(item).addClass("filtered");
              }
            }
          );
          if (this.filterThread(thread)) {
            $(thread).removeClass("filtered");
          } else {
            $(thread).addClass("filtered");
          }
        }
      );
      this.refreshItems();
      if (hideRead && $(this.items[this.index]).hasClass("item-read")) {
        console.log("jumping");
        this.jumpToNextUnseenItem();
      }
    }
    sortItems() {
      const reversed = this.state.feedSortReverse;
      $("#sortIndicatorImage").attr("src", this.INDICATOR_IMAGES.sort[+reversed]);
      $("#sortIndicator").attr("title", `change sort order (currently ${reversed ? "forward" : "reverse"} chronological)`);
      const parent = $(this.selector).closest(".thread").first().parent();
      const newItems = parent.children().filter(
        (i, item) => $(item).hasClass("thread")
      ).get().sort(
        (a, b) => {
          const threadIndexA = parseInt($(a).data("bsky-navigator-thread-index"));
          const threadIndexB = parseInt($(b).data("bsky-navigator-thread-index"));
          const itemIndexA = parseInt($(a).find(".item").data("bsky-navigator-item-index"));
          const itemIndexB = parseInt($(b).find(".item").data("bsky-navigator-item-index"));
          if (threadIndexA !== threadIndexB) {
            return reversed ? threadIndexB - threadIndexA : threadIndexA - threadIndexB;
          }
          return itemIndexA - itemIndexB;
        }
      );
      reversed ^ this.loadingNew ? parent.prepend(newItems) : parent.children(".thread").last().next().after(newItems);
    }
    handleInput(event) {
      var item = this.items[this.index];
      if (event.key == "a") {
        $(item).find(constants$1.PROFILE_SELECTOR)[0].click();
      } else if (event.key == "u") {
        this.loadNewerItems();
      } else if (event.key == ":") {
        this.toggleSortOrder();
      } else if (event.key == '"') {
        this.toggleHideRead();
      } else if (event.key == "/") {
        event.preventDefault();
        $("input#bsky-navigator-search").focus();
      } else if (event.key == ",") {
        this.loadItems();
      } else {
        super.handleInput(event);
      }
    }
  }
  class PostItemHandler extends ItemHandler {
    constructor(name, config2, state2, selector) {
      super(name, config2, state2, selector);
      this.indexMap = {};
      this.handleInput = this.handleInput.bind(this);
    }
    get index() {
      return this.indexMap?.[this.postId] ?? 0;
    }
    set index(value) {
      this.indexMap[this.postId] = value;
    }
    activate() {
      super.activate();
      this.postId = this.postIdFromUrl();
      this.markPostRead(this.postId, null);
    }
    deactivate() {
      super.deactivate();
    }
    isActive() {
      return window.location.pathname.match(/\/post\//);
    }
    get scrollMargin() {
      return $('div[data-testid="postThreadScreen"] > div').eq(0).outerHeight();
    }
    // getIndexFromItem(item) {
    //     return $(item).parent().parent().parent().parent().index() - 3
    // }
    handleInput(event) {
      if (["o", "Enter"].includes(event.key) && !(event.altKey || event.metaKey)) {
        var inner = $(item).find("div[aria-label^='Post by']");
        inner.click();
      }
      if (super.handleInput(event)) {
        return;
      }
      if (this.isPopupVisible || event.altKey || event.metaKey) {
        return;
      }
      var item = this.items[this.index];
      if (event.key == "a") {
        var handle = $.trim($(item).attr("data-testid").split("postThreadItem-by-")[1]);
        $(item).find("div").filter(
          (i, el) => $.trim($(el).text()).replace(/[\u200E\u200F\u202A-\u202E]/g, "") == `@${handle}`
        )[0].click();
      }
    }
  }
  class ProfileItemHandler extends FeedItemHandler {
    constructor(name, config2, state2, selector) {
      super(name, config2, state2, selector);
    }
    activate() {
      this.setIndex(0);
      super.activate();
    }
    deactivate() {
      super.deactivate();
    }
    isActive() {
      return window.location.pathname.match(/^\/profile\//);
    }
    handleInput(event) {
      if (super.handleInput(event)) {
        return;
      }
      if (event.altKey || event.metaKey) {
        return;
      }
      if (event.key == "f") {
        $("button[data-testid='followBtn']").click();
      } else if (event.key == "F") {
        $("button[data-testid='unfollowBtn']").click();
      } else if (event.key == "L") {
        $("button[aria-label^='More options']").click();
        setTimeout(function() {
          $("div[data-testid='profileHeaderDropdownListAddRemoveBtn']").click();
        }, 200);
      } else if (event.key == "M") {
        $("button[aria-label^='More options']").click();
        setTimeout(function() {
          $("div[data-testid='profileHeaderDropdownMuteBtn']").click();
        }, 200);
      } else if (event.key == "B") {
        $("button[aria-label^='More options']").click();
        setTimeout(function() {
          $("div[data-testid='profileHeaderDropdownBlockBtn']").click();
        }, 200);
      } else if (event.key == "R") {
        $("button[aria-label^='More options']").click();
        setTimeout(function() {
          $("div[data-testid='profileHeaderDropdownReportBtn']").click();
        }, 200);
      }
    }
  }
  const {
    waitForElement,
    observeChanges,
    observeVisibilityChange
  } = utils;
  GM_addStyle(style);
  let config;
  let handlers;
  const screenPredicateMap = {
    search: (element) => $(element).find('div[data-testid="searchScreen"]').length,
    notifications: (element) => $(element).find('div[data-testid="notificationsScreen"]').length,
    chat: (element) => $(element).find('div:contains("Messages")').length,
    feeds: (element) => $(element).find('div[data-testid="FeedsScreen"]').length,
    lists: (element) => $(element).find('div[data-testid="listsScreen"]').length,
    profile: (element) => $(element).find('div[data-testid="profileScreen"]').length,
    settings: (element) => $(element).find('a[aria-label="Account"]').length,
    home: (element) => true
  };
  function getScreenFromElement(element) {
    for (const [page, predicate] of Object.entries(screenPredicateMap)) {
      if (predicate(element)) {
        return page;
      }
    }
    return "unknown";
  }
  function setScreen(screen) {
    state.screen = screen;
    console.log(`screen: ${state.screen}`);
  }
  (function() {
    var current_url = null;
    var context = null;
    function parseRulesConfig(configText) {
      const lines = configText.split("\n");
      const rules = {};
      let rulesName = null;
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith(";") || line.startsWith("#")) continue;
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
          rulesName = sectionMatch[1];
          rules[rulesName] = [];
          continue;
        }
        if (!rulesName) continue;
        const ruleMatch = line.match(/(allow|deny) (all|from|content) "?([^"]+)"?/);
        if (ruleMatch) {
          const [_, action, type, value] = ruleMatch;
          rules[rulesName].push({ action, type, value });
          continue;
        }
        if (line.startsWith("@")) {
          rules[rulesName].push({ action: "allow", type: "from", value: line });
        } else {
          rules[rulesName].push({ action: "allow", type: "content", value: line });
        }
      }
      return rules;
    }
    function onConfigInit() {
      const stateManagerConfig = {
        stateSyncEnabled: config.get("stateSyncEnabled"),
        stateSyncConfig: config.get("stateSyncConfig"),
        stateSaveTimeout: config.get("stateSaveTimeout"),
        maxEntries: config.get("historyMax")
      };
      state.init(constants$1.STATE_KEY, stateManagerConfig, onStateInit);
    }
    function onConfigSave() {
      state.rulesConfig = config.get("rulesConfig");
      state.stateManager.saveStateImmediately(true, true);
      config.close();
    }
    function onStateInit() {
      let widthWatcher;
      handlers = {
        feed: new FeedItemHandler("feed", config, state, constants$1.FEED_ITEM_SELECTOR),
        post: new PostItemHandler("post", config, state, constants$1.POST_ITEM_SELECTOR),
        profile: new ProfileItemHandler("profile", config, state, constants$1.FEED_ITEM_SELECTOR),
        input: new Handler("input", config, state)
      };
      if (state.rulesConfig) {
        config.set("rulesConfig", state.rulesConfig);
      }
      state.rules = parseRulesConfig(config.get("rulesConfig"));
      if (config.get("showDebuggingInfo")) {
        let appendLog = function(type, args) {
          const message2 = `[${type.toUpperCase()}] ${args.map((arg) => typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg).join(" ")}`;
          $("#logContent").append(`<div style="margin-bottom: 5px;">${message2}</div>`);
          $("#logContent").scrollTop($("#logContent")[0].scrollHeight);
        };
        const logContainer = $(`<div id="logContainer"></div>`);
        $("body").append(logContainer);
        const logHeader = $(`<div id="logHeader"></div>`);
        logHeader.append($(`<button id="clearLogs"/>Clear</button>`));
        logContainer.append(logHeader);
        logContainer.append($(`<div id="logContent"></div>`));
        $("#clearLogs").on("click", function() {
          $("#logContent").empty();
        });
        const originalConsole = {};
        ["log", "warn", "error", "info"].forEach((type) => {
          originalConsole[type] = console[type];
          unsafeWindow.console[type] = function(...args) {
            appendLog(type, args);
            originalConsole[type].apply(console, args);
          };
        });
        window.console = unsafeWindow.console;
      }
      const stylesheet = `

        /* Feed itmes may be sorted, so we hide them visually and show them later */
        div[data-testid$="FeedPage"] ${constants$1.FEED_ITEM_SELECTOR} {
            opacity: 0%;
        }

        ${config.get("hideLoadNewButton") ? `
            ${constants$1.LOAD_NEW_BUTTON_SELECTOR} {
                display: none;
            }
            ` : ``}

        .item {
            ${config.get("posts")}
        }

        .item > div {
            border: none;
        }

        .item-selection-active {
            ${config.get("selectionActive")}
        }

        .item-selection-inactive {
            ${config.get("selectionInactive")}
        }

        @media (prefers-color-scheme:light){
            .item-unread {
                ${config.get("unreadPosts")};
                ${config.get("unreadPostsLightMode")};
            }

            .item-read {
                ${config.get("readPosts")};
                ${config.get("readPostsLightMode")};
            }

        }

        @media (prefers-color-scheme:dark){
            .item-unread {
                ${config.get("unreadPosts")};
                ${config.get("unreadPostsDarkMode")};
            }

            .item-read {
                ${config.get("readPosts")};
                ${config.get("readPostsDarkMode")};
            }
        }

        .thread-first {
            margin-top: ${config.get("threadMargin")};
            border-top: 1px rgb(212, 219, 226) solid;
        }

        .thread-last {
            margin-bottom: ${config.get("threadMargin")};
        }

        /* hack to fix last thread item indicator being offset */
        .thread-last div.r-lchren {
            left: 10px;
        }

        div.r-m5arl1 {
            width: ${config.get("threadIndicatorWidth")}px;
            background-color: ${config.get("threadIndicatorColor")} !important;
        }

`;
      const styleElement = document.createElement("style");
      styleElement.type = "text/css";
      styleElement.textContent = stylesheet;
      document.head.appendChild(styleElement);
      function updateScreen(screen) {
        setScreen(screen);
        if (screen == "search") {
          $('input[role="search"]').focus();
        }
        if (!widthWatcher) {
          widthWatcher = waitForElement(
            constants$1.WIDTH_SELECTOR,
            onWindowResize
          );
        }
      }
      waitForElement(constants$1.SCREEN_SELECTOR, (element) => {
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
        var target2 = e.target;
        if (typeof target2.tagName === "undefined") {
          return false;
        }
        var targetTagName = target2.tagName.toLowerCase();
        console.log(`onFocus: ${targetTagName}`);
        switch (targetTagName) {
          case "input":
          case "textarea":
            setContext("input");
            break;
          case "div":
            let maybeTiptap = $(target2).closest(".tiptap");
            if (maybeTiptap.length) {
              waitForElement(".tiptap", () => null, () => onBlur({ "target": maybeTiptap[0] }));
              setContext("input");
            } else {
              setContextFromUrl();
            }
            break;
          default:
            setContextFromUrl();
        }
      }
      function onBlur(e) {
        var target2 = e.target;
        if (typeof target2.tagName === "undefined") {
          return false;
        }
        var targetTagName = target2.tagName.toLowerCase();
        console.log(`onBlur: ${targetTagName}`);
        console.log(e.target);
        switch (targetTagName) {
          case "input":
          case "textarea":
            setContextFromUrl();
            break;
          case "div":
            if ($(target2).closest(".tiptap").length) {
              setContextFromUrl();
            }
            break;
          default:
            setContextFromUrl();
            break;
        }
      }
      document.addEventListener("focus", onFocus, true);
      document.addEventListener("blur", onBlur, true);
      function startMonitor() {
        setInterval(function() {
          if (window.location.href !== current_url) {
            setContextFromUrl();
          }
        }, constants$1.URL_MONITOR_INTERVAL);
      }
      state.mobileView = false;
      waitForElement(
        `${constants$1.DRAWER_MENU_SELECTOR}, ${constants$1.LEFT_SIDEBAR_SELECTOR}`,
        (element) => {
          console.log("viewport");
          state.mobileView = $(element).is(constants$1.DRAWER_MENU_SELECTOR);
          console.log(state.mobileView);
          startMonitor();
          setContextFromUrl();
        }
      );
      function setWidth(leftSidebar, width) {
        const LEFT_TRANSLATE_X_DEFAULT = -540;
        const RIGHT_TRANSLATE_X_DEFAULT = 300;
        const rightSidebar = $(leftSidebar).next();
        const sidebarDiff = (width - 600) / 2;
        if (state.leftSidebarMinimized) {
          $(leftSidebar).css("transform", "");
        } else if (sidebarDiff) {
          const leftTransform = $(leftSidebar).css("transform");
          if (!leftTransform) {
            console.log("!leftTransform");
            return;
          }
          const leftMatrix = leftTransform.match(/matrix\(([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+)\)/);
          if (!leftMatrix) {
            console.log("!leftMatrix");
            return;
          }
          const leftTranslateX = parseInt(leftMatrix[5]);
          console.log(`leftTranslateX = ${leftTranslateX}`);
          $(leftSidebar).css("transform", `translateX(${LEFT_TRANSLATE_X_DEFAULT - sidebarDiff}px)`);
          const rightTransform = $(rightSidebar).css("transform");
          if (!rightTransform) {
            console.log("!rightTransform");
            return;
          }
          const rightMatrix = rightTransform.match(/matrix\(([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+)\)/);
          const rightTranslateX = parseInt(rightMatrix[5]);
          console.log(`rightTranslateX = ${rightTranslateX}`);
          $(rightSidebar).css("transform", `translateX(${RIGHT_TRANSLATE_X_DEFAULT + sidebarDiff}px)`);
        } else {
          console.log("reset sidebars");
          $(leftSidebar).css("transform", `translateX(${LEFT_TRANSLATE_X_DEFAULT}px)`);
          $(rightSidebar).css("transform", `translateX(${RIGHT_TRANSLATE_X_DEFAULT}px)`);
        }
        $(constants$1.WIDTH_SELECTOR).css("max-width", `${width}px`, "!important");
        $('div[role="tablist"]').css("width", `${width}px`);
        $("#statusBar").css("max-width", `${width}px`);
        $('div[style^="position: fixed; inset: 0px 0px 0px 50%;"]').css("width", `${width}px`);
      }
      state.leftSidebarMinimized = false;
      waitForElement(
        constants$1.LEFT_SIDEBAR_SELECTOR,
        (leftSidebar) => {
          state.leftSidebarMinimized = !$(leftSidebar).hasClass("r-y46g1k");
          observeChanges(
            leftSidebar,
            (attributeName, oldValue, newValue, target2) => {
              if ($(leftSidebar).hasClass("r-y46g1k")) {
                state.leftSidebarMinimized = false;
              } else {
                state.leftSidebarMinimized = true;
              }
              console.log(state.leftSidebarMinimized);
            }
          );
        }
        // (leftSidebar) => {
        //     console.log("removed");
        // }
      );
      let resizeTimer;
      function onWindowResize() {
        console.log("Resized to: " + $(window).width() + "x" + $(window).height());
        if (state.mobileView) {
          return;
        } else {
          const leftSidebar = $(constants$1.LEFT_SIDEBAR_SELECTOR);
          const rightSidebar = $(leftSidebar).next();
          const leftSidebarWidth = $(leftSidebar).outerWidth();
          const remainingWidth = $(window).width() - leftSidebarWidth - (!state.leftSidebarMinimized ? $(rightSidebar).outerWidth() : 0) - 10;
          if (remainingWidth >= config.get("postWidthDesktop")) {
            setWidth($(constants$1.LEFT_SIDEBAR_SELECTOR), config.get("postWidthDesktop"));
          } else {
            setWidth($(constants$1.LEFT_SIDEBAR_SELECTOR), remainingWidth);
          }
        }
      }
      $(window).resize(function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(onWindowResize, 500);
      });
      onWindowResize();
      function proxyIntersectionObserver() {
        const OriginalIntersectionObserver = unsafeWindow.IntersectionObserver;
        class ProxyIntersectionObserver {
          constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.enabled = true;
            handlers["feed"].loadOlderItemsCallback = this.callback;
            this.realObserver = new OriginalIntersectionObserver((entries, observer) => {
              const filteredEntries = entries.filter(
                (entry) => !($(entry.target).hasClass("thread") || $(entry.target).hasClass("item") || $(entry.target).find('div[data-testid^="feedItem"]').length || $(entry.target).next()?.attr("style") == "height: 32px;")
              );
              callback(
                filteredEntries,
                observer
              );
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
            return true;
          }
          // Custom override behavior
          overrideBehavior(entries, observer) {
          }
          // Proxy all methods to the real IntersectionObserver
          observe(target2) {
            this.realObserver.observe(target2);
          }
          unobserve(target2) {
            this.realObserver.unobserve(target2);
          }
          disconnect() {
            this.realObserver.disconnect();
          }
          takeRecords() {
            return this.realObserver.takeRecords();
          }
        }
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
      if (typeof GM_config !== "undefined") {
        callback();
      } else {
        console.warn("GM_config not available yet. Retrying...");
        setTimeout(() => waitForGMConfig(callback), 100);
      }
    }
    waitForGMConfig(() => {
      config = new GM_config({
        id: "GM_config",
        title: configTitleDiv,
        fields: CONFIG_FIELDS,
        "events": {
          "init": onConfigInit,
          "save": onConfigSave,
          "close": () => $("#preferencesIconImage").attr("src", handlers["feed"].INDICATOR_IMAGES.preferences[0])
        },
        "css": configCss
      });
    });
    $(document).ready(function(e) {
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        const isUserInitiated = this.dataset.allowPlay === "true";
        if (isUserInitiated || config.get("videoPreviewPlayback") == "Play all") {
          delete this.dataset.allowPlay;
          return originalPlay.apply(this, arguments);
        } else if ($(document.activeElement).is('button[aria-label^="Play"]')) {
          return originalPlay.apply(this, arguments);
        } else {
          return Promise.resolve();
        }
      };
    });
  })();
})();
