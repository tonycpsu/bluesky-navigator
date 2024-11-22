// ==UserScript==
// @name         BlueSky Navigator
// @description  Adds Vim-like navigation, read/unread post-tracking, and other features to Bluesky
// @version      2024-11-22.2
// @author       @tonycpsu
// @namespace    https://tonyc.org/
// @match        https://bsky.app/*
// @require https://code.jquery.com/jquery-3.6.0.min.js
// @downloadURL  https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/bluesky-navigator.user.js
// @updateURL    https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/bluesky-navigator.user.js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// ==/UserScript==


const HISTORY_MAX = 5000
const URL_MONITOR_INTERVAL = 500
const TRANSFORM_MONITOR_INTERVAL = 500
const STATE_KEY = "bluesky_state"
const FEED_ITEM_SELECTOR = "div[data-testid^='feedItem-by-']"
const POST_ITEM_SELECTOR = "div[data-testid^='postThreadItem-by-']"
const FEED_SELECTOR = "div.r-1ye8kvj"
const PROFILE_SELECTOR = "a[aria-label='View profile']"
const LINK_SELECTOR = "a[target='_blank']"
const ITEM_CSS = {"border": "0px"} // , "scroll-margin-top": "50px"}
const SELECTED_POST_CSS = {"border": "3px rgba(255, 0, 0, .3) solid"}
const THREAD_CSS = {"border": "0px"} // , "scroll-margin-top": "50px"}
const SELECTED_THREAD_CSS = {"border": "3px rgba(0, 0, 128, .3) solid"}
const UNREAD_CSS = {"opacity": "100%", "background-color": "white"}
const READ_CSS = {"opacity": "75%", "background-color": "#f0f0f0"}

var $ = window.jQuery

class StateManager {
    constructor(key, defaultState = {}, maxEntries = 5000) {
        this.key = key;
        this.state = this.loadState(defaultState);
        this.listeners = [];
        this.debounceTimeout = null;
        this.maxEntries = maxEntries;

        // Save state on page unload
        window.addEventListener("beforeunload", () => this.saveStateImmediately());
    }

    /**
     * Loads state from storage or initializes with the default state.
     * @param {Object} defaultState - The default state object.
     */
    loadState(defaultState) {
        try {
            const savedState = JSON.parse(GM_getValue(this.key, "{}"));
            return { ...defaultState, ...savedState };
        } catch (error) {
            console.error("Error loading state, using defaults:", error);
            return defaultState;
        }
    }

    /**
     * Saves the current state to storage with debouncing.
     */
    saveState() {
        console.log("Saving state...");
        clearTimeout(this.debounceTimeout);

        this.debounceTimeout = setTimeout(() => {
            this.saveStateImmediately();
        }, 1000); // Debounce to avoid frequent writes
    }

    /**
     * Saves the current state to storage immediately.
     * Useful for critical moments like page unload.
     */
    saveStateImmediately() {
        console.log("Saving state immediately...");
        this.cleanupState(); // Ensure state is pruned before saving
        GM_setValue(this.key, JSON.stringify(this.state));
        this.notifyListeners();
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
        this.saveState();
    }

    /**
     * Updates the state with new values and saves.
     * @param {Object} newState - An object containing the new state values.
     */
    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.saveState();
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
}

const DEFAULT_STATE = { seen: {} };
const stateManager = new StateManager(STATE_KEY, DEFAULT_STATE, 5000);

/**
 * Monitors the DOM for elements matching a selector, and calls callbacks when they are added or removed.
 * @param {string} selector - The CSS selector to monitor.
 * @param {function} onAdd - Callback to execute when the element is added.
 * @param {function} onRemove - Callback to execute when the element is removed.
 * @returns {MutationObserver} - The observer instance, which can be disconnected when no longer needed.
 */
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


class Handler {

    constructor(name) {
        //console.log(name)
        this.name = name
        this.index = 0
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
        }
    }
}

class ItemHandler extends Handler {

    POPUP_MENU_SELECTOR = "div[data-radix-popper-content-wrapper]"

    constructor(name, selector) {
        super(name)
        this.selector = selector
        this.debounce_timeout = null
        this.isPopupVisible = false
        this.onPopupAdd = this.onPopupAdd.bind(this)
        this.onPopupRemove = this.onPopupRemove.bind(this)
        this.onElementAdded = this.onElementAdded.bind(this)
    }

    activate() {
        this.keyState = []
        this.observer = waitForElement(this.selector, (element) => {
            this.onElementAdded(element)
        })
        this.popupObserver = waitForElement(this.POPUP_MENU_SELECTOR, this.onPopupAdd, this.onPopupRemove);
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
        super.deactivate()
    }

