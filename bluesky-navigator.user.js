// ==UserScript==
// @name         Bluesky Navigator
// @description  Adds Vim-like navigation, read/unread post-tracking, and other features to Bluesky
// @version      2025-01-21.1
// @author       https://bsky.app/profile/tonyc.org
// @namespace    https://tonyc.org/
// @match        https://bsky.app/*
// @require https://code.jquery.com/jquery-3.7.1.min.js
// @require https://openuserjs.org/src/libs/sizzle/GM_config.js
// @require https://cdn.jsdelivr.net/npm/date-fns@4.1.0/cdn.min.js
// @downloadURL  https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/bluesky-navigator.user.js
// @updateURL    https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/bluesky-navigator.user.js
// @grant GM_info
// @grant GM_setValue
// @grant GM_getValue
// @grant GM.getValue
// @grant GM.setValue
// @grant GM_xmlhttpRequest
// @grant GM.xmlhttpRequest
// ==/UserScript==

const DEFAULT_HISTORY_MAX = 5000;
const DEFAULT_STATE_SAVE_TIMEOUT = 5000;
const URL_MONITOR_INTERVAL = 500;
const STATE_KEY = "bluesky_state";
const LOAD_NEW_BUTTON_SELECTOR = "button[aria-label^='Load new']"
const FEED_ITEM_SELECTOR = 'div:not(.css-175oi2r) > div[tabindex="0"][role="link"]:not(.r-1awozwy)';
const POST_ITEM_SELECTOR = 'div[data-testid^="postThreadItem-by-"]';
const PROFILE_SELECTOR = 'a[aria-label="View profile"]';
const LINK_SELECTOR = 'a[target="_blank"]';
const CLEARSKY_LIST_REFRESH_INTERVAL = 60*60*24;
const CLEARSKY_BLOCKED_ALL_CSS = {"background-color": "#ff8080"};
const CLEARSKY_BLOCKED_RECENT_CSS = {"background-color": "#cc4040"};
const ITEM_SCROLL_MARGIN = 100;

const range = (start, stop, step = 1) =>
  Array.from({ length: Math.ceil((stop - start) / step) }, (_, i) => start + i * step);

let debounceTimeout;

// Debounce function
function debounce(func, delay) {
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), delay);
    };
}

const DEFAULT_STATE = {
    seen: {},
    lastUpdated: null,
    page: "home",
    "blocks": {"all": [], "recent": []},
    feedSortReverse: false,
    feedHideRead: false
};

const CONFIG_FIELDS = {
    'styleSection': {
        'section': [GM_config.create('Display Preferences'), 'Customize how items are displayed'],
        'type': 'hidden',
    },
    'posts': {
        'label': 'All Posts',
        'type': 'textarea',
        'default': 'padding 1px;'
    },
    'unreadPosts': {
        'label': 'Unread Posts',
        'type': 'textarea',
        'default': 'opacity: 100%;'
    },
    'unreadPostsLightMode': {
        'label': 'Unread Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: white;'
    },
    'unreadPostsDarkMode': {
        'label': 'Unread Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: #202020;'
    },
    'readPosts': {
        'label': 'Read Posts',
        'type': 'textarea',
        'default': 'opacity: 75%;'
    },
    'readPostsLightMode': {
        'label': 'Read Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: #f0f0f0;'
    },
    'readPostsDarkMode': {
        'label': 'Read Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: black;'
    },
    'selectionActive': {
        'label': 'Selected Post',
        'type': 'textarea',
        'default': 'border: 3px rgba(255, 0, 0, .3) solid !important;'
    },
    'selectionInactive': {
        'label': 'Unselected Post',
        'type': 'textarea',
        'default': 'border: 3px solid transparent;'
    },
    'threadIndicatorWidth': {
        'label': 'Thread Indicator Width in pixels',
        'type': 'integer',
        'default': '4'
    },
    'threadIndicatorColor': {
        'label': 'Thread Indicator Color',
        'type': 'textarea',
        'default': 'rgb(212, 219, 226)'
    },
    'threadMargin': {
        'label': 'Thread Margin',
        'type': 'textarea',
        'default': '10px'
    },
    'postTimestampFormat': {
        'label': 'Post timestamp format',
        'title': 'A format string specifying how post timestamps are displayed',
        'type': 'textarea',
        'default': "'$age' '('yyyy-MM-dd hh:mmaaa')'"
    },
    'stateSyncSection': {
        'section': [GM_config.create('State Sync'), 'Sync state between different browsers via cloud storage -- see <a href="https://github.com/tonycpsu/bluesky-navigator/blob/main/doc/remote_state.md" target="_blank">here</a> for details.'],
        'type': 'hidden',
    },
    'stateSyncEnabled':  {
        'label': 'Enable State Sync',
        'title': 'If checked, synchronize state to/from the cloud',
        'type': 'checkbox',
        'default': false
    },
    'stateSyncConfig': {
        'label': 'State Sync Configuration (JSON)',
        'title': 'JSON object containing state information',
        'type': 'textarea',
    },
    'stateSyncTimeout': {
        'label': 'State Sync Timeout',
        'title': 'Number of milliseconds of idle time before syncing state',
        'type': 'int',
        'default': 5000
    },
    'miscellaneousSection': {
        'section': [GM_config.create('Miscellaneous'), 'Other settings'],
        'type': 'hidden',
    },
    'markReadOnScroll':  {
        'label': 'Mark Read on Scroll',
        'title': 'If checked, items will be marked read while scrolling',
        'type': 'checkbox',
        'default': false
    },
    'disableLoadMoreOnScroll':  {
        'label': 'Disable Load More on Scroll',
        'title': 'If checked, the default behavior of loading more items when scrolling will be disabled. You can still press "U" to load more manually.',
        'type': 'checkbox',
        'default': false
    },
    'savePostState':  {
        'label': 'Save Post State',
        'title': 'If checked, read/unread state is kept for post items in addition to feed items',
        'type': 'checkbox',
        'default': false
    },
    'stateSaveTimeout': {
        'label': 'State Save Timeout',
        'title': 'Number of milliseconds of idle time before saving state locally',
        'type': 'int',
        'default': 1000
    },
    'historyMax': {
        'label': 'History Max Size',
        'title': 'Maximum number of posts to remember for saving read state',
        'type': 'int',
        'default': DEFAULT_HISTORY_MAX
    },
    'showDebuggingInfo':  {
        'label': 'Enable Debugging',
        'title': 'If checked, some debugging info will be shown in posts',
        'type': 'checkbox',
        'default': false
    },

}

let $ = window.jQuery;
let stateManager;
let config;
let enableLoadMoreItems = false;
let loadMoreItemsCallback;

class StateManager {
    constructor(key, defaultState = {}, maxEntries = DEFAULT_HISTORY_MAX) {
        this.key = key;
        this.listeners = [];
        this.debounceTimeout = null;
        this.maxEntries = maxEntries;
        this.state = {};
        this.isLocalStateDirty = false; // Tracks whether local state has changed
        this.localSaveTimeout = null; // Timer for local state save
        this.remoteSyncTimeout = null; // Timer for remote state sync
        this.handleBlockListResponse = this.handleBlockListResponse.bind(this);
        window.addEventListener("beforeunload", () => this.saveStateImmediately());
    }

