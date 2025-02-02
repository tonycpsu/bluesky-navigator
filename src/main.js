// main.js


import constants from './constants.js'
import { state } from "./state.js";
import * as utils from "./utils.js";
import * as configjs from "./config.js";

import style from './assets/css/style.css?raw'
import configCss from "./assets/css/config.css?raw";

const {
    debounce,
    waitForElement,
    observeChanges,
    observeVisibilityChange,
} = utils;

import {
    Handler,
    ItemHandler,
    FeedItemHandler,
    PostItemHandler,
    ProfileItemHandler
} from './handlers.js'

GM_addStyle(style)

let config;
let handlers;
let enableLoadMoreItems = false;

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
        'default': 'opacity: 100% !important;'
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
        'default': 'opacity: 75% !important;'
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
    'videoPreviewPlayback': {
        'label': 'Video Preview Playback',
        'title': 'Control playback of video previews',
        'type': 'select',
        'options': ['Play all', 'Play selected', 'Pause all'],
    },
    'hideLoadNewButton':  {
        'label': 'Hide Load New Button',
        'title': 'If checked, the floating button to load new items will be hidden.',
        'type': 'checkbox',
        'default': false
    },
    'showPostCounts':  {
        'label': 'Show Post Counts',
        'title': 'Specify whether post counts are displayed in all, selected, or no posts.',
        'type': 'select',
        'options': ['All', 'Selection', 'None'],
        'default': "All"
    },
    'enableSmoothScrolling':  {
        'label': 'Enable Smooth Scrolling',
        'title': 'If checked, scrolling using keyboard navigation will be smooth 🛥️ 🎷',
        'type': 'checkbox',
        'default': false
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
    'rulesSection': {
        'section': [GM_config.create('Rules'), 'Post Rules'],
        'type': 'hidden',
    },
    'rulesConfig': {
        'label': 'Filters Configuration',
        'type': 'textarea',
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
        'default': constants.DEFAULT_HISTORY_MAX
    },
    'showDebuggingInfo':  {
        'label': 'Enable Debugging',
        'title': 'If checked, some debugging info will be shown in posts',
        'type': 'checkbox',
        'default': false
    },

}

const screenPredicateMap = {
    search: (element) => $(element).find('div[data-testid="searchScreen"]').length,
    notifications: (element) => $(element).find('div[data-testid="notificationsScreen"]').length,
    chat: (element) => $(element).find('div:contains("Messages")').length,
    feeds: (element) => $(element).find('div[data-testid="FeedsScreen"]').length,
    lists: (element) => $(element).find('div[data-testid="listsScreen"]').length,
    profile: (element) => $(element).find('div[data-testid="profileScreen"]').length,
    settings: (element) => $(element).find('div[data-testid="userAvatarImage"]').length,
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
    state.screen = screen
    // console.log(`screen: ${state.screen}`)
}