    isActive() {
        return false
    }

    onPopupAdd() {
        this.isPopupVisible = true;
        console.log("Popup menu is visible:", this.isPopupVisible);
    }

    onPopupRemove() {
        this.isPopupVisible = false;
        console.log("Popup menu is dismissed:", this.isPopupVisible);
    }

    applyItemStyle(element, selected) {
        //console.log(`applyItemStyle: ${$(element).parent().parent().index()-1}, ${this.index}`)

        // if ($(element).parent().parent().index()-1 == this.index)
        if (selected)
        {
            $(element).parent().parent().css(SELECTED_THREAD_CSS)
            $(element).css(SELECTED_POST_CSS)
        }
        else
        {
            $(element).parent().parent().css(THREAD_CSS)
            $(element).css(ITEM_CSS)
        }

        var post_id = this.post_id_for_item($(element))
        //console.log(`post_id: ${post_id}`)
        if (post_id != null && stateManager.state.seen[post_id])
        {
            $(element).css(READ_CSS)
        }
        else
        {
            $(element).css(UNREAD_CSS)
        }

    }

    onElementAdded(element) {

        this.applyItemStyle(element)

        clearTimeout(this.debounce_timeout)

        this.debounce_timeout = setTimeout(() => {
            this.loadItems()
        }, 500)
    }

    handleInput(event) {
        if (this.handleMovementKey(event)) {
            return event.key
        } else if (this.handleItemKey(event)) {
            return event.key
        } else {
            return super.handleInput(event)
        }
        //console.log(`${this}, ${this.name}: ${event}`)
        //super.handleInput(event)
    }

    loadItems(el) {
        var old_length = this.items.length
        this.items = $(this.selector).filter(":visible")
        console.log(`loadItems: ${this.items.length}`)
        //console.dir(this.items[0])
        //this.updateItems()
        this.applyItemStyle(this.items[this.index], true)
        this.updateItems()
        /*
        if (old_length == 0)
        {
            this.updateItems()
        }
        */
    }

    post_id_for_item(item) {
        try {
            return $(item).find("a[href*='/post/']").attr("href").split("/")[4]
        } catch (e) {
            return null
        }
    }

    setIndex(index) {
        this.index = index
        this.updateItems()
    }

    updateItems() {
        var post_id

        // for (var i=0; i < this.items.length; i++)
        // {
        //     post_id = this.post_id_for_item(this.items[i])
        //     var item = this.items[i]
        //     if (i == this.index)
        //     {
        //         $(item).css(SELECTION_CSS)
        //         //$(this.items[i]).css("scroll-margin", `${offset}px`)
        //     }
        //     else
        //     {
        //         $(item).css(ITEM_CSS)
        //     }

        //     if (post_id != null && stateManager.state.seen[post_id])
        //     {
        //         $(item).css(READ_CSS)
        //     }
        //     else
        //     {
        //         $(item).css(UNREAD_CSS)
        //     }

        //     /*
        //     // FIXME: this is inefficient
        //     var parent = $(item).parent().parent()
        //     var children = $(parent).children()
        //     console.log(`children: ${children.length}`)
        //     if (children.length > 1)
        //     {
        //         $(item).css({"border": "5px 3px"})
        //     }
        //     */
        // }


        if (this.index == 0)
        {
            console.log("scroll to top")
            window.scrollTo(0, 0)
        } else if (this.items[this.index]) {
            console.log("scroll")
            $(this.items[this.index])[0].scrollIntoView()
        } else {
            console.log(this.index, this.items.length)
        }
    }

    markItemRead(index, isRead) {
        let postId = this.post_id_for_item(this.items[index])

        if (!postId) {
            return
        }

        const currentTime = new Date().toISOString();
        const seen = { ...stateManager.state.seen };

        if (isRead || (isRead == null && !seen[postId]) ) {
            seen[postId] = currentTime;
        } else {
            delete seen[postId];
        }

        stateManager.updateState({ seen });
        this.updateItems()
    }

