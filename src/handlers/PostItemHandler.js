// PostItemHandler.js - Handler for individual post/thread pages

import { ItemHandler, PENDING_REPLY_KEY } from './ItemHandler.js';
import { isUserTyping, isModalOpen } from '../utils.js';

const THREAD_SCREEN_SELECTOR = 'div[data-testid="postThreadScreen"]';
const REPLY_BUTTON_WAIT_MS = 5000;

/** True if the element is in the page and not hidden (e.g. on a screen Bluesky keeps). */
function isShown(element) {
  return !!element?.isConnected && element.offsetParent !== null;
}

/**
 * Handler for viewing individual posts and their thread replies.
 */
export class PostItemHandler extends ItemHandler {
  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
    // Post ID from the URL of the thread the current selection belongs to
    this.threadPostId = null;
    this.stopPinningUrlPost = null;
    // Post last selected on each thread's screens, by the thread's URL post ID (most recent
    // last): a list of { postId, element }, one per screen still in the page (the same thread
    // can be in the history stack twice), with a weak reference to the selected element
    this.threadSelections = new Map();
    // Post to select instead of the URL post when going Back/Forward to a thread seen before
    this.historyRestorePostId = null;
    // Back/Forward: leave the scroll position Bluesky restored if the selection is in view
    this.keepHistoryScroll = false;
    // URL of the last Back/Forward navigation, until a thread change, URL change or leaving
    // post pages uses it
    this.historyNavUrl = null;
    this.urlChangeLoadTimeout = null;
    // Set on leaving post pages, so activate() can tell a return from the composer apart
    this.leftPostPages = false;
    window.addEventListener('popstate', () => {
      this.historyNavUrl = window.location.href;
    });
    this.handleInput = this.handleInput.bind(this);
  }

  deactivate() {
    this.stopPinningUrlPost?.();
    this.cancelPendingReplyWait();
    clearTimeout(this.urlChangeLoadTimeout);
    // Leaving post pages (not just focusing the composer)
    if (!this.isActive()) {
      this.rememberThreadSelection();
      // Only a Back/Forward onto the post page being entered counts
      this.historyNavUrl = null;
      this.leftPostPages = true;
    }
    super.deactivate();
  }

  activate() {
    super.activate();
    if (!this.leftPostPages) return; // Back from the composer: still the same page
    this.leftPostPages = false;
    const fromHistory = this.historyNavUrl === window.location.href;
    if (
      fromHistory &&
      this.postIdFromUrl() === this.threadPostId &&
      isShown(this.selectedItem?.[0])
    ) {
      // Back/Forward to the screen Bluesky kept for this thread: its selection still stands.
      // Restore its style, in case the previous page's handler restyled these posts.
      this.historyNavUrl = null;
      this.takePendingReply();
      $(this.items)
        .not(this.selectedItem)
        .filter('.item-selection-active')
        .each((i, item) => this.applyItemStyle(item, false));
      this.applyItemStyle(this.selectedItem, true);
      return;
    }
    // Any other screen: the next load starts the thread fresh
    this.threadPostId = null;
    // Another thread's kept screen adds no post nodes, so the item observer won't load
    if (fromHistory) this.onUrlChange();
  }

  /**
   * Called when the URL changes while the post context stays active (post → post), and
   * on Back/Forward onto a post page from another page.
   * Back/Forward shows a post screen Bluesky kept hidden without adding post nodes, so
   * the item observer never reloads; reload here instead. A new post page adds its
   * nodes, and the observer's load selects its URL post once they render.
   */
  onUrlChange() {
    clearTimeout(this.urlChangeLoadTimeout);
    const fromHistory = this.historyNavUrl === window.location.href;
    if (!this.hasStaleItems() && !(fromHistory && this.postIdFromUrl() !== this.threadPostId)) {
      this.historyNavUrl = null;
      return;
    }
    // Until Bluesky has swapped screens (the old selection removed or hidden), a load
    // would collect the old screen's posts
    let tries = 0;
    const load = () => {
      const old = this.selectedItem?.[0];
      if (old?.isConnected && old.offsetParent !== null && ++tries < 20) {
        this.urlChangeLoadTimeout = setTimeout(load, 100);
        return;
      }
      this.loadItems({ preserveSelection: true });
    };
    load();
  }

  /**
   * True if the items belong to a screen Bluesky removed (or, with includeHidden, one it
   * hid under a newer screen).
   */
  hasStaleItems(includeHidden = false) {
    const first = $(this.items).get(0);
    return !!first && (!first.isConnected || (includeHidden && first.offsetParent === null));
  }

  loadItems(restoreTarget) {
    this.resetSelectionForNewThread();
    super.loadItems(restoreTarget);
  }

  _doLoadItems(restoreTarget) {
    const hadSelection = this._index != null;
    super._doLoadItems(restoreTarget);
    if (!hadSelection && this._index != null) {
      // Only the first selection on a thread is a Back/Forward restore
      this.keepHistoryScroll = false;
      this.historyRestorePostId = null;
      if (this.postId === this.threadPostId) {
        this.pinUrlPost(this.selectedItem[0]);
        this.consumePendingReply();
      }
    }
  }

  /** Read and remove the pending reply (see openReplyForSidecarReply) if it hasn't expired. */
  takePendingReply() {
    try {
      const raw = window.sessionStorage.getItem(PENDING_REPLY_KEY);
      if (raw == null) return null;
      window.sessionStorage.removeItem(PENDING_REPLY_KEY);
      const entry = JSON.parse(raw);
      return entry?.expiresAt > Date.now() ? entry : null;
    } catch {
      return null;
    }
  }

  cancelPendingReplyWait() {
    clearTimeout(this.pendingReplyTimeout);
    this.pendingReplyTimeout = null;
  }

  /**
   * After the URL post is selected on a fresh visit: if `r` on a sidecar reply sent us
   * here, open the reply dialog on that post once its reply button renders. Any other
   * page or an expired entry just drops the entry.
   */
  consumePendingReply() {
    this.cancelPendingReplyWait();
    const entry = this.takePendingReply();
    if (!entry || entry.postId !== this.postIdFromUrl()) return;
    const post = this.selectedItem[0];
    const deadline = Date.now() + REPLY_BUTTON_WAIT_MS;
    const tryOpen = () => {
      this.pendingReplyTimeout = null;
      // Gone: the user moved on (another post, other page)
      if (
        !post.isConnected ||
        this.selectedItem[0] !== post ||
        this.postIdFromUrl() !== entry.postId
      ) {
        return;
      }
      if ($(post).find("button[aria-label^='Reply']").length) {
        this.openReplyDialog(post);
      } else if (Date.now() < deadline) {
        this.pendingReplyTimeout = setTimeout(tryOpen, 100);
      }
    };
    tryOpen();
  }

  updateItems() {
    // Back/Forward restore: Bluesky has already put the page back where it was
    if (this.keepHistoryScroll) {
      this.keepHistoryScroll = false;
      if (this.isElementInView(this.selectedItem)) return Promise.resolve();
    }
    return super.updateItems();
  }

  /**
   * True if at least half the element (or half the viewport, for a tall one) shows
   * between the header and status bar.
   * @param {Element|jQuery} element
   */
  isElementInView(element) {
    const el = $(element).get(0);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const top = this.getToolbarHeight();
    const bottom = window.innerHeight - this.getStatusBarHeight();
    const shown = Math.min(rect.bottom, bottom) - Math.max(rect.top, top);
    return rect.height > 0 && shown > 0 && shown >= Math.min(rect.height, bottom - top) / 2;
  }

  /**
   * Remember the selected post for the current thread, so Back/Forward can restore it.
   */
  rememberThreadSelection() {
    const element = this.selectedItem?.[0];
    if (!this.threadPostId || !this.postId || !element) return;
    // Replace this screen's entry; drop entries for screens Bluesky removed
    const screen = element.closest(THREAD_SCREEN_SELECTOR);
    const entries = (this.threadSelections.get(this.threadPostId) || []).filter((entry) => {
      const el = entry.element.deref();
      return el?.isConnected && el.closest(THREAD_SCREEN_SELECTOR) !== screen;
    });
    entries.push({ postId: this.postId, element: new window.WeakRef(element) });
    this.threadSelections.delete(this.threadPostId);
    this.threadSelections.set(this.threadPostId, entries);
    if (this.threadSelections.size > 50) {
      this.threadSelections.delete(this.threadSelections.keys().next().value);
    }
  }

  /**
   * Keep the URL's post where it is while parent posts render above it. Bluesky anchors
   * it itself only when it's at the top on the first layout, and browsers don't anchor
   * scrolling at scrollY 0 (or at all, in Safari). Stops on user input, when the
   * selection moves, or after a few seconds.
   * @param {Element} post
   */
  pinUrlPost(post) {
    this.stopPinningUrlPost?.();
    const screen = post?.closest('div[data-testid="postThreadScreen"]');
    if (!screen) return;

    let docTop = post.getBoundingClientRect().top + window.scrollY;
    const keepInPlace = () => {
      if (!document.contains(post) || this.selectedItem[0] !== post) {
        stop();
        return;
      }
      const top = post.getBoundingClientRect().top + window.scrollY;
      if (Math.abs(top - docTop) >= 1) {
        // Content above it changed height: scroll by the same amount
        window.scrollBy(0, top - docTop);
        docTop = top;
      }
    };
    const resizeObserver = new window.ResizeObserver(keepInPlace);
    resizeObserver.observe(screen);
    const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    const stop = () => {
      resizeObserver.disconnect();
      clearTimeout(timeout);
      userEvents.forEach((type) => window.removeEventListener(type, stop, true));
      if (this.stopPinningUrlPost === stop) this.stopPinningUrlPost = null;
    };
    const timeout = setTimeout(stop, 10000);
    userEvents.forEach((type) => window.addEventListener(type, stop, true));
    this.stopPinningUrlPost = stop;
  }

  /**
   * The handler outlives the page: clear the selection when a different thread is shown
   * so the first load selects that thread's URL post instead of a stale index.
   */
  resetSelectionForNewThread() {
    const urlPostId = this.postIdFromUrl();
    if (urlPostId === this.threadPostId) return;
    this.rememberThreadSelection();
    // Back/Forward to a screen Bluesky kept (the element selected on it is shown again)
    // restores the post last selected there. A screen it renders again (Forward, or one it
    // dropped) is scrolled to its URL post, as on a new visit, so select that.
    const fromHistory = this.historyNavUrl === window.location.href;
    this.historyNavUrl = null;
    // A Back/Forward visit isn't the one `r` asked for
    this.cancelPendingReplyWait();
    if (fromHistory) this.takePendingReply();
    const saved = fromHistory
      ? this.threadSelections.get(urlPostId)?.find((entry) => isShown(entry.element.deref()))
      : null;
    const kept = !!saved;
    this.historyRestorePostId = kept ? saved.postId : null;
    this.keepHistoryScroll = kept;
    this.threadPostId = urlPostId;
    this.stopPinningUrlPost?.();
    if (this._index != null && this.selectedItem.length) {
      this.applyItemStyle(this.selectedItem, false);
    }
    this.initSelection();
  }

  getInitialTargetPostId() {
    const items = $(this.items).get();
    const restoreId = this.historyRestorePostId;
    const restoreItem = restoreId && items.find((item) => this.postIdForItem(item) === restoreId);
    if (this.keepHistoryScroll && window.scrollY > 0 && !this.isElementInView(restoreItem)) {
      // Back/Forward with the scroll position restored: select what's on screen, don't move
      const inView = items.filter((item) => this.isElementInView(item));
      const top = inView.find(
        (item) => item.getBoundingClientRect().top >= this.getToolbarHeight() - 2
      );
      if (top || inView[0]) return this.postIdForItem(top || inView[0]);
    }
    return restoreItem ? restoreId : this.postIdFromUrl();
  }

  isActive() {
    return window.location.pathname.match(/\/post\//);
  }

  /**
   * Post pages hide the navigator toolbar; Bluesky's sticky post header covers the top
   * instead. Jumps (scroll-margin-top) and the j/k visibility check both use this, so a
   * post a jump lands on counts as fully visible on the next press.
   */
  getToolbarHeight() {
    const header = $('div[data-testid="postThreadScreen"] > div:visible').eq(0);
    if (!header.length) return super.getToolbarHeight();
    // Room for the focus ring, as measureToolbarHeight leaves
    return header.outerHeight() + 4;
  }

  handleInput(event) {
    // Skip processing when user is typing in an input field
    if (isUserTyping()) {
      return true; // Return true to signal callers to also skip
    }

    // Skip processing when a modal dialog is open
    if (isModalOpen()) {
      return true;
    }

    // Safety net: the items went stale (removed, or hidden under a newer screen) before a
    // load caught up; rebuild them first
    if (this.hasStaleItems(true)) {
      this.resetSelectionForNewThread();
      this._doLoadItems({ preserveSelection: true });
    }

    const item = this.selectedItem;

    if (['o', 'Enter'].includes(event.key) && !(event.altKey || event.metaKey || event.ctrlKey)) {
      const inner = $(item).find("div[aria-label^='Post by']");
      inner.click();
    }

    if (super.handleInput(event)) {
      return;
    }

    if (this.isPopupVisible || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    if (event.key == 'A') {
      // Go to author's profile
      const handle = $.trim($(item).attr('data-testid').split('postThreadItem-by-')[1]);
      $(item)
        .find('div')
        .filter(
          (i, el) =>
            $.trim($(el).text()).replace(/[\u200E\u200F\u202A-\u202E]/g, '') == `@${handle}`
        )[0]
        .click();
    } else if (event.key == 'a') {
      // Show/hide author hover card by simulating mouse hover
      this.toggleAuthorHoverCard(item);
    }
  }
}