(function() {

    var monitor_interval = null
    var current_url = null
    var items = {feed: [], post: []}
    var indexes = {feed: 0, post: 0}
    var context = null
    var num_items = {feed: 0, post: 0}
    var func = null

    const SCREEN_SELECTOR = "main > div > div > div"

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

            // Match explicit allow/deny rules
            const ruleMatch = line.match(/(allow|deny) (all|from|content) "?([^"]+)"?/);
            if (ruleMatch) {
                const [_, action, type, value] = ruleMatch;
                rules[rulesName].push({ action, type, value });
                continue;
            }

            // **Shortcut Parsing**
            if (line.startsWith("@")) {
                // Interpret "@foo" as "allow author 'foo'"
                rules[rulesName].push({ action: "allow", type: "from", value: line });
            } else {
                // Any other string is interpreted as "allow content 'foobar'"
                rules[rulesName].push({ action: "allow", type: "content", value: line });
            }
        }
        return rules;
    }

    function onConfigInit()
    {

        const stateManagerConfig = {
            stateSyncEnabled: config.get("stateSyncEnabled"),
            stateSyncConfig: config.get("stateSyncConfig"),
            stateSaveTimeout: config.get("stateSaveTimeout"),
            maxEntries: config.get("historyMax")
        }

        state.init(constants.STATE_KEY, stateManagerConfig, onStateInit);
    }


    function onStateInit() {

        // FIXME: ordering of these is important since posts can be in profiles
        handlers = {
            feed: new FeedItemHandler("feed", config, state, constants.FEED_ITEM_SELECTOR),
            post: new PostItemHandler("post", config, state, constants.POST_ITEM_SELECTOR),
            profile: new ProfileItemHandler("profile", config, state, constants.FEED_ITEM_SELECTOR),
            input: new Handler("input", config, state)
        }

        // FIXME: find a better place for this
        state.rules = parseRulesConfig(config.get("rulesConfig"));

        if(config.get("showDebuggingInfo")) {
            const logContainer = $(`<div id="logContainer"></div>`);
            $("body").append(logContainer);
            const logHeader = $(`<div id="logHeader"></div>`);
            logHeader.append($(`<button id="clearLogs"/>Clear</button>`));
            logContainer.append(logHeader);
            logContainer.append($(`<div id="logContent"></div>`));
            $('#clearLogs').on('click', function () {
                $('#logContent').empty(); // Clear the logs
            });

            function appendLog(type, args) {
                const message = `[${type.toUpperCase()}] ${args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')}`;

                $('#logContent').append(`<div style="margin-bottom: 5px;">${message}</div>`);
                $('#logContent').scrollTop($('#logContent')[0].scrollHeight);
            }

            // Override console methods
            const originalConsole = {};
            ["log", "warn", "error", "info"].forEach(type => {
                originalConsole[type] = console[type];
                unsafeWindow.console[type] = function(...args) {
                    appendLog(type, args);
                    originalConsole[type].apply(console, args);
                };
            });
            window.console = unsafeWindow.console;
        }


        // Define the reusable style
        const stylesheet = `

        /* Feed itmes may be sorted, so we hide them visually and show them later */
        div[data-testid$="FeedPage"] ${constants.FEED_ITEM_SELECTOR} {
           opacity: 0%;
        }

        ${
            config.get("hideLoadNewButton")
            ?
            `
            ${constants.LOAD_NEW_BUTTON_SELECTOR} {
                display: none;
            }
            `
            :
            ``
        }

        .item {
            ${config.get("posts")}
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
            border-bottom: none;
        }

        .thread-last {
            margin-bottom: ${config.get("threadMargin")};
            border-top: none;
        }

        div.r-m5arl1 {
            width: ${config.get("threadIndicatorWidth")}px;
            background-color: ${config.get("threadIndicatorColor")} !important;
        }

`

        // Inject the style into the page
        const styleElement = document.createElement("style");
        styleElement.type = "text/css";
        styleElement.textContent = stylesheet;
        document.head.appendChild(styleElement);

        waitForElement(constants.SCREEN_SELECTOR, (element) => {
            setScreen(getScreenFromElement(element))
            observeVisibilityChange($(element), (isVisible) => {
                if (isVisible) {
                    setScreen(getScreenFromElement(element))
                }
            });

        })

        function setContext(ctx) {
            if(context == ctx) {
                return;
            }
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
                    setContext("input");
                    break;
                case 'div':
                    let maybeTiptap = $(target).closest(".tiptap")
                    if(maybeTiptap.length)
                    {
                        waitForElement(".tiptap", () => null, () => onBlur({"target": maybeTiptap[0]}))
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
            console.log(e.target);
            switch (targetTagName){
                case 'input':
                case 'textarea':
                    setContextFromUrl()
                    //document.addEventListener('keypress', func, true)
                    break
                case 'div':
                    if($(target).closest(".tiptap").length)
                    {
                        setContextFromUrl()
                    }
                    break
                default:
                    setContextFromUrl()
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
            }, constants.URL_MONITOR_INTERVAL)
        }


        startMonitor()
        setContextFromUrl()

        // set up observer to detect if mobile interface is active
        state.mobileView = false;
        const viewportChangeObserver = waitForElement(
            'button[aria-label="Open drawer menu"]',
            (el) => {
                state.mobileView = true;
                console.log("found");
                console.log($('#bsky-navigator-toolbar').outerHeight());
                $("div.r-sa2ff0").css("padding-top", $('#bsky-navigator-toolbar').outerHeight() + "px");
                // waitForElement(
                //     '#bsky-navigator-toolbar',
                //     (toolbar) => {
                //         console.log("found");
                //         console.log($(toolbar).outerHeight());
                //         $("div.r-sa2ff0").css("padding-top", $(toolbar).outerHeight());
                //     }
                // );
            },
            (el) => {
                state.mobileView = false;
                $("div.r-sa2ff0").css("padding-top", "0px");
            }
        );

        function proxyIntersectionObserver() {
            const OriginalIntersectionObserver = unsafeWindow.IntersectionObserver;

            // Create a proxy class
            class ProxyIntersectionObserver {
                constructor(callback, options) {
                    // Store the callback and options
                    this.callback = callback;
                    this.options = options;
                    this.enabled = true
                    handlers["feed"].loadOlderItemsCallback = this.callback;
                    // Create the "real" IntersectionObserver instance
                    this.realObserver = new OriginalIntersectionObserver((entries, observer) => {
                        // filter thread divs out
                        const filteredEntries = entries.filter(
                            (entry) => !(
                                $(entry.target).hasClass("thread")
                                ||
                                $(entry.target).hasClass("item")
                                ||
                                $(entry.target).find('div[data-testid^="feedItem"]').length
                                ||
                                $(entry.target).next()?.attr("style") == "height: 32px;"
                            )
                        )

                        // if(filteredEntries.length) {
                        //     debugger;
                        // }

                        callback(
                            filteredEntries,
                            observer
                        )
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
        if (typeof GM_config !== "undefined") {
            callback();
        } else {
            console.warn("GM_config not available yet. Retrying...");
            setTimeout(() => waitForGMConfig(callback), 100);
        }
    }

    waitForGMConfig(() => {
        config = new GM_config({
            id: 'GM_config',
            title: configTitleDiv,
            fields: CONFIG_FIELDS,
            'events': {
                'init': onConfigInit,
                'save': () => config.close(),
                'close': () => $("#preferencesIconImage").attr("src", handlers["feed"].INDICATOR_IMAGES.preferences[0])
            },
            'css': configCss
        });
    });

    $(document).ready(function(e) {


        // Store the original play method
        const originalPlay = HTMLMediaElement.prototype.play;

        // Override the play method
        HTMLMediaElement.prototype.play = function () {
            const isUserInitiated = this.dataset.allowPlay === 'true';

            // Allow user-initiated playback or userscript playback
            if (isUserInitiated || config.get("videoPreviewPlayback") == "Play all") {
                console.log('Allowing play:', this);
                delete this.dataset.allowPlay; // Clear the flag after use
                return originalPlay.apply(this, arguments);
            }

            // Check if play is triggered by a user click
            else if ($(document.activeElement).is('button[aria-label^="Play"]')) {
                console.log('Allowing play from user interaction:', this);
                return originalPlay.apply(this, arguments);
            }

            else  {
                // Block all other play calls (likely from the app)
                console.log('Blocking play call from app:', this);
                return Promise.resolve(); // Return a resolved promise to prevent errors
            }
        };

})})()