    handleMovementKey(event) {
        var moved = false
        var mark = false
        var old_index = this.index
        if (this.isPopupVisible) {
            return
        }
        if (this.keyState.length == 0) {
            if (["j", "k", "ArrowDown", "ArrowUp", "J", "G"].includes(event.key))
            {
                if (["j", "ArrowDown"].indexOf(event.key) != -1) {
                    event.preventDefault()
                    if (this.index < this.items.length - 1)
                    {
                        this.index += 1
                    }
                    mark = event.key == "j"
                }
                else if (["k", "ArrowUp"].indexOf(event.key) != -1) {
                    event.preventDefault()
                    if (this.index > 0)
                    {
                        this.index -= 1
                    }
                    mark = event.key == "k"
                }
                else if (event.key == "G") {
                    // G = end
                    this.index = this.items.length-1
                } else if (event.key == "J") {
                    var i
                    for (i = this.index+1; i < this.items.length-1; i++)
                    {
                        //var item = this.items[i]
                        var post_id = this.post_id_for_item(this.items[i])
                        if (! stateManager.state.seen[post_id]) {
                            break;
                        }
                    }
                    this.index = i
                    mark = true
                }
                moved = true
            } else if (event.key == "g") {
                this.keyState.push(event.key)
            }
        } else if (this.keyState[0] == "g") {
            if (event.key == "g") {
                // gg = home
                if (this.index < this.items.length - 1)
                {
                    this.index = 0
                }
                moved = true
            }
            this.keyState = []
        }
        if (moved)
        {
            console.log(`moved: ${old_index} -> ${this.index}`)
            if (mark)
            {
                this.markItemRead(old_index, true)
            }
            this.applyItemStyle(this.items[old_index], false)
            this.applyItemStyle(this.items[this.index], true)
            this.updateItems()

            return event.key
        }
        return false
    }

    handleItemKey(event) {
        if(this.isPopupVisible || event.altKey || event.metaKey) {
            return
        }

        console.log(event.key)
        var item = this.items[this.index]
        //if(event.key == "o")
        if (["o", "Enter"].includes(event.key))
        {
            // o = open
            console.log("open")
            $(item).click()
            //bindKeys(post_key_event)
        }
        else if(event.key == "O")
        {
            // O = open inner post
            var inner = $(item).find("div[aria-label^='Post by']")
            console.log(inner)
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
            console.log("like")
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
        } else if(event.key == "h") {
            // h = back?
            //data-testid="profileHeaderBackBtn"
            var back_button = $("button[aria-label^='Back' i]").filter(":visible")
            if (back_button.length) {
                back_button.click()
            } else {
                history.back(1)
            }

        } else {
            return false
        }
        return event.key
    }
}

class FeedItemHandler extends ItemHandler {

    SCROLL_MARGIN = "50px"

    constructor(name, selector) {
        super(name, selector)
    }

    activate() {
        super.activate()
    }

    deactivate() {
        super.deactivate()
    }

    isActive() {
        return window.location.pathname == "/"
    }

    handleInput(event) {
        var item = this.items[this.index]
        if (super.handleInput(event)) {
              $(this.selector).css("scroll-margin", this.SCROLL_MARGIN)
            return
        } else if(event.key == "a") {
            $(item).find(PROFILE_SELECTOR)[0].click()
        } else if(event.key == "u") {
            this.applyItemStyle(this.items[this.index], false)
            this.index = 0
            //this.updateItems()
            $(document).find("button[aria-label^='Load new']").click()
            setTimeout( () => {
                this.loadItems()
            }, 1000)
        } else if(!isNaN(parseInt(event.key)))
        {
            if(event.altKey || event.metaKey) {
               return
            }

            $("div[data-testid='homeScreenFeedTabs-selector'] > div > div")[parseInt(event.key)-1].click()
            this.loadItems()
        }
    }
}

class PostItemHandler extends ItemHandler {

    constructor(name, selector) {
        super(name, selector)
    }

    activate() {
        this.index = 0
        super.activate()
    }

    deactivate() {
        super.deactivate()
    }

    isActive() {
        return window.location.pathname.match(/\/post\//)
    }

    handleInput(event) {
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
            console.log(inner)
            inner.click()
        } else {
          return super.handleInput(event)
        }

    }
}

class ProfileItemHandler extends ItemHandler {

    constructor(name, selector) {
        super(name, selector)
    }

    activate() {
        this.index = 0
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
        }
    }
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

    $(document).ready(function(e) {
        console.log("ready")


        function setContext(ctx) {
            context = ctx
            console.log(`context : ${context}`)
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

        setContextFromUrl()

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
                    if($(target).hasClass("tiptap"))
                    {
                        setContext("input")
                    }
                    else
                    {
                        setContextFromUrl()
                    }
                    break
                default:
                    setContextFromUrl()
                    //console.log("default: " + targetTagName)
                    //document.addEventListener('keypress', func, true)
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
                    if($(target).hasClass("tiptap"))
                    {
                        //console.log("add keypress")
                        //document.addEventListener('keypress', func, true)
                        setContextFromUrl()
                    }
                    break
                default:
                    setContext("input")
                    break
                    //setContext("input")
                    //console.log("default: " + targetTagName)
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
    })

})()