    static async create(key, defaultState = {}, maxEntries = DEFAULT_HISTORY_MAX) {
        const instance = new StateManager(key, defaultState, maxEntries);
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
                recent: { updated: null, handles: [] },
            };
        }
    }

    setSyncStatus(status, title) {
        const overlay = $(".preferences-icon-overlay")
        if(!overlay) {
            console.log("no overlay")
            return
        }
        $(overlay).attr("title", `sync: ${status} ${title || ''}`)
        for (const s of ["ready", "pending", "success", "failure"]) {
            $(overlay).removeClass(`preferences-icon-overlay-sync-${s}`)
        }

        $(overlay).addClass(`preferences-icon-overlay-sync-${status}`)
        if (status == "success") {
            setTimeout( () => this.setSyncStatus("ready"), 3000);
        }
    }

    /**
     * Executes a query against the remote database.
     * @param {string} query - The query string to execute.
     * @param {string} successStatus - The status to set on successful execution (e.g., "success").
     * @returns {Promise<Object>} - Resolves with the parsed result of the query.
     */
    async executeRemoteQuery(query, successStatus = "success") {
        const { url, namespace = "bluesky_navigator", database = "state", username, password } = JSON.parse(config.get("stateSyncConfig"));

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
        const sinceResult = await this.executeRemoteQuery(`SELECT lastUpdated FROM state:current;`)
        const lastUpdated = sinceResult["lastUpdated"]
        return sinceResult["lastUpdated"]
    }

    /**
     * Loads state from storage or initializes with the default state.
     */
    async loadState(defaultState) {
        try {
            const savedState = JSON.parse(GM_getValue(this.key, "{}"));

            if (config.get("stateSyncEnabled")) {
                const remoteState = await this.loadRemoteState(this.state.lastUpdated);
                console.dir(remoteState);
                return remoteState ? { ...defaultState, ...remoteState } :  { ...defaultState, ...savedState };
            } else {
                return { ...defaultState, ...savedState };
            }

        } catch (error) {
            console.error("Error loading state, using defaults:", error);
            return defaultState;
        }
    }

    async loadRemoteState(since) {
        // const query = `SELECT * FROM state:current;`;

        try {
            console.log("Loading remote state...");
            this.setSyncStatus("pending");
            const lastUpdated = await this.getRemoteStateUpdated()
            if (!since || !lastUpdated || new Date(since) < new Date(lastUpdated) ) {
                console.log(`Remote state is newer: ${since} < ${lastUpdated}`);
                const result = await this.executeRemoteQuery('SELECT * FROM state:current;');
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
        this.state.lastUpdated = new Date().toISOString();
        this.isLocalStateDirty = true; // Mark local state as dirty
        this.scheduleLocalSave(); // Schedule local save
    }

    /**
     * Schedules a local state save after a 1-second delay.
     * Triggers remote sync only if local state is saved.
     */
    scheduleLocalSave() {
        clearTimeout(this.localSaveTimeout);
        this.localSaveTimeout = setTimeout(() => {
            const shouldSyncRemote = this.isLocalStateDirty; // Capture the current state of the flag
            this.saveLocalState().then(() => {
                if (shouldSyncRemote) { // Use the captured flag to decide if remote sync is needed
                    this.scheduleRemoteSync();
                }
            });
        }, config.get("stateSaveTimeout")); // Save local state after 1 second
    }

    /**
     * Saves the local state and resolves a promise.
     * @returns {Promise<void>}
     */
    async saveLocalState() {
        console.log("Saving local state...");
        this.cleanupState(); // Ensure state is pruned before saving
        GM_setValue(this.key, JSON.stringify(this.state));
        console.log("Local state saved.");
        this.isLocalStateDirty = false; // Reset dirty flag
        this.notifyListeners();
    }

    /**
     * Schedules a remote state synchronization after a longer delay.
     */
    scheduleRemoteSync() {
        if (!config.get("stateSyncEnabled")) {
            console.log("sync disabled")
            return;
        }

        clearTimeout(this.remoteSyncTimeout);
        this.remoteSyncTimeout = setTimeout(() => {
            this.saveRemoteState(this.state.lastUpdated);
        }, config.get("stateSyncTimeout")); // Default to 5 seconds delay
    }

    /**
     * Saves the remote state if needed.
     */
    async saveRemoteState(since) {
        const { url, namespace = "bluesky_navigator", database = "state", username, password } =
            JSON.parse(config.get("stateSyncConfig"));

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
        if (saveRemote) {
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

        // Sort the entries by value (date) in descending order
        entries.sort(([, dateA], [, dateB]) => new Date(dateB) - new Date(dateA));

        // Keep only the most recent N entries
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
        this.listeners.forEach(callback => callback(this.state));
    }

    handleBlockListResponse(response, responseKey, stateKey) {
        // console.dir(responseKey, stateKey)
        var jsonResponse = $.parseJSON(response.response)
        // console.dir(jsonResponse.data)

        try {
            this.state.blocks[stateKey].handles = jsonResponse.data[responseKey].map(
                (entry) => entry.Handle
            )
            this.state.blocks[stateKey].updated = Date.now()
        } catch (error) {
            console.warn("couldn't fetch block list")
        }
    }

    updateBlockList() {
        // console.log("updateBlockList")
        const blockConfig = {
            all: {
                url: "https://api.clearsky.services/api/v1/anon/lists/fun-facts",
                responseKey: "blocked",
            },
            recent: {
                url: "https://api.clearsky.services/api/v1/anon/lists/funer-facts",
                responseKey: "blocked24",
            },
        }

        for (const [stateKey, cfg] of Object.entries(blockConfig) ) {
            // console.log(stateKey, cfg)
            if (
                this.state.blocks[stateKey].updated == null
                    ||
                Date.now() + CLEARSKY_LIST_REFRESH_INTERVAL > this.state.blocks[stateKey].updated
            ) {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: cfg.url,
                    headers: {
                        Accept: "application/json",
                    },
                    onload: (response) => this.handleBlockListResponse(response, cfg.responseKey, stateKey),
                });
            }

        }

    }
}

function waitForElement(selector, onAdd, onRemove) {
    // Immediately handle any existing elements
    const processExistingElements = () => {
        const elements = $(selector);
        if (elements.length) {
            elements.each((_, el) => onAdd($(el)));
        }
    };

    // Process current elements once
    processExistingElements();

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            // Handle added nodes
            $(mutation.addedNodes)
                .find(selector)
                .addBack(selector)
                .each((_, el) => onAdd($(el)));

            if (onRemove) {
                // Handle removed nodes
                $(mutation.removedNodes)
                    .find(selector)
                    .addBack(selector)
                    .each((_, el) => onRemove($(el)));
            }
        });
    });

    // Start observing the document body for changes
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
}



function observeChanges(target, callback) {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === "attributes") {
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
        attributes: true, // Observe attribute changes
        attributeOldValue: true, // Capture old values of attributes
        subtree: true, // Observe changes in child elements as well
    });

    return observer;
}


function onVisibilityChange(selector, callback) {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // console.log(`mutation: ${mutation}`)
            if (mutation.type === "attributes") {
                const target = mutation.target;
                const isVisible = $(target).is(":visible");
                callback($(target), isVisible);
            }
        });
    });

    $(selector).each((_, el) => {
        // console.log(`observe: ${el}`)
        observer.observe(el, {
            attributes: true, // Observe attribute changes
            attributeFilter: ["style", "class"], // Filter for relevant attributes
            subtree: false // Do not observe children
        });
    });

    return observer;
}


