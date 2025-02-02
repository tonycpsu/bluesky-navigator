;// handlers.js

import constants from './constants.js'
import * as utils from "./utils.js";
import * as dateFns from "date-fns";

const {
  waitForElement
} = utils;

export class Handler {

  constructor(name, config, state) {
    //console.log(name)
    this.name = name
    this.config = config
    this.state = state
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
        this.config.open()
      }
    }
  }
}

export class ItemHandler extends Handler {

  // POPUP_MENU_SELECTOR = "div[data-radix-popper-content-wrapper]"
  POPUP_MENU_SELECTOR = "div[aria-label^='Context menu backdrop']"

  // FIXME: this belongs in PostItemHandler
  THREAD_PAGE_SELECTOR = "main > div > div > div"

  MOUSE_MOVEMENT_THRESHOLD = 10

  constructor(name, config, state, selector) {
    super(name);
    this.config = config;
    this.state = state;
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
    this.handleNewThreadPage = this.handleNewThreadPage.bind(this); // FIXME: move to PostItemHandler
    this.onItemMouseOver = this.onItemMouseOver.bind(this);
    this.didMouseMove = this.didMouseMove.bind(this);
    this.getTimestampForItem = this.getTimestampForItem.bind(this);
    this.loading = false;
    this.loadingNew = false;
    this.enableScrollMonitor = false;
    this.enableIntersectionObserver = false;
    this.handlingClick = false;
    this.itemStats = {}
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
      // rootMargin: `-${ITEM_SCROLL_MARGIN}px 0px 0px 0px`,
      threshold: Array.from({ length: 101 }, (_, i) => i / 100)
    });
    this.setupIntersectionObserver();

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

    this.loadNewerObserver = waitForElement(constants.LOAD_NEW_INDICATOR_SELECTOR, (button) => {
      this.loadNewerButton = $(button)[0];
      $('a#loadNewerIndicatorLink').on("click", () => this.loadNewerItems())

      $('img#loadNewerIndicatorImage').css("opacity", "1");
      $('img#loadNewerIndicatorImage').removeClass("toolbar-icon-pending");
      if ($('#loadNewerAction').length == 0) {
        $('#messageActions').append($('<div id="loadNewerAction"><a> Load newer posts</a></div>'));
        $('#loadNewerAction > a').on("click", () => this.loadNewerItems());
      }
      this.loadNewerButton.addEventListener(
        "click",
        (event) => {
          if (this.loadingNew) {
            console.log("handling click, returning")
            return; // Avoid re-entry
          }

          console.log("Intercepted click in capture phase", event.target);
          // Save the target and event details for later
          const target = event.target;
          // const originalHandler = target.onclick;

          // Stop propagation but allow calling the original logic manually
          event.stopImmediatePropagation();

          // // Call the application's original handler if necessary
          setTimeout(() => {
            console.log("Calling original handler");
            this.loadNewerItems();
          }, 0);

          // Add custom logic
          console.log("Custom logic executed");
        },
        true // Capture phase
      );
    });

    this.enableScrollMonitor = true;
    this.enableIntersectionObserver = true;
    $(document).on("scroll", this.onScroll);
    // this.loadItems();
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
    this.disableFooterObserver();

    $(this.selector).off("mouseover mouseleave");
    $(document).off("scroll", this.onScroll);
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
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect(element)
    }
  }

  onScroll(event) {
    if(!this.enableScrollMonitor) {
      return;
    }
    this.enableIntersectionObserver = true;
  }

  scrollToElement(target) {
    this.enableScrollMonitor = false;
    target.scrollIntoView(
      {behavior: this.config.get("enableSmoothScrolling") ? "smooth" : "instant"}
    );
    setTimeout(() => {
      this.enableScrollMonitor = true;
    }, 250);
  }

  // Function to programmatically play a video from the userscript
  playVideo(video) {
    video.dataset.allowPlay = 'true'; // Set the custom flag
    console.log('Userscript playing video:', video);
    video.play(); // Call the overridden play method
  }

  pauseVideo(video) {
    video.dataset.allowPlay = 'true'; // Set the custom flag
    console.log('Userscript playing video:', video);
    video.pause(); // Call the overridden play method
  }

  setupIntersectionObserver(entries) {

    if(this.intersectionObserver) {
      $(this.items).each(
        (i, item) => {
          this.intersectionObserver.observe($(item)[0]);
        }
      )
    }
  }

  onIntersection(entries) {

    if(!this.enableIntersectionObserver || this.loading || this.loadingNew) {
      return;
    }
    console.log("onIntersection");
    let focusedElement = null;

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        this.visibleItems.add(entry.target);
      } else {
        this.visibleItems.delete(entry.target);
      }
    });

    const visibleItems = Array.from(this.visibleItems).sort(
      (a, b) =>  a.getBoundingClientRect().top - b.getBoundingClientRect().top
    )

    if (! visibleItems.length) {
      return;
    }
    const target = visibleItems[0]

    if (target) {
      var index = this.getIndexFromItem(target);
      if (this.config.get("markReadOnScroll")) {
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
        this.disableFooterObserver();
        this.loadOlderItems();
      }
    });
  }

  enableFooterObserver() {
    if (this.config.get("disableLoadMoreOnScroll")) {
      return;
    }
    if(!this.state.feedSortReverse && this.items.length > 0) {
      this.footerIntersectionObserver.observe(this.items.slice(-1)[0]);
    }
  }

  disableFooterObserver() {
    if(this.footerIntersectionObserver)
    {
      this.footerIntersectionObserver.disconnect()
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
    var el = $('div[data-testid="HomeScreen"] > div > div').eq(2);
    if(this.state.mobileView) {
      el = el.first().first();
      if(this.index) {
        var transform = el[0].style.transform
        var translateY = transform.indexOf("(") == -1 ? 0 : parseInt(transform.split("(")[1].split("px")[0])
        margin = el.outerHeight() + translateY;
      } else {
        margin = el.outerHeight();
      }

    } else {
      margin = el.outerHeight();
    }
    return margin;
  }

  applyItemStyle(element, selected) {
    $(element).addClass("item");
    const postTimestampElement = $(element).find('a[href^="/profile/"][data-tooltip*=" at "]').first()
    if (!postTimestampElement.attr("data-bsky-navigator-age")) {
      postTimestampElement.attr("data-bsky-navigator-age", postTimestampElement.text())
    }
    const userFormat = this.config.get("postTimestampFormat");
    const postTimeString = postTimestampElement.attr("aria-label")
    if (postTimeString && userFormat) {
      // console.log(postTimeString)
      const postTimestamp = new Date(postTimeString.replace(' at', ''));
      if (userFormat) {
        const formattedDate = dateFns.format(postTimestamp, userFormat).replace("$age", postTimestampElement.attr("data-bsky-navigator-age"));
        if (this.config.get("showDebuggingInfo")) {
          postTimestampElement.text(`${formattedDate} (${$(element).parent().parent().attr("data-bsky-navigator-thread-index")}, ${$(element).attr("data-bsky-navigator-item-index")})`);
        } else {
          postTimestampElement.text(formattedDate);
        }
      }
    }

    // FIXME: This method of finding threads is likely to be unstable.
    const threadIndicator = $(element).find("div.r-lchren, div.r-1mhb1uw > svg")
    const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]')

    $(element).parent().parent().addClass("thread");

    if(this.config.get("showPostCounts") == "All" || selected && this.config.get("showPostCounts") == "Selection") {
      const bannerDiv = $(element).find("div.item-banner").first().length
            ? $(element).find("div.item-banner").first()
            : $(element).find("div").first().prepend($('<div class="item-banner"/>')).children(".item-banner").last();
      $(bannerDiv).html(`<strong>${this.getIndexFromItem(element)+1}</strong>/<strong>${this.itemStats.shownCount}</strong>`);

    }

    $(element).css("scroll-margin-top", `${this.scrollMargin}px`, `!important`);

    $(element).find('video').each(
      (i, video) => {
        if (
          (this.config.get("videoPreviewPlayback") == "Pause all")
            ||
            ( (this.config.get("videoPreviewPlayback") == "Play selected") && !selected)
        ) {
          this.pauseVideo(video);
        } else if ((this.config.get("videoPreviewPlayback") == "Play selected") && selected) {
          this.playVideo(video);
        }
      }
    )

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
        if (children.index(threadIndicator) < children.index(avatarDiv)) {
          $(element).parent().parent().addClass("thread-last")
        } else {
          $(element).parent().parent().addClass("thread-first")
        }
      } else {
        $(element).parent().parent().addClass("thread-middle")
      }

    } else {
      $(element).parent().parent().addClass(["thread-first", "thread-middle", "thread-last"])
    }

    if (selected)
    {
      $(element).addClass("item-selection-active")
      $(element).removeClass("item-selection-inactive")
    }
    else
    {
      $(element).removeClass("item-selection-active")
      $(element).addClass("item-selection-inactive")
    }

    var postId = this.postIdForItem($(element))

    if (postId != null && this.state.seen[postId])
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
    if (this.state.blocks.all.includes(handle)) {
      $(element).find(constants.PROFILE_SELECTOR).css(constants.CLEARSKY_BLOCKED_ALL_CSS)
    }
    if (this.state.blocks.recent.includes(handle)) {
      $(element).find(constants.PROFILE_SELECTOR).css(constants.CLEARSKY_BLOCKED_RECENT_CSS)
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
    this.enableScrollMonitor = false;
    if (this.handleMovementKey(event)) {
      return event.key
    } else if (this.handleItemKey(event)) {
      return event.key
    } else if (event.key == "U") {
      console.log("Update")
      this.loadOlderItems();
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

  showMessage(title, message) {
    this.hideMessage();
    this.messageContainer = $('<div id="messageContainer">');
    if (title) {
      const messageTitle = $('<div class="messageTitle">');
      $(messageTitle).html(title)
      this.messageContainer.append(messageTitle);
    }
    const messageBody = $('<div class="messageBody">');
    this.messageContainer.append(messageBody);
    $(messageBody).html(message);
    $(constants.FEED_CONTAINER_SELECTOR).filter(":visible").append(this.messageContainer);
    window.scrollTo(0, 0);

  }

  hideMessage() {
    $('#messageContainer').remove();
    this.messageContainer = null;
  }

  getTimestampForItem(item) {
    const postTimestampElement = $(item).find('a[href^="/profile/"][data-tooltip*=" at "]').first();
    const postTimeString = postTimestampElement.attr("aria-label");
    if(!postTimeString) {
      return null;
    }
    return new Date(postTimeString.replace(' at', ''));
  }

  loadItems(focusedPostId) {

    var old_length = this.items.length
    var old_index = this.index

    const classes = ["thread-first", "thread-middle", "thread-last"];
    let set = [];

    $(this.items).css("opacity", "0%")
    let itemIndex = 0;
    let threadIndex = 0;

    this.ignoreMouseMovement = true;
    // console.log("loadItems");
    $(this.selector).filter(":visible").each( (i, item) => {
      // console.log(item);
      $(item).attr("data-bsky-navigator-item-index", itemIndex++);
      $(item).parent().parent().attr("data-bsky-navigator-thread-index", threadIndex);

      const threadDiv = $(item).parent().parent()
      // Check if the div contains any of the target classes
      if (classes.some(cls => $(threadDiv).hasClass(cls))) {
        set.push(threadDiv[0]); // Collect the div
        if ($(threadDiv).hasClass("thread-last")) {
          threadIndex++;
        }
      }
    });

    this.sortItems();
    this.filterItems();

    this.items = $(this.selector).filter(":visible")

    this.itemStats.oldest = this.itemStats.newest = null;
    $(this.selector).filter(":visible").each( (i, item) => {

      const timestamp = this.getTimestampForItem(item);
      if(!this.itemStats.oldest || timestamp < this.itemStats.oldest) {
        this.itemStats.oldest = timestamp;
      }
      if(!this.itemStats.newest || timestamp > this.itemStats.newest) {
        this.itemStats.newest = timestamp;
      }
    });

    this.setupIntersectionObserver();

    // this.activate()
    this.enableFooterObserver();

    // console.log(this.items)
    if(this.index != null) {
      this.applyItemStyle(this.items[this.index], true)
    }
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
        $(el).find("line").attr("stroke", this.config.get("threadIndicatorColor"))
        $(el).find("circle").attr("fill", this.config.get("threadIndicatorColor"))
      }
    )
    $(this.selector).on("mouseover", this.onItemMouseOver)

    $(this.selector).closest("div.thread").addClass("bsky-navigator-seen")
    // console.log("set loading false")
    $(this.selector).closest("div.thread").removeClass(["loading-indicator-reverse", "loading-indicator-forward"]);

    this.refreshItems();

    this.loading = false;
    $('img#loadOlderIndicatorImage').css("opacity", "1");
    $('img#loadOlderIndicatorImage').removeClass("toolbar-icon-pending");
    $(this.items).css("opacity", "100%")
    if(focusedPostId) {
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
`)
      if ($('#loadOlderAction').length == 0) {
        $('#messageActions').append($('<div id="loadOlderAction"><a>Load older posts</a></div>'));
        $('#loadOlderAction > a').on("click", () => this.loadOlderItems());
      }
      if ($('img#loadNewerIndicatorImage').css("opacity") == "1") {
        $('#messageActions').append($('<div id="loadNewerAction"><a>Load newer posts</a></div>'));
        $('#loadNewerAction > a').on("click", () => this.loadNewerItems());
      }

    } else {
      this.hideMessage()
    }

    this.ignoreMouseMovement = false;
    this.enableScrollMonitor = false;
    // else if (this.index == null) {
    //     this.setIndex(0);
    // }
    // this.updateItems();
  }

  refreshItems() {
    $(this.items).each(
      (index, item) => {
        this.applyItemStyle(this.items[index], index == this.index);
      }
    )
  }

  updateInfoIndicator() {
    this.itemStats.unreadCount = this.items.filter(
      (i, item) => $(item).hasClass("item-unread")
    ).length;
    this.itemStats.filteredCount = this.items.filter(".filtered").length;
    this.itemStats.shownCount = this.items.length - this.itemStats.filteredCount
    const index = this.itemStats.shownCount ? this.index+1 : 0;
    $("span#infoIndicatorText").html(`
<div>
<strong>${index}</strong>/<strong>${this.itemStats.shownCount}</strong> (<strong>${this.itemStats.filteredCount}</strong> filtered, <strong>${this.itemStats.unreadCount}</strong> new)
</div>
<div>
${
this.itemStats.oldest
?
`${dateFns.format(this.itemStats.oldest, 'yyyy-MM-dd hh:mmaaa')} - ${dateFns.format(this.itemStats.newest, 'yyyy-MM-dd hh:mmaaa')}</div>`
: ``
}`);
  }

  loadNewerItems() {
    if(!this.loadNewerButton) {
      console.log("no button")
      return;
    }
    this.loadingNew = true;
    this.applyItemStyle(this.items[this.index], false)
    let oldPostId = this.postIdForItem(this.items[this.index])
    $(this.loadNewerButton).click()
    setTimeout( () => {
      this.loadItems(oldPostId);
      $('img#loadNewerIndicatorImage').css("opacity", "0.2");
      $('img#loadNewerIndicatorImage').removeClass("toolbar-icon-pending");
      $('#loadNewerAction').remove();
      this.loadingNew = false;
    }, 1000)
  }

  loadOlderItems() {
    if(this.loading) {
      // console.log("already loading, returning")
      return;
    }
    console.log("loading more");
    $('img#loadOlderIndicatorImage').css("opacity", "0.2");
    $('img#loadOlderIndicatorImage').addClass("toolbar-icon-pending");
    this.loading = true;
    const reversed = this.state.feedSortReverse;
    const index = reversed ? 0 : this.items.length-1;
    this.setIndex(index);
    this.updateItems();
    var indicatorElement = (
      this.items.length
        ? this.items[index]
        : $(this.selector).eq(index)[0]
    );
    var loadElement = this.items.length ? this.items[this.items.length-1] : $(this.selector).first()[0];
    $(indicatorElement).closest("div.thread").addClass(this.state.feedSortReverse ? "loading-indicator-forward" : "loading-indicator-reverse");
    loadOlderItemsCallback(
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
      return this.postIdFromUrl()
    }
  }

  handleFromItem(item) {
    return $.trim($(item).find(constants.PROFILE_SELECTOR).find("span").eq(1).text().replace(/[\u200E\u200F\u202A-\u202E]/g, "")).slice(1)
  }

  displayNameFromItem(item) {
    return $.trim($(item).find(constants.PROFILE_SELECTOR).find("span").eq(0).text().replace(/[\u200E\u200F\u202A-\u202E]/g, ""))
  }

  getHandles() {
    return Array.from(new Set(this.items.map( (i, item) => this.handleFromItem(item) )));
  }

  getDisplayNames() {
    return Array.from(new Set(this.items.map( (i, item) => this.displayNameFromItem(item) )));
  }

  getAuthors() {
    const authors = $(this.items).get().map( (item) => ({
      handle: this.handleFromItem(item),
      displayName: this.displayNameFromItem(item)
    })).filter(
      (author) => author.handle.length > 0
    );
    const uniqueMap = new Map();
    authors.forEach(author => {
      uniqueMap.set(author.handle, author); // Only keeps the last occurrence
    });
    return Array.from(uniqueMap.values()); // Convert back to an array
  }

  updateItems() {

    if (this.index == 0)
    {
      window.scrollTo(0, 0)
    } else if (this.items[this.index]) {
      this.scrollToElement($(this.items[this.index])[0]);
    } else {
      // console.log(this.index, this.items.length)
    }

  }

  setIndex(index, mark, update) {
    let oldIndex = this.index;
    this.enableIntersectionObserver = false;
    if (oldIndex != null) {
      if (mark)
      {
        this.markItemRead(oldIndex, true)
      }
    }
    if (index < 0 || index >= this.items.length) {
      return;
    }
    this.applyItemStyle(this.items[oldIndex], false)
    this.index = index;
    this.applyItemStyle(this.items[this.index], true)
    if(update) {
      this.updateItems();
    }
    setTimeout(
      () => this.enableIntersectionObserver = true,
      500
    );
    return true;
    // this.updateItems();
  }

  jumpToPost(postId) {
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
    if (this.name == "post" && !this.config.get("savePostState")) {
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
    const seen = { ...this.state.seen };

    if (isRead || (isRead == null && !seen[postId]) ) {
      seen[postId] = currentTime;
    } else {
      seen[postId] = null;
      // delete seen[postId];
    }
    this.state.stateManager.updateState({ seen, lastUpdated: currentTime });
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

  jumpToPrev(mark) {
    this.setIndex(this.index - 1, mark, true);
    return true;
  }

  jumpToNext(mark) {
    if (this.index < this.items.length) {
      // this.index += 1
      this.setIndex(this.index + 1, mark, true);
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
    return true;
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
          moved = this.jumpToNext(event.key == "j");
        }
        else if (["k", "ArrowUp"].indexOf(event.key) != -1) {
          event.preventDefault()
          moved = this.jumpToPrev(event.key == "k");
        }
        else if (event.key == "G") {
          // G = end
          moved = this.setIndex(this.items.length-1, false, true);
        } else if (event.key == "J") {
          mark = true
          this.jumpToNextUnseenItem(mark);
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
          this.setIndex(0, false, true);
        }
        moved = true;
      }
      this.keyState = []
    }
    if (moved) {
      this.lastMousePosition = null;
    }
  }

  jumpToNextUnseenItem(mark) {
    var i
    for (i = this.index+1; i < this.items.length-1; i++)
    {
      //var item = this.items[i]
      var postId = this.postIdForItem(this.items[i])
      if (! this.state.seen[postId]) {
        break;
      }
    }
    this.setIndex(i, mark)
    this.updateItems();
  }

  getIndexFromItem(item) {
    return $(".item").filter(":visible").index(item)
    //return $(item).parent().parent().index()-1
  }

  handleItemKey(event) {

    if(this.isPopupVisible) {
      return false;
    } else if (event.altKey && !event.metaKey) {
      if(event.code.startsWith("Digit")) {
        const num = parseInt(event.code.substr(5))-1;
        $("#bsky-navigator-search").autocomplete("disable");
        if (num >= 0) {
          const ruleName = Object.keys(this.state.rules)[num];
          console.log(ruleName);
          // const rule = this.state.rules[ruleName];
          $("#bsky-navigator-search").val("$" + ruleName);
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
        } else {
          const video = $(item).find('video')[0];
          if(video) {
            event.preventDefault();
            if (video.muted) {
              video.muted = false;
            }
            if (video.paused) {
              this.playVideo(video);
            } else {
              this.pauseVideo(video)
            }
          }
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
    }
    return event.key
  }

}

export class FeedItemHandler extends ItemHandler {

  INDICATOR_IMAGES = {
    loadTop: [
      "https://www.svgrepo.com/show/502348/circleupmajor.svg"
    ],
    loadBottom: [
      "https://www.svgrepo.com/show/502338/circledownmajor.svg"
    ],
    filter: [
      "https://www.svgrepo.com/show/347140/mail.svg",
      "https://www.svgrepo.com/show/347147/mail-unread.svg"
    ],
    sort: [
      "https://www.svgrepo.com/show/506581/sort-numeric-alt-down.svg",
      "https://www.svgrepo.com/show/506582/sort-numeric-up.svg"
    ],
    prev: [
      'https://www.svgrepo.com/show/491060/prev.svg'
    ],
    next: [
      'https://www.svgrepo.com/show/491054/next.svg'
    ],
    preferences: [
      "https://www.svgrepo.com/show/522235/preferences.svg",
      "https://www.svgrepo.com/show/522236/preferences.svg"
    ]
  }

  constructor(name, config, state, selector) {
    super(name, config, state, selector)
    this.toggleSortOrder = this.toggleSortOrder.bind(this);
    this.onSearchAutocomplete = this.onSearchAutocomplete.bind(this);
    this.setFilter = this.setFilter.bind(this);
  }

  addToolbar(beforeDiv) {

    // debugger;
    this.toolbarDiv = $(`<div id="bsky-navigator-toolbar"/>`);
    $(beforeDiv).before(this.toolbarDiv);

    this.topLoadIndicator = $(`
<div id="topLoadIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
</div>`);
    $(this.toolbarDiv).append(this.topLoadIndicator);

    this.sortIndicator = $(`<div id="sortIndicator" title="change sort order" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="sortIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.sort[0]}"/></div>`);
    $(this.toolbarDiv).append(this.sortIndicator);
    $('#sortIndicator').on("click", (event) => {
      event.preventDefault();
      this.toggleSortOrder();
    });

    this.filterIndicator = $(`<div id="filterIndicator" title="show all or unread" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="filterIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.filter[0]}"/></div>`);
    $(this.toolbarDiv).append(this.filterIndicator);
    $('#filterIndicator').on("click", (event) => {
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
        event.preventDefault(); // Prevent autocomplete from auto-filling input on hover
      },
      focus: function(event, ui) {
        event.preventDefault();
      },
      select: function(event, ui) {
        event.preventDefault(); // Prevent default selection behavior

        let input = this;
        let terms = splitTerms(input.value);
        terms.pop(); // Remove the last typed term
        terms.push(ui.item.value); // Add the selected suggestion
        input.value = terms.join(" ") + " "; // Ensure a space after selection

        $(this).autocomplete("close"); // Close the dropdown after selection
      }

    });

    $("#bsky-navigator-search").on("keydown", function(event) {
      if (event.key === "Tab") {
        let autocompleteMenu = $(".ui-autocomplete:visible");
        let firstItem = autocompleteMenu.children(".ui-menu-item").first();

        if (firstItem.length) {
          let uiItem = firstItem.data("ui-autocomplete-item"); // Get the first suggested item
          $(this).autocomplete("close"); // Close autocomplete after selection

          let terms = utils.splitTerms(this.value);
          terms.pop(); // Remove the last typed term
          terms.push(uiItem.value); // Add the selected suggestion
          this.value = terms.join(" ") + " "; // Ensure a space after selection
          event.preventDefault();
        }
      }
    });

    this.onSearchUpdate = utils.debounce( (event) => {
      console.log($(event.target).val().trim());
      this.setFilter($(event.target).val().trim());
      this.filterItems();
      this.updateInfoIndicator();
    }, 300);
    this.onSearchUpdate = this.onSearchUpdate.bind(this)
    $(this.searchField).on("input", this.onSearchUpdate);
    $(this.searchField).on("focus", function() {
      $(this).autocomplete("search", ""); // Trigger search with an empty string
    });
    // Trigger when autocomplete modifies the input
    $(this.searchField).on("autocompletechange autocompleteclose", this.onSearchUpdate);

    // Also trigger when an item is selected from autocomplete
    $(this.searchField).on("autocompleteselect", this.onSearchUpdate);

    // $(this.searchField).on("input", this.onSearchUpdate);

    waitForElement(
      "#bsky-navigator-toolbar",
      null,
      (div) => {
        this.addToolbar(beforeDiv);
      }
    )

  }

  refreshToolbars() {
    waitForElement(
      constants.TOOLBAR_CONTAINER_SELECTOR, (indicatorContainer) => {
        waitForElement(
          'div[data-testid="homeScreenFeedTabs"]',
          (homeScreenFeedTabsDiv) => {
            if (!$('#bsky-navigator-toolbar').length) {
              this.addToolbar(homeScreenFeedTabsDiv);
            }
          }
        );
      }
    )


    waitForElement(
      constants.STATUS_BAR_CONTAINER_SELECTOR,
      (statusBarContainer, observer) => {
        if (!$('#statusBar').length) {
          this.addStatusBar(statusBarContainer);
          observer.disconnect();
        }
      }
    );

    waitForElement(
      '#bsky-navigator-toolbar',
      (div) => {
        waitForElement(
          '#statusBar', (div) => { this.setSortIcons() }
        );
      }
    );
  }

  onSearchAutocomplete(request, response) {


    // debugger;
    const authors = this.getAuthors().sort((a, b) => a.handle.localeCompare(b.handle, undefined, {sensitivity: 'base'}));;
    const rules = Object.keys(this.state.rules);

    let term = utils.extractLastTerm(request.term).toLowerCase();
    let isNegation = term.startsWith("!"); // Check if `!` is present
    if (isNegation) term = term.substring(1); // Strip `!`

    let results = [];

    if (term === "") {
      results = rules.map(r => ({ label: `$${r}`, value: `$${r}` }));
    } else if (term.startsWith("@") || term.startsWith("$")) {
      let type = term.charAt(0);
      let search = term.substring(1).toLowerCase(); // Remove prefix for matching

      if (type === "@") {
        results = authors.filter(a =>
          a.handle.toLowerCase().includes(search) ||
            a.displayName.toLowerCase().includes(search)
        ).map(a => ({
          label: `${isNegation ? "!" : ""}@${a.handle} (${a.displayName})`,
          value: `${isNegation ? "!" : ""}@${a.handle}`
        }));
      } else if (type === "$") {
        results = rules.filter(r => r.toLowerCase().includes(search))
                       .map(r => ({
                         label: `${isNegation ? "!" : ""}$${r}`,
                       }));
      }
    }
    response(results);
  }

  addStatusBar(statusBarContainer) {
    // debugger;
    // console.log($('div[style="min-height: 100vh; padding-top: 0px;"]'));
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

    if (!this.prevButton) {
      this.prevButton = $(`<div id="prevButton" title="previous post" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="prevButtonImage" class="indicator-image" src="${this.INDICATOR_IMAGES.prev[0]}"/></div>`);
      $(this.statusBarLeft).append(this.prevButton);
      $('#prevButton').on("click", (event) => {
        event.preventDefault();
        this.jumpToPrev(true);
      });
    }

    if (!this.nextButton) {
      this.nextButton = $(`<div id="nextButton" title="next post" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="nextButtonImage" class="indicator-image" src="${this.INDICATOR_IMAGES.next[0]}"/></div>`);
      $(this.statusBarLeft).append(this.nextButton);
      $('#nextButton').on("click", (event) => {
        event.preventDefault();
        this.jumpToNext(true);
      });
    }


    if (!this.infoIndicator) {
      this.infoIndicator = $(`<div id="infoIndicator" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><span id="infoIndicatorText"/></div>`);
      $(this.statusBarCenter).append(this.infoIndicator);
    }

    if (!this.preferencesIcon) {
      this.preferencesIcon = $(`<div id="preferencesIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="preferencesIcon"><img id="preferencesIconImage" class="indicator-image preferences-icon-overlay" src="${this.INDICATOR_IMAGES.preferences[0]}"/></div></div>`);
      $(this.preferencesIcon).on("click", () => {
        $("#preferencesIconImage").attr("src", this.INDICATOR_IMAGES.preferences[1])
        this.config.open()
      });
      $(this.statusBarRight).append(this.preferencesIcon);
    }

  }

  activate() {
    super.activate();
    this.refreshToolbars();
  }

  deactivate() {
    super.deactivate();
  }

  isActive() {
    return window.location.pathname == "/"
  }

  toggleSortOrder() {
    this.state.stateManager.updateState({feedSortReverse: !this.state.feedSortReverse});
    this.setSortIcons();
    $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen");
    this.loadItems();
  }

  setSortIcons() {
    ["top", "bottom"].forEach(
      (bar) => {
        const which = (
          !this.state.feedSortReverse && bar == "bottom"
            ||
            this.state.feedSortReverse && bar == "top"
        ) ? "Older" : "Newer";
        const img = this.INDICATOR_IMAGES[`load${bar.toLowerCase().replace(/\b\w/g, char => char.toUpperCase())}`][0];
        $(`#${bar}LoadIndicator`).empty();
        $(`#${bar}LoadIndicator`).append(`
<div id="load${which}Indicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
      <span id="load${which}IndicatorText">
      <a id="load${which}IndicatorLink" title="Load ${which.toLowerCase()} items"><img id="load${which}IndicatorImage" class="indicator-image" src="${img}"/></a>
      </span>
</div>
`
                                        );
      }
    )
    $('img#loadOlderIndicatorImage').css("opacity", "1");
    $('a#loadOlderIndicatorLink').on("click", () => this.loadOlderItems());
  }

  toggleHideRead() {
    this.state.stateManager.updateState({feedHideRead: !this.state.feedHideRead})
    $(this.selector).closest("div.thread").removeClass("bsky-navigator-seen")
    this.loadItems();
  }

  setFilter(text) {
    this.filter = text;
  }

  filterItem(item, thread) {
    if(this.state.feedHideRead) {
      // console.log($(thread).children().index($(item).parent()));
      if($(item).hasClass("item-read")) {
        return false;
      }
    }

    if(this.filter && this.state.rules) {
      const activeRules = this.filter.split(/[ ]+/).map(
        (ruleStatement) => {
          const [_, invert, matchType, query] = ruleStatement.match(/(!)?([$@%])?"?([^"]+)"?/);
          return {
            invert,
            matchType,
            query
          }
        }
      );

      return activeRules.map(
        (activeRule) => {
          var allowed = null;
          switch (activeRule.matchType) {
            case '$':
              const rules = this.state.rules[activeRule.query];
              if (!rules) {
                console.log(`no rule ${activeRule.query}`);
                return null;
              }
              rules.forEach(rule => {
                // console.log(rule, allowed);
                if (rule.type === "all") {
                  allowed = rule.action === "allow";
                } else if (rule.type === "from" && !!this.filterAuthor(item, rule.value.substring(1))) {
                  allowed = allowed || rule.action === "allow";
                } else if (rule.type === "content" && !!this.filterContent(item, rule.value)) {
                  allowed = allowed || rule.action === "allow";
                }
              });
              break;
            case '@':
              allowed = !!this.filterAuthor(item, activeRule.query)
              break;
            case '%':
              allowed = !!this.filterContent(item, activeRule.query)
              break;
            default:
              allowed = !!this.filterAuthor(item, activeRule.query) || !!this.filterContent(item, activeRule.query)
              break;
          }
          return activeRule.invert ? !allowed : allowed;
        }
      ).every( (allowed) => allowed == true )

    }
    return true;
  }

  filterAuthor(item, author) {
    const pattern = new RegExp(author, "i");
    const handle = this.handleFromItem(item);
    const displayName = this.displayNameFromItem(item);
    // console.log(author, handle, displayName);
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
    return ($(thread).find(".item").length != $(thread).find(".filtered").length);
  }

  filterItems() {
    const hideRead = this.state.feedHideRead;
    $("#filterIndicatorImage").attr("src", this.INDICATOR_IMAGES.filter[+hideRead])
    $("#filterIndicator").attr("title", `show all or unread (currently ${hideRead ? 'unread' : 'all'})`);

    const parent = $(this.selector).first().closest(".thread").parent()
    const unseenThreads = parent.find(".thread");//.not("div.bsky-navigator-seen")
    $(unseenThreads).map(
      (i, thread) => {
        $(thread).find(".item").each(
          (i, item) => {
            if(this.filterItem(item, thread)) {
              $(item).removeClass("filtered");
            } else {
              $(item).addClass("filtered");
            }
          }
        )

        if(this.filterThread(thread)) {
          $(thread).removeClass("filtered");
        } else {
          $(thread).addClass("filtered");
        }

      }
    )
    this.refreshItems();
    if(hideRead && $(this.items[this.index]).hasClass("item-read")) {
      console.log("jumping")
      this.jumpToNextUnseenItem();
    }
  }

  sortItems() {
    const reversed = this.state.feedSortReverse
    $("#sortIndicatorImage").attr("src", this.INDICATOR_IMAGES.sort[+reversed])
    $("#sortIndicator").attr("title", `change sort order (currently ${reversed ? 'forward' : 'reverse'} chronological)`);

    const parent = $(this.selector).closest(".thread").first().parent()
    const newItems = parent.children().filter(
      (i, item) => $(item).hasClass("thread")
    ).get().sort(
      (a, b) => {
        const threadIndexA = parseInt($(a).data("bsky-navigator-thread-index"));
        const threadIndexB = parseInt($(b).data("bsky-navigator-thread-index"));
        const itemIndexA = parseInt($(a).find(".item").data("bsky-navigator-item-index"));
        const itemIndexB = parseInt($(b).find(".item").data("bsky-navigator-item-index"));
        // console.log(threadIndexA, threadIndexB, itemIndexA, itemIndexB);
        if (threadIndexA !== threadIndexB) {
          return reversed
            ? threadIndexB - threadIndexA
            : threadIndexA - threadIndexB;
        }
        return itemIndexA - itemIndexB;
      }
    );
    // debugger;
    (reversed ^ this.loadingNew) ? parent.prepend(newItems) : parent.children(".thread").last().next().after(newItems);
  }

  handleInput(event) {
    var item = this.items[this.index]
    if(event.key == "a") {
      $(item).find(constants.PROFILE_SELECTOR)[0].click()
    } else if(event.key == "u") {
      this.loadNewerItems();
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

export class PostItemHandler extends ItemHandler {

  constructor(name, config, state, selector) {
    super(name, config, state, selector)
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

  get scrollMargin() {
    return $('div[data-testid="postThreadScreen"] > div').eq(0).outerHeight();
  }

  // getIndexFromItem(item) {
  //     return $(item).parent().parent().parent().parent().index() - 3
  // }

  handleInput(event) {

    if (["o", "Enter"].includes(event.key) && !(event.altKey || event.metaKey) ) {
      // o/Enter = open inner post
      var inner = $(item).find("div[aria-label^='Post by']")
      inner.click()
    }

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
    }

  }
}

export class ProfileItemHandler extends ItemHandler {

  constructor(name, config, state, selector) {
    super(name, config, state, selector)
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
