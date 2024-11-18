// ==UserScript==
// @name         BlueSky Navigator
// @description  Adds Vim-like navigation, read/unread post-tracking, and other features to Bluesky
// @version      2024-11-18.1
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
const ITEM_CSS = {"border": "0px"} // , "scroll-margin-top": "50px"}
const SELECTION_CSS = {"border": "3px rgba(255, 0, 0, .3) solid"}
const UNREAD_CSS = {"opacity": "100%", "background-color": "white"}
const READ_CSS = {"opacity": "75%", "background-color": "#f0f0f0"}

var $ = window.jQuery
var state = null

function keepMostRecentValues(obj, N) {
    // Convert the object into an array of [key, value] pairs
    const entries = Object.entries(obj)

    // Sort the entries based on the date values in descending order (most recent first)
    entries.sort((a, b) => new Date(b[1]) - new Date(a[1]))

    // Keep only the most recent N entries
    const updatedEntries = entries.slice(0, N)

    // Convert the array back to an object
    return Object.fromEntries(updatedEntries)
}

function cleanupState() {
    state.seen = keepMostRecentValues(state.seen, HISTORY_MAX)
}


function saveState() {
    console.log("saveState")
    cleanupState()
    console.log(`state.seen: ${Object.keys(state.seen).length}`)
    GM_setValue(STATE_KEY, JSON.stringify(state))
}


function resetState() {
    state = {seen: {}}
    GM_setValue(STATE_KEY, JSON.stringify(state))
}

function waitForElement(selector, callback) {
    // Check for existing elements immediately
    const initialElements = $(selector)
    if (initialElements.length > 0) {
        for(var el in initialElements) {
            //console.log(el)
            callback(el)
        }
    }

    // Create the MutationObserver to watch for future elements
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
                const $node = $(node)
                // Check if the added node or its descendants match the selector
                if ($node.is(selector)) {
                    callback($node) // Element itself matches the selector
                } else {
                    const $children = $node.find(selector)
                    if ($children.length > 0) {
                        $children.each( (i, el) => callback(el) )
                    }
                }
            })
        })
    })

    // Start observing the document body for changes
    observer.observe(document.body, {
        childList: true, // Watch for added/removed nodes
        subtree: true // Also watch all descendants
    })
    return observer
}


class Handler {

    constructor(name) {
        //console.log(name)
        this.name = name
        this.index = 0
        this.items = []
        this.handle_input = this.handle_input.bind(this)
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
        document.addEventListener('keydown', this.handle_input, true)
    }

    unbindKeys() {
        //console.log(`${this.name}: unbind`)
        document.removeEventListener('keydown', this.handle_input, true)
    }

    handle_input(event) {
        //console.log(`handle_input: ${this}, ${this.name}: ${event}`)
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
            else if (event.code === "KeyC") {
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

    constructor(name, selector) {
        super(name)
        this.selector = selector
        this.debounce_timeout = null
    }

    activate() {
        this.keyState = []
        this.observer = waitForElement(this.selector, (element) => {
            this.onElementAdded()
        })
        super.activate()
    }

    deactivate() {
        if(this.observer)
        {
            this.observer.disconnect()
        }
        super.deactivate()
    }

    isActive() {
        return false
    }

    onElementAdded() {
        clearTimeout(this.debounce_timeout)

        this.debounce_timeout = setTimeout(() => {
            this.load_items()
        }, 500)
    }

    handle_input(event) {
        if (this.movement_key_event(event)) {
            return event.key
        } else if (this.item_key_event(event)) {
            return event.key
        } else {
            return super.handle_input(event)
        }
        //console.log(`${this}, ${this.name}: ${event}`)
        //super.handle_input(event)
    }

    load_items() {
        var old_length = this.items.length
        this.items = $(this.selector).filter(":visible")
        console.dir(`load_items: ${this.items.length}`)
        //console.dir(this.items[0])
        //this.update_items()
        this.update_items()
        /*
        if (old_length == 0)
        {
            this.update_items()
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

    set_index(index) {
        this.index = index
        this.update_items()
    }

    update_items() {
        var post_id

        for (var i=0; i < this.items.length; i++)
        {
            post_id = this.post_id_for_item(this.items[i])
            var item = this.items[i]
            if (i == this.index)
            {
                $(item).css(SELECTION_CSS)
                //$(this.items[i]).css("scroll-margin", `${offset}px`)
            }
            else
            {
                $(item).css(ITEM_CSS)
            }

            if (post_id != null && state.seen[post_id])
            {
                $(item).css(READ_CSS)
            }
            else
            {
                $(item).css(UNREAD_CSS)
            }

            /*
            // FIXME: this is inefficient
            var parent = $(item).parent().parent()
            var children = $(parent).children()
            console.log(`children: ${children.length}`)
            if (children.length > 1)
            {
                $(item).css({"border": "5px 3px"})
            }
            */
        }
        if (this.index == 0)
        {
            window.scrollTo(0, 0)
        } else if (this.items[this.index]) {
            $(this.items[this.index])[0].scrollIntoView()
        }
    }

    mark_read(index, read)
    {
        var post_id = this.post_id_for_item(this.items[index])

        if (!post_id) {
            return
        }
        if (state.seen[post_id])
        {
            if (!read) {
                delete(state.seen[post_id])
            }
            else
            {
                state.seen[post_id] = new Date().toISOString()
            }
        } else {
            if (read || read == null) {
                state.seen[post_id] = new Date().toISOString()
            } else {
                delete(state.seen[post_id])
            }
        }
        //state.seen[post_id] = new Date().toISOString()
        this.update_items()
    }

    movement_key_event(event) {
        var moved = false
        var mark = false
        var old_index = this.index
        if (this.keyState.length == 0) {
            if (["j", "k", "ArrowDown", "ArrowUp", "J", "G"].indexOf(event.key) != -1)
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
                    /*
                    for (var i = this.index+1; i < this.items.length; i++)
                    {
                        //console.log(i)
                        //var item = this.items[i]
                        var post_id = this.post_id_for_item(this.items[i])
                        if (! state.seen[post_id]) {
                            break;
                        }
                        if(i < this.items.length -1)
                        {
                            i++;
                        }
                        old_index = i
                        mark = true
                        this.index = i
                    }
                    */
                }
                console.log("moved")
                moved = true
            } else if (event.key == "g")
            {
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
            if (mark)
            {
                this.mark_read(old_index, true)
            }
            this.update_items()

            return event.key
        }
        return false
    }