function observeVisibilityChange($element, callback) {
    const target = $element[0]; // Get the DOM element from the jQuery object

    const observer = new MutationObserver(() => {
        // Check visibility using jQuery
        const isVisible = $element.is(":visible");
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

class Handler {

    constructor(name) {
        //console.log(name)
        this.name = name
        this.items = []
        this.handleInput = this.handleInput.bind(this)
    }

    activate() {
        this.bindKeys()
    }

    deactivate() {
        this.unbindKeys()
    }

    isActive() {
        return true;
    }

    bindKeys() {
        //console.log(`${this.name}: bind`)
        document.addEventListener('keydown', this.handleInput, true)
    }

    unbindKeys() {
        //console.log(`${this.name}: unbind`)
        document.removeEventListener('keydown', this.handleInput, true)
    }

    handleInput(event) {
        //console.log(`handleInput: ${this}, ${this.name}: ${event}`)
        //console.dir(event)
        if (event.altKey && !event.metaKey) {
            if (event.code === "KeyH") {
                $("a[aria-label='Home']")[0].click()
            }
            else if (event.code === "KeyS") {
                $("a[aria-label='Search']")[0].click()
            }
            else if (event.code === "KeyN") {
                $("a[aria-label='Notifications']")[0].click()
            }
            else if (event.code === "KeyM") {
                $("a[aria-label='Chat']")[0].click()
            }
            else if (event.code === "KeyF") {
                $("a[aria-label='Feeds']")[0].click()
            }
            else if (event.code === "KeyL") {
                $("a[aria-label='Lists']")[0].click()
            }
            else if (event.code === "KeyP") {
                $("a[aria-label='Profile']")[0].click()
            }
            else if (event.code === "Comma") {
                $("a[aria-label='Settings']")[0].click()
            }
            else if (event.code === "Period") {
                config.open()
            }
        }
    }
}

class ItemHandler extends Handler {

    // POPUP_MENU_SELECTOR = "div[data-radix-popper-content-wrapper]"
    POPUP_MENU_SELECTOR = "div[aria-label^='Context menu backdrop']"

    // FIXME: this belongs in PostItemHandler
    THREAD_PAGE_SELECTOR = "main > div > div > div"

    MOUSE_MOVEMENT_THRESHOLD = 10

    constructor(name, selector) {
        super(name)
        this._index = null;
        this.postId = null;
        this.loadNewCallback = null;
        this.selector = selector
        this.debounceTimeout = null
        this.lastMousePosition = null
        this.isPopupVisible = false
        this.ignoreMouseMovement = false
        this.onPopupAdd = this.onPopupAdd.bind(this)
        this.onPopupRemove = this.onPopupRemove.bind(this)
        this.onIntersection = this.onIntersection.bind(this)
        this.onFooterIntersection = this.onFooterIntersection.bind(this)
        this.onItemAdded = this.onItemAdded.bind(this)
        this.handleNewThreadPage = this.handleNewThreadPage.bind(this) // FIXME: move to PostItemHandler
        this.onItemMouseOver = this.onItemMouseOver.bind(this)
        this.didMouseMove = this.didMouseMove.bind(this)
        this.loading = false;
        this.loadingNew = false;
        this.handlingClick = false;
        this.visibleItems = new Set();

    }

    isActive() {
        return false
    }

    activate() {
        this.keyState = []
        this.popupObserver = waitForElement(this.POPUP_MENU_SELECTOR, this.onPopupAdd, this.onPopupRemove);
        this.intersectionObserver = new IntersectionObserver(this.onIntersection, {
            root: null, // Observing within the viewport
            rootMargin: `-${ITEM_SCROLL_MARGIN}px 0px 0px 0px`,
            threshold: 1.0
        });

        this.footerIntersectionObserver = new IntersectionObserver(this.onFooterIntersection, {
            root: null, // Observing within the viewport
            // threshold: [1]
            threshold: Array.from({ length: 101 }, (_, i) => i / 100)
        });

        const safeSelector = `${this.selector}:not(.thread ${this.selector})`
        this.observer = waitForElement(safeSelector, (element) => {
            this.onItemAdded(element),
            this.onItemRemoved(element)
        });

        this.loadNewObserver = waitForElement(LOAD_NEW_BUTTON_SELECTOR, (button) => {
            this.loadNewButton = button[0];
            this.loadNewButton.addEventListener(
                "click",
                (event) => {
                    if (this.loadingNew) {
                        console.log("handling click, returning")
                        return; // Avoid re-entry
                    }

                    console.log("Intercepted click in capture phase", event.target);
                    const listeners = getEventListeners(event.target);
                    // Save the target and event details for later
                    const target = event.target;
                    // const originalHandler = target.onclick;

                    // Stop propagation but allow calling the original logic manually
                    event.stopImmediatePropagation();

                    // // Call the application's original handler if necessary
                    setTimeout(() => {
                        console.log("Calling original handler");
                        this.loadNewItems();
                    }, 0);

                    // Add custom logic
                    console.log("Custom logic executed");
                },
                true // Capture phase
            );
        });


        // this.loadNewObserver = waitForElement(LOAD_NEW_BUTTON_SELECTOR, (button) => {
        //     this.loadNewButton = button[0];

        //     // Get the original onclick handler
        //     const originalHandler = this.loadNewButton.onclick;
        //     // Override the onclick property
        //     this.loadNewButton.onclick = (event) => {
        //         event.preventDefault();
        //         event.stopPropagation();

        //         console.log("Click intercepted");
        //         console.log("Original handler:", originalHandler);
        //         console.log("Original handler context (this):", this.loadNewButton);
        //         // Call the original handler if it exists
        //         if (originalHandler) {
        //             originalHandler.call(this.loadNewButton, event);
        //         }

        //         // Add your custom logic here
        //     };

        // });

        super.activate()
    }

    deactivate() {
        if(this.observer)
        {
            this.observer.disconnect()
        }
        if(this.popupObserver)
        {
            this.popupObserver.disconnect()
        }
        if(this.intersectionObserver)
        {
            this.intersectionObserver.disconnect()
        }
        if(this.footerIntersectionObserver)
        {
            this.footerIntersectionObserver.disconnect()
        }

        $(this.selector).off("mouseover mouseleave");
        super.deactivate()
    }

    get index() {
        return this._index
    }

    set index(value) {
        this._index = value
        this.postId = this.postIdForItem(this.items[this.index]);
        this.updateInfoIndicator();
    }

    onItemAdded(element) {

        // console.log(element)

        this.applyItemStyle(element)

        // $(element).on("mouseleave", this.onItemMouseLeave)

        clearTimeout(this.debounceTimeout)

        this.debounceTimeout = setTimeout(() => {
            this.loadItems()
        }, 500)
    }

    onItemRemoved(element) {
        this.intersectionObserver.disconnect(element)
    }


    onIntersection(entries) {

        if(this.loading || this.loadingNew) {
            return;
        }
        let focusedElement = null;

        entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio === 1) {
                this.visibleItems.add(entry.target);
            } else {
                this.visibleItems.delete(entry.target);
            }
        });

        const visibleItems = Array.from(this.visibleItems).sort(
            (a, b) =>  a.getBoundingClientRect().top - b.getBoundingClientRect().top
        )

        if (! visibleItems.length || !this.lastMousePosition) {
            return;
        }
        const target = visibleItems[0]

        if (target) {
            var index = this.getIndexFromItem(target);
            if (config.get("markReadOnScroll")) {
                this.markItemRead(index, true);
            }
            this.setIndex(index);
        }
    }

    onFooterIntersection(entries) {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                console.log("footer")
                const target = entry.target;
                this.setIndex(this.getIndexFromItem(target))
                // this.index = this.getIndexFromItem(target)
                this.loadMoreItems();
            }
        });
    }

    onPopupAdd() {
        this.isPopupVisible = true;
    }

    onPopupRemove() {
        this.isPopupVisible = false;
    }

    applyItemStyle(element, selected) {
        //console.log(`applyItemStyle: ${$(element).parent().parent().index()-1}, ${this.index}`)

        $(element).addClass("item")

        const postTimestampElement = $(element).find('a[href^="/profile/"][data-tooltip*=" at "]').first()
        if (!postTimestampElement.attr("data-bsky-navigator-age")) {
            postTimestampElement.attr("data-bsky-navigator-age", postTimestampElement.text())
        }
        const userFormat = config.get("postTimestampFormat");
        const postTimeString = postTimestampElement.attr("aria-label")
        if (postTimeString && userFormat) {
            // console.log(postTimeString)
            const postTimestamp = new Date(postTimeString.replace(' at', ''));
            const formattedDate = dateFns.format(postTimestamp, userFormat).replace("$age", postTimestampElement.attr("data-bsky-navigator-age"));
            if (config.get("showDebuggingInfo")) {
                postTimestampElement.text(`${formattedDate} (${$(element).parent().parent().attr("data-bsky-navigator-thread-index")}, ${$(element).attr("data-bsky-navigator-item-index")})`);
            } else {
                postTimestampElement.text(formattedDate);
            }
        }

        // FIXME: This method of finding threads is likely to be unstable.
        const threadIndicator = $(element).find("div.r-lchren, div.r-1mhb1uw > svg")
        const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]')

        $(element).parent().parent().addClass("thread")

        if (selected) {
            $(element).parent().parent().addClass("thread-selection-active")
            $(element).parent().parent().removeClass("thread-selection-inactive")
        } else {
            $(element).parent().parent().removeClass("thread-selection-active")
            $(element).parent().parent().addClass("thread-selection-inactive")
        }

        if (threadIndicator.length) {
            var parent = threadIndicator.parents().has(avatarDiv).first();
            var children = parent.find("*");
            if (threadIndicator.length == 1) {
                var parent = threadIndicator.parents().has(avatarDiv).first();
                var children = parent.find("*");
                // console.log(element, children.index(threadIndicator), children.index(avatarDiv))
                // first and last posts have 1 indicator, middle posts have 2
                if (children.index(threadIndicator) < children.index(avatarDiv)) {
                    $(element).parent().parent().addClass("thread-last")
                } else {
                    $(element).parent().parent().addClass("thread-first")
                }
            } else {
                $(element).parent().parent().addClass("thread-middle")
            }

            // console.log(element, threadIndicator.css("flex-grow"), threadIndicator.css("margin-top"), threadIndicator.css("margin-bottom"))
        } else {
            $(element).parent().parent().addClass(["thread-first", "thread-middle", "thread-last"])
        }

        if (selected)
        {
            // $(element).parent().parent().addClass("thread-selection-active")
            // $(element).parent().parent().removeClass("thread-selection-inactive")
            $(element).addClass("item-selection-active")
            $(element).removeClass("item-selection-inactive")
            // $(element).css(SELECTED_POST_CSS)
        }
        else
        {
            // $(element).parent().parent().removeClass("thread-selection-active")
            // $(element).parent().parent().addClass("thread-selection-inactive")
            $(element).removeClass("item-selection-active")
            $(element).addClass("item-selection-inactive")
//            $(element).css(ITEM_CSS)
        }

        var postId = this.postIdForItem($(element))
        //console.log(`postId: ${postId}`)
        if (postId != null && stateManager.state.seen[postId])
        {
            $(element).addClass("item-read")
            $(element).removeClass("item-unread")
        }
        else
        {
            $(element).addClass("item-unread")
            $(element).removeClass("item-read")
        }
        const handle = this.handleFromItem(element);
        // console.log(handle)
        if (stateManager.state.blocks.all.includes(handle)) {
            $(element).find(PROFILE_SELECTOR).css(CLEARSKY_BLOCKED_ALL_CSS)
        }
        if (stateManager.state.blocks.recent.includes(handle)) {
            $(element).find(PROFILE_SELECTOR).css(CLEARSKY_BLOCKED_RECENT_CSS)
        }
    }

    didMouseMove(event) {
        const currentPosition = { x: event.pageX, y: event.pageY };

        if (this.lastMousePosition) {
            // Calculate the distance moved
            const distanceMoved = Math.sqrt(
                Math.pow(currentPosition.x - this.lastMousePosition.x, 2) +
                    Math.pow(currentPosition.y - this.lastMousePosition.y, 2)
            );
            this.lastMousePosition = currentPosition;

            if (distanceMoved >= this.MOUSE_MOVEMENT_THRESHOLD) {
                return true
            }
        } else {
            // Set the initial mouse position
            this.lastMousePosition = currentPosition;
        }
        return false
    }

    onItemMouseOver(event) {
        var target = $(event.target).closest(this.selector)
        if (this.ignoreMouseMovement || ! this.didMouseMove(event)) {
            return
        }
        this.setIndex(this.getIndexFromItem(target))
        // this.applyItemStyle(this.items[this.index], false)
        // this.index = this.getIndexFromItem(target)
        // console.log(this.index)
        // this.applyItemStyle(this.items[this.index], true)
    }


    handleInput(event) {
        if (this.handleMovementKey(event)) {
            return event.key
        } else if (this.handleItemKey(event)) {
            return event.key
        } else if (event.key == "U") {
            console.log("Update")
            this.loadMoreItems();
        } else {
            return super.handleInput(event)
        }
    }

    filterItems() {
        return;
    }

    sortItems() {
        return;
    }

    loadItems(focusedPostId) {
        var old_length = this.items.length
        var old_index = this.index

        const classes = ["thread-first", "thread-middle", "thread-last"];
        let set = [];

        // this.deactivate()
        // $(this.items).css("opacity", "0%")
        // const newItems = $(this.selector).not("div[data-bsky-navigator-item-index]")
        // console.log(newItems.length)
        // const newItemsOrig = newItems.get()
        let itemIndex = 0;
        let threadIndex = 0;

        $(this.selector).filter(":visible").each(function (i, item) {
            $(item).attr("data-bsky-navigator-item-index", itemIndex++);
            // $(item).attr("data-bsky-navigator-item-index", stateManager.state.feedSortReverse ? itemIndex++: itemIndex--);
            $(item).parent().parent().attr("data-bsky-navigator-thread-index", threadIndex);

            const threadDiv = $(item).parent().parent()
            // Check if the div contains any of the target classes
            if (classes.some(cls => $(threadDiv).hasClass(cls))) {
                set.push(threadDiv[0]); // Collect the div
                if ($(threadDiv).hasClass("thread-last")) {
                    threadIndex++;
                    // stateManager.state.feedSortReverse ? threadIndex++ : threadIndex--;
                }
            }
        });

        this.sortItems();
        this.filterItems();

        this.items = $(this.selector).filter(":visible")

        $(this.items).each(
            (i, item) => {
                this.intersectionObserver.observe($(item)[0]);
            }
        )

        // this.activate()
        if(!config.get("disableLoadMoreOnScroll")){
            if(!stateManager.state.feedSortReverse && this.items.length > 0) {
                this.footerIntersectionObserver.observe(this.items.slice(-1)[0]);
            }
        }

        // console.log(this.items)
        this.applyItemStyle(this.items[this.index], true)
        $("div.r-1mhb1uw").each(
            (i, el) => {
                const ancestor = $(el).parent().parent().parent().parent()
                // $(ancestor).addClass(["thread"])
                $(el).parent().parent().parent().addClass("item-selection-inactive")
                if($(ancestor).prev().find("div.item-unread").length) {
                    $(el).parent().parent().parent().addClass("item-unread")
                    $(el).parent().parent().parent().removeClass("item-read")
                } else {
                    $(el).parent().parent().parent().addClass("item-read")
                    $(el).parent().parent().parent().removeClass("item-unread")
                }
            }
        )
        $("div.r-1mhb1uw svg").each(
            (i, el) => {
                $(el).find("line").attr("stroke", config.get("threadIndicatorColor"))
                $(el).find("circle").attr("fill", config.get("threadIndicatorColor"))
            }
        )
        $(this.selector).on("mouseover", this.onItemMouseOver)

        $(this.selector).closest("div.thread").addClass("bsky-navigator-seen")
        // console.log("set loading false")
        $(this.selector).closest("div.thread").removeClass(["loading-indicator-reverse", "loading-indicator-forward"]);
        this.loading = false;
        // $(this.items).css("opacity", "100%")
        if(focusedPostId) {
            this.jumpToPost(focusedPostId);
        } else if (!this.jumpToPost(this.postId)) {
            this.setIndex(0);
        }
        this.updateInfoIndicator();
        // else if (this.index == null) {
        //     this.setIndex(0);
        // }
        // this.updateItems();
    }

    updateInfoIndicator() {
        const count = this.items.length
        const unreadCount = this.items.filter(
            (i, item) => $(item).hasClass("item-unread")
        ).length;
        const index = count ? this.index+1 : 0;
        $("span#infoIndicatorText").html(`<strong>${index}</strong>/<strong>${count}</strong> (<strong>${unreadCount}</strong> new)`);
    }

    loadNewItems() {
        if(!this.loadNewButton) {
            console.log("no button")
            return;
        }
        this.loadingNew = true;
        this.applyItemStyle(this.items[this.index], false)
        // // this.setIndex(0)
        // //this.updateItems()
        // $(document).find(LOAD_NEW_BUTTON_SELECTOR).click()
        let oldPostId = this.postIdForItem(this.items[this.index])
        $(this.loadNewButton).click()
        setTimeout( () => {
            this.loadItems(oldPostId);
            // if (!this.jumpToPost(oldPostId)) {
            //     console.log("set 0");
            //     this.setIndex(0);
            // }
            this.loadingNew = false;
        }, 1000)
    }

    loadMoreItems() {
        if(this.loading) {
            // console.log("already loading, returning")
            return;
        }
        this.loading = true;
        const reversed = stateManager.state.feedSortReverse;
        const index = reversed ? 0 : this.items.length-1;
        this.setIndex(index);
        this.updateItems();
        var indicatorElement = (
            this.items.length
                ? this.items[index]
            : $(this.selector).eq(index)[0]
        );
        var loadElement = this.items.length ? this.items[this.items.length-1] : $(this.selector).first()[0];
        $(indicatorElement).closest("div.thread").addClass(stateManager.state.feedSortReverse ? "loading-indicator-forward" : "loading-indicator-reverse");
        loadMoreItemsCallback(
            [
                {
                    time: performance.now(),
                    target: loadElement,
                    isIntersecting: true,
                    intersectionRatio: 1,
                    boundingClientRect: loadElement.getBoundingClientRect(),
                    intersectionRect: loadElement.getBoundingClientRect(),
                    rootBounds: document.documentElement.getBoundingClientRect(),
                }
            ]
        )
    }

    postIdFromUrl() {
        //return $(document).find("meta[property='og:url']").attr("content").split("/")[6]
        return window.location.href.split("/")[6]
    }

    postIdForItem(item) {
        try {
            return $(item).find("a[href*='/post/']").attr("href").split("/")[4]
        } catch (e) {
            // debugger;
            return this.postIdFromUrl()
        }
    }

    handleFromItem(item) {
        return $.trim($(item).find(PROFILE_SELECTOR).find("span").eq(1).text().replace(/[\u200E\u200F\u202A-\u202E]/g, "")).slice(1)
    }

    displayNameFromItem(item) {
        return $.trim($(item).find(PROFILE_SELECTOR).find("span").eq(0).text().replace(/[\u200E\u200F\u202A-\u202E]/g, ""))
    }

    updateItems() {

        if (this.index == 0)
        {
            window.scrollTo(0, 0)
        } else if (this.items[this.index]) {
            $(this.items[this.index])[0].scrollIntoView()
        } else {
            // console.log(this.index, this.items.length)
        }

    }

    setIndex(index) {
        let oldIndex = this.index
        this.applyItemStyle(this.items[oldIndex], false)
        this.index = index
        this.applyItemStyle(this.items[this.index], true)
        // this.updateItems();
    }

    jumpToPost(postId) {
        // debugger;
        for (const [i, item] of $(this.items).get().entries()) {
            const other = this.postIdForItem(item);
            if (postId == other)
            {
                // console.log(`jumping to ${postId} (${i})`);
                this.setIndex(i);
                this.updateItems();
                return true;
            }
        }
        return false;
    }


    markItemRead(index, isRead) {
        if (this.name == "post" && !config.get("savePostState")){
            return
        }
        let postId = this.postIdForItem(this.items[index])
        if (!postId) {
            return
        }
        this.markPostRead(postId, isRead)
        this.applyItemStyle(this.items[index], index == this.index)
        this.updateInfoIndicator();
    }

    markPostRead(postId, isRead) {

        const currentTime = new Date().toISOString();
        const seen = { ...stateManager.state.seen };

        if (isRead || (isRead == null && !seen[postId]) ) {
            seen[postId] = currentTime;
        } else {
            seen[postId] = null;
            // delete seen[postId];
        }
        stateManager.updateState({ seen, lastUpdated: currentTime });
        // this.updateItems()
    }

    markVisibleRead() {
        $(this.items).each(
            (i, item) => {
                this.markItemRead(i, true);
            }
        )
    }


    // FIXME: move to PostItemHanler
    handleNewThreadPage(element) {
        console.log(`new page: ${element}`)
        console.log(this.items.length)
        this.loadPageObserver.disconnect()
    }

    handleMovementKey(event) {
        var moved = false
        var mark = false
        var old_index = this.index
        if (this.isPopupVisible) {
            return
        }
        // mouse movement may be triggered, so ignore it
        this.ignoreMouseMovement = true

        if (this.keyState.length == 0) {
            if (["j", "k", "ArrowDown", "ArrowUp", "J", "G"].includes(event.key))
            {
                if (["j", "ArrowDown"].indexOf(event.key) != -1) {
                    event.preventDefault()
                    if (this.index < this.items.length - 1) {
                        // this.index += 1
                        this.setIndex(this.index + 1)
                    } else {
                        var next = $(this.items[this.index]).parent().parent().parent().next()
                        // console.log(next.text())
                        if (next && $.trim(next.text()) == "Continue thread...") {
                            console.log("click")
                            this.loadPageObserver = waitForElement(
                                this.THREAD_PAGE_SELECTOR,
                                this.handleNewThreadPage
                            );
                            console.log(this.loadPageObserver)
                            $(next).find("div").click()
                        }
                    }
                    mark = event.key == "j"
                }
                else if (["k", "ArrowUp"].indexOf(event.key) != -1) {
                    event.preventDefault()
                    if (this.index > 0)
                    {
                        this.setIndex(this.index - 1)
                    }
                    mark = event.key == "k"
                }
                else if (event.key == "G") {
                    // G = end
                    this.setIndex(this.items.length-1)
                } else if (event.key == "J") {
                    this.jumpToNextUnseenItem();
                    mark = true
                }
                moved = true
                console.log(this.postIdForItem(this.items[this.index]))
            } else if (event.key == "g") {
                this.keyState.push(event.key)
            }
        } else if (this.keyState[0] == "g") {
            if (event.key == "g") {
                // gg = home
                if (this.index < this.items.length)
                {
                    this.setIndex(0)
                }
                moved = true
            }
            this.keyState = []
        }
        if (moved)
        {
            if (mark)
            {
                this.markItemRead(old_index, true)
            }
            this.applyItemStyle(this.items[old_index], false)
            this.applyItemStyle(this.items[this.index], true)
            this.updateItems()
            // to avoid mouseover getting triggered by keyboard movement
            this.lastMousePosition = null
            this.ignoreMouseMovement = false
            return event.key
        } else {
            this.ignoreMouseMovement = false
            return null
        }
    }

    jumpToNextUnseenItem() {
        var i
        for (i = this.index+1; i < this.items.length-1; i++)
        {
            //var item = this.items[i]
            var postId = this.postIdForItem(this.items[i])
            if (! stateManager.state.seen[postId]) {
                break;
            }
        }
        this.setIndex(i)
        this.updateItems();
    }

    getIndexFromItem(item) {
        return $(".item").filter(":visible").index(item)
        //return $(item).parent().parent().index()-1
    }

    handleItemKey(event) {
        if(this.isPopupVisible || event.altKey || event.metaKey) {
            return
        }

        // console.log(event.key)
        var item = this.items[this.index]
        //if(event.key == "o")
        if (["o", "Enter"].includes(event.key))
        {
            // o = open
            $(item).click()
            //bindKeys(post_key_event)
        }
        else if(event.key == "O")
        {
            // O = open inner post
            var inner = $(item).find("div[aria-label^='Post by']")
            inner.click()
        }
        else if(event.key == "i")
        {
            // i = open link
            if($(item).find(LINK_SELECTOR).length)
            {
                $(item).find(LINK_SELECTOR)[0].click()
            }
        }
        else if(event.key == "m")
        {
            // m = media?
            var media = $(item).find("img[src*='feed_thumbnail']")
            if (media.length > 0)
            {
                media[0].click()
            }
        } else if(event.key == "r") {
            // r = reply
            var button = $(item).find("button[aria-label^='Reply']")
            button.focus()
            button.click()
        } else if(event.key == "l") {
            // l = like
            $(item).find("button[data-testid='likeBtn']").click()
        } else if(event.key == "p") {
            // p = repost menu
            $(item).find("button[aria-label^='Repost']").click()
        } else if(event.key == "P") {
            // P = repost
            $(item).find("button[aria-label^='Repost']").click()
            setTimeout(function() {
                $("div[aria-label^='Repost'][role='menuitem']").click()
            }, 1000)
        } else if (event.key == ".") {
            // toggle read/unread
            this.markItemRead(this.index, null)
        } else if (event.key == "A") {
            // mark all visible items read
            this.markVisibleRead();
        } else if(event.key == "h") {
            // h = back?
            //data-testid="profileHeaderBackBtn"
            var back_button = $("button[aria-label^='Back' i]").filter(":visible")
            if (back_button.length) {
                back_button.click()
            } else {
                history.back(1)
            }
        } else if(!isNaN(parseInt(event.key))) {
            $("div[role='tablist'] > div > div > div").filter(":visible")[parseInt(event.key)-1].click()
        } else {
            return false
        }
        return event.key
    }
}

class FeedItemHandler extends ItemHandler {

    INDICATOR_IMAGES = {
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
    }

    constructor(name, selector) {
        super(name, selector)
        this.toggleSortOrder = this.toggleSortOrder.bind(this)
    }

    activate() {
        super.activate()

        waitForElement('div[data-testid="HomeScreen"] > div > div > div:first', (indicatorContainer) => {

            this.indicatorContainer = indicatorContainer;
            if (!this.toolbarDiv) {
                const logoDiv = $(this.indicatorContainer).find('div[style^="flex: 1 1 0%;"]')
                this.toolbarDiv = $(`<div id="bsky-navigator-toolbar"/>`);
                // $(this.indicatorContainer).parent().append(this.toolbarDiv);
                // $('div[data-testid="homeScreenFeedTabs"]').parent().prepend(this.toolbarDiv);
                console.log($(logoDiv).parent());
                if($(logoDiv).parent().attr("style").includes("width: 100%")) {
                    $(logoDiv).parent().after(this.toolbarDiv);
                } else {
                    $('div[data-testid="homeScreenFeedTabs"]').parent().prepend(this.toolbarDiv);
                }
            }

            if (!this.infoIndicator) {
                this.infoIndicator = $(`<div id="infoIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb r-5t7p9m"><span id="infoIndicatorText"/></div>`);
                $(this.toolbarDiv).append(this.infoIndicator);
            }

            if (!this.sortIndicator) {
                this.sortIndicator = $(`<div id="sortIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb r-5t7p9m"><img id="sortIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.sort[0]}"/></div>`);
                $(this.toolbarDiv).append(this.sortIndicator);
                // add dummy button space to keep bsky logo centered
                // this.indicatorContainer.children().eq(-1).before(`<div class="toolbar-icon"/>`)
                $('#sortIndicator').on("click", (event) => {
                    event.preventDefault();
                    this.toggleSortOrder();
                });
            }

            if (!this.filterIndicator) {
                this.filterIndicator = $(`<div id="filterIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb r-5t7p9m"><img id="filterIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.filter[0]}"/></div>`);
                $(this.toolbarDiv).append(this.filterIndicator);
                // add dummy button space to keep bsky logo centered
                // this.indicatorContainer.children().eq(-1).before(`<div class="toolbar-icon"/>`)
                $('#filterIndicator').on("click", (event) => {
                    event.preventDefault();
                    this.toggleHideRead();
                });
            }

            if (!this.searchField) {
                this.searchField = $(`<input id="bsky-navigator-search" type="text"/>`);
                $(this.toolbarDiv).append(this.searchField);
                this.onSearchUpdate = debounce(function (event) {
                    console.log($(event.target).val());
                    this.setFilter($(event.target).val());
                    this.filterItems();
                }, 300);
                this.onSearchUpdate = this.onSearchUpdate.bind(this)
                $(this.searchField).on("input", this.onSearchUpdate);
            }

            if (!this.preferencesIcon) {
                this.preferencesIcon = $(`<div id="preferencesIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb r-5t7p9m"><div id="preferencesIcon"><img id="preferencesIconImage" class="indicator-image preferences-icon-overlay" src="${this.INDICATOR_IMAGES.preferences[0]}"/></div></div>`);
  //               this.preferencesIcon = $(`
  //   <div id="preferences-icon" class="toolbar-icon preferences-icon-overlay">
  //     <span>⚪️</span>
  //   </div>
  // `);
                $(this.preferencesIcon).on("click", () => {
                    $("#preferencesIconImage").attr("src", this.INDICATOR_IMAGES.preferences[1])
                    config.open()
                });
                $(this.toolbarDiv).append(this.preferencesIcon);
            }

        })
    }