    item_key_event(event) {
        if(event.altKey || event.metaKey) {
            return
        }
        var item = this.items[this.index]
        if(event.key == "o")
        {
            // o = open
            console.log("open")
            $(item).click()
            //bindKeys(post_key_event)
        }
        else if(event.key == "O")
        {
            // O = open link
            $(item).find("a[role='link']").click()
        }
        else if(event.key == "i")
        {
            // i = open inner
            var inner = $(item).find("div[aria-label^='Post by']")
            console.log(inner)
            inner.click()
            //bindKeys(post_key_event)
        }
        else if(event.key == "m")
        {
            // m = media?
            var media = $(item).find("img[src*='feed_thumbnail']")
            if (media.length > 0)
            {
                media[0].click()
            }
        }
        else if(event.key == "a") {
            $(item).find(PROFILE_SELECTOR)[0].click()
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
                $("div[aria-label^='Repost']").click()
            }, 1000)
        } else if (event.key == ".") {
            // toggle read/unread
            this.mark_read(this.index, null)
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

    handle_input(event) {
        if (super.handle_input(event)) {
            if (["j", "k", "J", "K"].indexOf(event.key) !== -1) {
                if (["k", "K"].indexOf(event.key) !== -1) {
                    this.scroll_offset = 50
                } else {
                    this.scroll_offset = 0
                }
              }
              $(this.selector).css("scroll-margin", `${this.scroll_offset}px`)
            return
        } else if(event.key == "u") {
            this.index = 0
            this.update_items()
            $(document).find("button[aria-label^='Load new']").click()
            setTimeout( () => {
                this.load_items()
            }, 1000)
        } else if(!isNaN(parseInt(event.key)))
        {
            if(event.altKey || event.metaKey) {
               return
            }

            $("div[data-testid='homeScreenFeedTabs-selector'] > div > div")[parseInt(event.key)-1].click()
            this.load_items()
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

    handle_input(event) {
        if (super.handle_input(event)) {
            return
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

    handle_input(event) {
        if (super.handle_input(event)) {
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

    state = JSON.parse(GM_getValue(STATE_KEY, '{"seen": {}}'))

    $(document).ready(function(e) {
        console.log("ready")

        let idleTimeout;

        function resetIdleTimer() {
            clearTimeout(idleTimeout);
            idleTimeout = setTimeout(saveState, 5000);
        }

        // Handle idle time
        window.addEventListener("keydown", resetIdleTimer);
        window.addEventListener("click", resetIdleTimer);

        // Handle page close or refresh
        window.addEventListener("beforeunload", (event) => {
            saveState();
            event.preventDefault();
            event.returnValue = '';
        });

        // Initialize the timer
        resetIdleTimer();

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