    deactivate() {
        super.deactivate()
    }

    isActive() {
        return window.location.pathname == "/"
    }

    toggleSortOrder() {
        stateManager.updateState({feedSortReverse: !stateManager.state.feedSortReverse})
        $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen")
        this.loadItems();
    }

    toggleHideRead() {
        stateManager.updateState({feedHideRead: !stateManager.state.feedHideRead})
        $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen")
        this.loadItems();
    }

    setFilter(text) {
        this.filter = text;
    }

    filterItem(item) {
        if(stateManager.state.feedHideRead) {
            if($(item).hasClass("item-read")) {
                return false;
            }
        }
        if (this.filter) {
            const pattern = new RegExp(this.filter, "i");
            const handle = this.handleFromItem(item);
            const displayName = this.displayNameFromItem(item);
            if (!handle.match(pattern) && !displayName.match(pattern)) {
                return false;
            }
        }
        return true;
    }

    filterThread(thread) {
        return ($(thread).find(".item").length != $(thread).find(".filtered").length);
    }

    filterItems() {
        const hideRead = stateManager.state.feedHideRead;
        $("#filterIndicatorImage").attr("src", this.INDICATOR_IMAGES.filter[+hideRead])

        const parent = $(this.selector).first().closest(".thread").parent()
        const unseenThreads = parent.children()//.not("div.bsky-navigator-seen")
        $(unseenThreads).map(
            (i, thread) => {
                // if ($(thread).find(".item").length == $(thread).find(".item-read").length) {
                //     $(thread).css("display", hideRead ? "none": "block", "!important");
                // }
                $(thread).find(".item").each(
                    (i, item) => {
                        if(this.filterItem(item)) {
                            $(item).removeClass("filtered");
                        } else {
                            $(item).addClass("filtered");
                        }
                        // $(item).css("display", this.filterItem(item) ? "block": "none", "!important");
                        // $(item).css("display", this.filterItem(item) ? "block": "none", "!important");
                    }
                )

                if(this.filterThread(thread)) {
                    $(thread).removeClass("filtered");
                } else {
                    $(thread).addClass("filtered");
                }

                // $(thread).css("display", this.filterThread(thread) ? "block": "none", "!important");
                // $(thread).find(".item-read").map(
                //     (i, item) => {
                //         // console.log(item)
                //         $(item).css("display", hideRead ? "none": "block", "!important");
                //     }
                // )
            }
        )
        if(hideRead && $(this.items[this.index]).hasClass("item-read")) {
            console.log("jumping")
            this.jumpToNextUnseenItem();
        }
    }

    sortItems() {
        const reversed = stateManager.state.feedSortReverse
        $("#sortIndicatorImage").attr("src", this.INDICATOR_IMAGES.sort[+reversed])
        // const sortIndicator = reversed ? '↑' :  '↓';

        const parent = $(this.selector).closest(".thread").first().parent()
        // const newItems = parent.children().get().sort(
        const newItems = parent.children().filter(
            (i, item) => $(item).hasClass("thread")
        ).get().sort(
            (a, b) => {
                const threadIndexA = parseInt($(a).closest(".thread").data("bsky-navigator-thread-index"));
                const threadIndexB = parseInt($(b).closest(".thread").data("bsky-navigator-thread-index"));
                const itemIndexA = parseInt($(a).data("bsky-navigator-item-index"));
                const itemIndexB = parseInt($(b).data("bsky-navigator-item-index"));

                if (threadIndexA !== threadIndexB) {
                    return reversed
                        ? threadIndexB - threadIndexA
                        : threadIndexA - threadIndexB;
                }
                // if (threadIndexA !== threadIndexB) {
                //     return threadIndexB - threadIndexA;
                // }
                return itemIndexB - itemIndexA;
            }
        );
        // reversed ? parent.children().eq(-2).after(newItems) : parent.children().eq(0).after(newItems);
        if (reversed ^ this.loadingNew) {
            console.log(`${reversed}, ${this.loadingNew}: prepend`);
        } else {
            console.log(`${reversed}, ${this.loadingNew}: append`);
        }
        (reversed ^ this.loadingNew) ? parent.prepend(newItems) : parent.append(newItems);
    }

    handleInput(event) {
        var item = this.items[this.index]
        if(event.key == "a") {
            $(item).find(PROFILE_SELECTOR)[0].click()
        } else if(event.key == "u") {
            this.loadNewItems();
        } else if (event.key == ":") {
            this.toggleSortOrder();
        } else if (event.key == '"') {
            this.toggleHideRead();
        } else if (event.key == '/') {
            event.preventDefault();
            $("input#bsky-navigator-search").focus();
        } else if (event.key == ',' ) {
            this.loadItems();
        } else {
            super.handleInput(event);
        }
    }
}

class PostItemHandler extends ItemHandler {

    constructor(name, selector) {
        super(name, selector)
        this.indexMap = {}
        this.handleInput = this.handleInput.bind(this)
    }

    get index() {
        return this.indexMap?.[this.postId] ?? 0
    }

    set index(value) {
        this.indexMap[this.postId] = value
    }

    activate() {
        super.activate()
        this.postId = this.postIdFromUrl()
        this.markPostRead(this.postId, null)

        // console.log(`postId: ${this.postId} ${this.index}`)
    }

    deactivate() {
        super.deactivate()
    }

    isActive() {
        return window.location.pathname.match(/\/post\//)
    }

    // getIndexFromItem(item) {
    //     return $(item).parent().parent().parent().parent().index() - 3
    // }

    handleInput(event) {
        if (super.handleInput(event)) {
            return
        }

        if(this.isPopupVisible || event.altKey || event.metaKey) {
            return
        }
        var item = this.items[this.index]
        if(event.key == "a") {
            var handle = $.trim($(item).attr("data-testid").split("postThreadItem-by-")[1])
            $(item).find("div").filter( (i, el) =>
                $.trim($(el).text()).replace(/[\u200E\u200F\u202A-\u202E]/g, "") == `@${handle}`
            )[0].click()
        } else if (["o", "Enter"].includes(event.key)) {
            // o/Enter = open inner post
            var inner = $(item).find("div[aria-label^='Post by']")
            inner.click()
        }

    }
}

class ProfileItemHandler extends ItemHandler {

    constructor(name, selector) {
        super(name, selector)
    }

    activate() {
        this.setIndex(0)
        super.activate()
    }

    deactivate() {
        super.deactivate()
    }

    isActive() {
        return window.location.pathname.match(/^\/profile\//)
    }

    handleInput(event) {
        if (super.handleInput(event)) {
            return
        }
        if(event.altKey || event.metaKey) {
            return
        }
        if(event.key == "f") {
            // f = follow
            $("button[data-testid='followBtn']").click()
        } else if(event.key == "F") {
            // could make this a toggle but safer to make it a distinct shortcut
            $("button[data-testid='unfollowBtn']").click()
        } else if(event.key == "L") {
            // L = add to list
            $("button[aria-label^='More options']").click()
            setTimeout(function() {
                $("div[data-testid='profileHeaderDropdownListAddRemoveBtn']").click()
            }, 200)
        } else if(event.key == "M") {
            // M = mute
            $("button[aria-label^='More options']").click()
            setTimeout(function() {
                $("div[data-testid='profileHeaderDropdownMuteBtn']").click()
            }, 200)
        } else if(event.key == "B") {
            // B = block
            $("button[aria-label^='More options']").click()
            setTimeout(function() {
                $("div[data-testid='profileHeaderDropdownBlockBtn']").click()
            }, 200)
        } else if(event.key == "R") {
            // R = report
            $("button[aria-label^='More options']").click()
            setTimeout(function() {
                $("div[data-testid='profileHeaderDropdownReportBtn']").click()
            }, 200)
        }
    }
}

const screenPredicateMap = {
    search: (element) => element.find('div[data-testid="searchScreen"]').length,
    notifications: (element) => element.find('div[data-testid="notificationsScreen"]').length,
    chat: (element) => element.find('div:contains("Messages")').length,
    feeds: (element) => element.find('div[data-testid="FeedsScreen"]').length,
    lists: (element) => element.find('div[data-testid="listsScreen"]').length,
    profile: (element) => element.find('div[data-testid="profileScreen"]').length,
    settings: (element) => element.find('div[data-testid="userAvatarImage"]').length,
    home: (element) => true,
}

function getScreenFromElement(element) {
    for (const [page, predicate] of Object.entries(screenPredicateMap) ) {
        if (predicate(element))
        {
            return page
        }
    }
    // console.log(element[0].outerHTML)
    return "unknown"
}

function setScreen(screen) {
    stateManager.state.screen = screen
    // console.log(`screen: ${stateManager.state.screen}`)
}


(function() {

    var monitor_interval = null
    var current_url = null
    var items = {feed: [], post: []}
    var indexes = {feed: 0, post: 0}
    var context = null
    var num_items = {feed: 0, post: 0}
    var func = null
    // FIXME: ordering of these is important since posts can be in profiles
    var handlers = {
        feed: new FeedItemHandler("feed", FEED_ITEM_SELECTOR),
        post: new PostItemHandler("post", POST_ITEM_SELECTOR),
        profile: new ProfileItemHandler("profile", FEED_ITEM_SELECTOR),
        input: new Handler("input")
    }

    const SCREEN_SELECTOR = "main > div > div > div"

    function onConfigInit()
    {
  //       const preferencesIconDiv = `
  //   <div class="preferences-icon-overlay">
  //     <span>⚙️</span>
  //   </div>
  // `;
  //       $("body").append(preferencesIconDiv);


        // stateManager = new StateManager(STATE_KEY, DEFAULT_STATE, config.get("historyMax"));
        StateManager.create(STATE_KEY, DEFAULT_STATE, config.get("historyMax"))
                    .then((initializedStateManager) => {
                        stateManager = initializedStateManager; // Assign the fully initialized instance
                        console.log("State initialized");
                        console.dir(stateManager.state); // Access the fully initialized state
                        onStateInit(); // Now safe to call
                    })
                    .catch((error) => {
                        console.error("Failed to initialize StateManager:", error);
                    });
    }


    function onStateInit() {

        // Define the reusable style
        const stylesheet = `

        /* Feed itmes may be sorted, so we hide them visually and show them later */


        /*
        div[data-testid$="FeedPage"] ${FEED_ITEM_SELECTOR} {
           opacity: 0%;
        }
        */

        .item {
            ${config.get("posts")}
            scroll-margin: ${ITEM_SCROLL_MARGIN}px;
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
            border-bottom: none;
        }

        .thread-first {
            margin-top: ${config.get("threadMargin")};
            border-bottom: none;
        }

        .thread-last {
            margin-bottom: ${config.get("threadMargin")};
            border-top: none;
        }

        .preferences-icon-overlay {
            background-color: #cccccc;
            cursor: pointer;
            justify-content: center;
            z-index: 1000;
        }

       .preferences-icon-overlay-sync-ready {
            background-color: #d5f5e3;
        }

        .preferences-icon-overlay-sync-pending {
            animation: fadeInOut 1s infinite; /* Adjust timing as needed */
            background-color: #f9e79f;
        }

        .preferences-icon-overlay-sync-success {
            background-color: #2ecc71;
        }

        .preferences-icon-overlay-sync-failure {
            background-color: #ec7063 ;
        }

        .preferences-icon-overlay span {
            color: white;
            font-size: 16px;
        }

        div.r-m5arl1 {
            width: ${config.get("threadIndicatorWidth")}px;
            background-color: ${config.get("threadIndicatorColor")} !important;
        }

        div#bsky-navigator-toolbar {
            display: flex;
            flex-direction: row;
            position: sticky;
            top: 0;
            align-items: center;
            background-color: rgb(255, 255, 255);
            width: 100%;
            height: 30px;
        }

        .toolbar-icon {
            margin: 0px;
            width: 24px;
            height: 24px;
            padding: 0px 8px;
            flex: 0.1 0.1 0%;
            text-align: center;
        }

        .indicator-image {
            width: 24px;
            height: 24px;
        }

        #bsky-navigator-search {
            flex: 1;
            margin: 0px 8px;
        }

        @keyframes oscillateBorderBottom {
            0% {
                border-bottom-color: rgba(0, 128, 0, 1);
            }
            50% {
                border-bottom-color: rgba(0, 128, 0, 0.3);
            }
            100% {
                border-bottom-color: rgba(0, 128, 0, 1);
            }
        }

        @keyframes oscillateBorderTop {
            0% {
                border-top-color: rgba(0, 128, 0, 1);
            }
            50% {
                border-top-color: rgba(0, 128, 0, 0.3);
            }
            100% {
                border-top-color: rgba(0, 128, 0, 1);
            }
        }

        @keyframes fadeInOut {
          0% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.5;
          }
        }

        div.loading-indicator-reverse {
            border-bottom: 10px solid;
            animation: oscillateBorderBottom 0.5s infinite;
        }

        div.loading-indicator-forward {
            border-top: 10px solid;
            animation: oscillateBorderTop 0.5s infinite;
        }

        .filtered {
            display: none !important;
        }

        div#infoIndicator {
            flex: 0.3;
        }

        span#infoIndicatorText {
            font-size: 12px;
        }

`

        // Inject the style into the page
        const styleElement = document.createElement("style");
        styleElement.type = "text/css";
        styleElement.textContent = stylesheet;
        document.head.appendChild(styleElement);

        waitForElement(SCREEN_SELECTOR, (element) => {
            setScreen(getScreenFromElement(element))
            observeVisibilityChange($(element), (isVisible) => {
                if (isVisible) {
                    setScreen(getScreenFromElement(element))
                }
            });

        })

        function setContext(ctx) {
            context = ctx
            console.log(`context: ${context}`)
            for (const [name, handler] of Object.entries(handlers) )
            {
                //console.log(name, handler)
                handler.deactivate()
            }
            if (handlers[context])
            {
                handlers[context].activate()
            }

        }

        function setContextFromUrl()
        {
            current_url = window.location.href

            for (const [name, handler] of Object.entries(handlers) )
            {
                if (handler.isActive())
                {
                    setContext(name)
                    break
                }
            }
        }

        function onFocus (e){
            var target = e.target
            if (typeof target.tagName === 'undefined') {return false;}
            var targetTagName = target.tagName.toLowerCase()
            console.log(`onFocus: ${targetTagName}`)
            switch (targetTagName){
                case 'input':
                case 'textarea':
                    setContext("input")
                    break
                case 'div':
                    let maybeTiptap = $(target).closest(".tiptap")
                    if(maybeTiptap)
                    {
                        waitForElement(maybeTiptap, () => null, () => onBlur({"target": maybeTiptap[0]}))
                        setContext("input")
                    }
                    else
                    {
                        setContextFromUrl()
                    }
                    break
                default:
                    setContextFromUrl()
            }
        }

        function onBlur (e){
            var target = e.target
            if (typeof target.tagName === 'undefined') {return false;}
            var targetTagName = target.tagName.toLowerCase()
            console.log(`onBlur: ${targetTagName}`)
            switch (targetTagName){
                case 'input':
                case 'textarea':
                    setContextFromUrl()
                    //document.addEventListener('keypress', func, true)
                    break
                case 'div':
                    if($(target).closest(".tiptap"))
                    {
                        setContextFromUrl()
                    }
                    break
                default:
                    setContext("input")
                    break
            }
        }

        document.addEventListener('focus', onFocus, true)
        document.addEventListener('blur', onBlur, true)

        function startMonitor() {
            monitor_interval = setInterval(function() {
                if (window.location.href !== current_url) {
                    setContextFromUrl()
                }
            }, URL_MONITOR_INTERVAL)
        }

        startMonitor()
        setContextFromUrl()


    }

    $(document).ready(function(e) {
        // Create the title link
        const configTitleDiv = `
    <div class="config-title">
      <h1><a href="https://github.com/tonycpsu/bluesky-navigator" target="_blank">Bluesky Navigator</a> v${GM_info.script.version}</h1>
      <h2>Configuration</h2>
    </div>
  `;

        const OriginalIntersectionObserver = unsafeWindow.IntersectionObserver;

        // Create a proxy class
        class ProxyIntersectionObserver {
            constructor(callback, options) {
                // Store the callback and options
                this.callback = callback;
                this.options = options;
                this.enabled = true
                loadMoreItemsCallback = this.callback;
                console.log(`callback: ${loadMoreItemsCallback}`)

                // Create the "real" IntersectionObserver instance
                this.realObserver = new OriginalIntersectionObserver((entries, observer) => {
                    // Decide when to override behavior
                    // console.dir("proxy")
                    // console.dir(entries)
                    if (this.shouldOverride(entries, observer)) {
                        // console.log("Custom behavior triggered!");
                        // Custom behavior
                        this.overrideBehavior(entries, observer);
                    } else {
                        // Call the original callback
                        // console.log("calling original callback!");
                        // console.log(entries);
                        callback(entries, observer);
                    }
                }, options);
            }

            enable() {
                this.enabled = true
            }

            disable() {
                this.enabled = false
            }

            // Custom logic to decide when to override
            shouldOverride(entries, observer) {
                return !enableLoadMoreItems;
                // Example: Override if any target's boundingClientRect is fully visible
                return entries.some(entry => entry.isIntersecting);
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


        config = new GM_config({
            id: 'GM_config',
            title: configTitleDiv,
            fields: CONFIG_FIELDS,
            'events': {
                'init': onConfigInit,
                'save': () => config.close(),
                'close': () => $("#preferencesIconImage").attr("src", handlers["feed"].INDICATOR_IMAGES.preferences[0])
            },
            'css':  `
h1 {
    font-size: 18pt;
}

h2 {
    font-size: 14pt;
}
.config_var textarea {
    width: 100%;
    height: 1.5em;
}
#GM_config_stateSyncConfig_var textarea {
    height: 10em;
}
`,
        });
})})()
