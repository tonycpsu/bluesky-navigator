// ItemHandler.js - Base handler for item-based navigation (feed items, posts, etc.)

import constants from '../constants.js';
import * as utils from '../utils.js';
import * as dateFns from 'date-fns';
import Handlebars from 'handlebars';
import html2canvas from 'html2canvas';
import { Handler } from './Handler.js';
import { formatPost, urlForPost } from './postFormatting.js';
import { GestureHandler } from '../components/GestureHandler.js';
import { BottomSheet } from '../components/BottomSheet.js';
import { PostViewModal } from '../components/PostViewModal.js';

const { waitForElement, announceToScreenReader, getAnimationDuration } = utils;

/**
 * Extract post ID from a URL path segment.
 * @param {string} url - URL containing /post/ID pattern
 * @returns {string|null} The post ID or null
 */
function extractPostIdFromUrl(url) {
  const match = url.match(/post\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Handler for navigating and interacting with scrollable item lists.
 * Provides keyboard navigation, mouse hover selection, intersection observers,
 * sidecar rendering, and various item actions (like, repost, reply, etc.).
 */
export class ItemHandler extends Handler {
  POPUP_MENU_SELECTOR = "div[aria-label^='Context menu backdrop']";
  THREAD_PAGE_SELECTOR = 'main > div > div > div';

  FLOATING_BUTTON_IMAGES = {
    prev: ['https://www.svgrepo.com/show/238452/up-arrow.svg'],
    next: ['https://www.svgrepo.com/show/238463/down-arrow-multimedia-option.svg'],
  };

  constructor(name, config, state, api, selector) {
    super(name, config, state, api);
    this.selector = selector;
    this.initSelection();
    this.initSidecarTemplates();

    this.loadNewerCallback = null;
    this.debounceTimeout = null;
    this.isPopupVisible = false;
    this.ignoreMouseMovement = false;
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
    this.selfThreadCache = {}; // Cache for API-detected self-threads (postId -> true)
    this.unrolledPostIds = new Set(); // Track post IDs shown in unrolled threads

    // Hover debounce for mouse focus
    this.hoverDebounceTimeout = null;
    this.hoverDebounceDelay = 100; // ms

    // Track user-initiated scrolling (mouse wheel/touchpad)
    this.userInitiatedScroll = false;

    // Initialize gesture handler and bottom sheet for mobile
    if (this.state.mobileView && this.config.get('enableSwipeGestures')) {
      this.gestureHandler = new GestureHandler(this.config, this);
      this.bottomSheet = new BottomSheet(this.config, this);
    }

    // Bind methods
    this.onPopupAdd = this.onPopupAdd.bind(this);
    this.onPopupRemove = this.onPopupRemove.bind(this);
    this.onIntersection = this.onIntersection.bind(this);
    this.onFooterIntersection = this.onFooterIntersection.bind(this);
    this.onItemAdded = this.onItemAdded.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.handleNewThreadPage = this.handleNewThreadPage.bind(this);
    this.onItemMouseOver = this.onItemMouseOver.bind(this);
    this.onSidecarItemMouseOver = this.onSidecarItemMouseOver.bind(this);
    this.getTimestampForItem = this.getTimestampForItem.bind(this);
    this.onWheel = this.onWheel.bind(this);
  }

  isActive() {
    return false;
  }

  activate() {
    this.keyState = [];
    this.popupObserver = waitForElement(
      this.POPUP_MENU_SELECTOR,
      this.onPopupAdd,
      this.onPopupRemove
    );

    this.setupIntersectionObservers();
    this.setupItemObserver();
    this.setupLoadNewerObserver();
    this.setupFloatingButtons();

    this.enableScrollMonitor = true;
    this.enableIntersectionObserver = true;
    $(document).on('scroll', this.onScroll);
    $(document).on('wheel', this.onWheel);
    $(document).on('scrollend', () => {
      setTimeout(() => {
        this.ignoreMouseMovement = false;
        this.userInitiatedScroll = false;
      }, 500);
    });

    super.activate();
  }

  deactivate() {
    if (this.floatingButtonsObserver) this.floatingButtonsObserver.disconnect();
    if (this.observer) this.observer.disconnect();
    if (this.popupObserver) this.popupObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    this.disableFooterObserver();

    if (this.hoverDebounceTimeout) clearTimeout(this.hoverDebounceTimeout);
    if (this.intersectionDebounceTimeout) clearTimeout(this.intersectionDebounceTimeout);

    $(this.selector).off('mouseover mouseleave');
    $(document).off('scroll', this.onScroll);
    $(document).off('wheel', this.onWheel);
    super.deactivate();
  }

  // ===========================================================================
  // Selection State Management
  // ===========================================================================

  initSelection() {
    this._index = null;
    this._replyIndex = null;
    this._threadIndex = null;
    this.postId = null;
  }

  set index(value) {
    this._index = value;
    this._threadIndex = null;
    this.postId = this.postIdForItem(this.selectedItem);
    this.updateInfoIndicator();
  }

  get index() {
    return this._index;
  }

  get selectedItem() {
    return $(this.items[this.index]);
  }

  getReplyForIndex(index) {
    return this.selectedItem.closest('.thread').find('.sidecar-post').eq(index);
  }

  get selectedReply() {
    return this.getReplyForIndex(this.replyIndex);
  }

  get replyIndex() {
    return this._replyIndex;
  }

  set replyIndex(value) {
    const oldIndex = this._replyIndex;
    const replies = $(this.selectedItem).parent().find('div.sidecar-post');
    if (value == oldIndex || value < 0 || value >= replies.length) {
      return;
    }
    if (oldIndex != null) {
      replies.eq(oldIndex).removeClass('reply-selection-active');
    }
    this._replyIndex = value;
    if (this.replyIndex == null) {
      $(this.selectedItem).addClass('item-selection-active');
      $(this.selectedItem).removeClass('item-selection-child-focused');
      replies.removeClass('reply-selection-active');
    } else {
      const selectedReply = replies.eq(this.replyIndex);
      if (selectedReply.length) {
        $(this.selectedItem).addClass('item-selection-child-focused');
        $(this.selectedItem).removeClass('item-selection-active');
        selectedReply.addClass('reply-selection-active');
        this.scrollToElement(selectedReply[0], 'nearest');
      }
    }
  }

  get threadIndex() {
    return this._threadIndex;
  }

  set threadIndex(value) {
    const oldIndex = this._threadIndex;
    if (value == oldIndex) {
      return;
    } else if (value < 0) {
      this._threadIndex = null;
      this.setIndex(this.index - 1, false, true);
      return;
    } else if (value > this.unrolledReplies.length) {
      this._threadIndex = null;
      this.setIndex(this.index + 1, false, true);
      return;
    }
    if (oldIndex != null) {
      this.getPostForThreadIndex(oldIndex).removeClass('reply-selection-active');
    }
    this._threadIndex = value;
    if (this.threadIndex == null) {
      $(this.selectedItem).addClass('item-selection-active');
      $(this.selectedItem).removeClass('item-selection-child-focused');
    } else {
      if (this.unrolledReplies.length && this.selectedPost) {
        $(this.selectedItem).addClass('item-selection-child-focused');
        $(this.selectedItem).removeClass('item-selection-active');
        this.selectedPost.addClass('reply-selection-active');
        // When at first post (index 0), scroll to show top of entire thread container
        // For other posts, scroll to the specific reply
        if (value === 0) {
          const threadContainer = $(this.selectedItem).closest('.thread')[0];
          const target = threadContainer || $(this.selectedItem)[0];
          // Use window.scrollTo to ensure thread top is visible accounting for toolbar
          const rect = target.getBoundingClientRect();
          const scrollTop = window.pageYOffset + rect.top - this.scrollMargin;
          window.scrollTo({
            top: Math.max(0, scrollTop),
            behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant'
          });
        } else {
          this.scrollToElement(this.selectedPost[0], 'nearest');
        }
      } else {
        return;
      }
    }
    this.updateInfoIndicator();
  }

  get unrolledReplies() {
    return $(this.selectedItem).find('.unrolled-reply');
  }

  getPostForThreadIndex(index) {
    return index > 0
      ? this.unrolledReplies.eq(index - 1)
      : $(this.selectedItem).find(constants.POST_CONTENT_SELECTOR).first();
  }

  get selectedPost() {
    return this.getPostForThreadIndex(this.threadIndex);
  }

  setIndex(index, mark, update, skipSidecar = false) {
    const oldIndex = this.index;
    if (index == oldIndex) {
      return;
    }
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
    this.applyItemStyle(this.selectedItem, true);

    if (!skipSidecar) {
      this.expandItem(this.selectedItem);
    }

    $(this.selectedItem)
      .find('video')
      .each((_i, video) => {
        const playbackMode = this.config.get('videoPreviewPlayback');
        if (playbackMode === 'Pause all') {
          this.pauseVideo(video);
        } else if (playbackMode === 'Play selected') {
          this.playVideo(video);
        }

        if (this.config.get('videoDisableLoop')) {
          video.removeAttribute('autoplay');
          video.addEventListener('ended', function () {
            video.load();
          });
        }
      });

    if (update) {
      this.updateItems();
    }
    return true;
  }

  getIndexFromItem(item) {
    return $(this.items).index(item);
  }

  getSidecarIndexFromItem(item) {
    return $(item).closest('.thread').find('.sidecar-post').filter(':visible').index(item);
  }

  // ===========================================================================
  // Sidecar & Thread Unrolling
  // ===========================================================================

  initSidecarTemplates() {
    waitForElement('#sidecar-replies-template', () => {
      this.repliesTemplate = Handlebars.compile($('#sidecar-replies-template').html());
    });
    waitForElement('#sidecar-post-template', () => {
      this.postTemplate = Handlebars.compile($('#sidecar-post-template').html());
      Handlebars.registerPartial('postTemplate', this.postTemplate);
    });
    waitForElement('#sidecar-body-template', () => {
      this.bodyTemplate = Handlebars.compile($('#sidecar-body-template').html());
      Handlebars.registerPartial('bodyTemplate', this.bodyTemplate);
    });
    waitForElement('#sidecar-footer-template', () => {
      this.footerTemplate = Handlebars.compile($('#sidecar-footer-template').html());
      Handlebars.registerPartial('footerTemplate', this.footerTemplate);
    });
    waitForElement('#sidecar-post-counts-template', () => {
      this.postCountsTemplate = Handlebars.compile($('#sidecar-post-counts-template').html());
      Handlebars.registerPartial('postCountsTemplate', this.postCountsTemplate);
    });
    waitForElement('#sidecar-embed-image-template', () => {
      this.imageTemplate = Handlebars.compile($('#sidecar-embed-image-template').html());
      Handlebars.registerPartial('imageTemplate', this.imageTemplate);
    });
    waitForElement('#sidecar-embed-quote-template', () => {
      this.quoteTemplate = Handlebars.compile($('#sidecar-embed-quote-template').html());
      Handlebars.registerPartial('quoteTemplate', this.quoteTemplate);
    });
    waitForElement('#sidecar-embed-external-template', () => {
      this.externalTemplate = Handlebars.compile($('#sidecar-embed-external-template').html());
      Handlebars.registerPartial('externalTemplate', this.externalTemplate);
    });
    waitForElement('#sidecar-skeleton-template', () => {
      this.skeletonTemplate = Handlebars.compile($('#sidecar-skeleton-template').html());
    });
  }

  getSkeletonContent() {
    if (this.skeletonTemplate) {
      return this.skeletonTemplate({});
    }
    // Fallback if template not loaded yet
    return `<div class="sidecar-replies sidecar-skeleton" role="status" aria-label="Loading replies">
      <div class="skeleton-post">
        <div class="skeleton-header">
          <div class="skeleton-avatar skeleton-shimmer"></div>
          <div class="skeleton-author">
            <div class="skeleton-line skeleton-line-short skeleton-shimmer"></div>
            <div class="skeleton-line skeleton-line-medium skeleton-shimmer"></div>
          </div>
        </div>
        <div class="skeleton-body">
          <div class="skeleton-line skeleton-line-full skeleton-shimmer"></div>
          <div class="skeleton-line skeleton-line-full skeleton-shimmer"></div>
          <div class="skeleton-line skeleton-line-medium skeleton-shimmer"></div>
        </div>
      </div>
      <span class="sr-only">Loading replies...</span>
    </div>`;
  }

  shouldUnroll(_item) {
    return this.config.get('unrollThreads');
  }

  shouldShowSidecar(item) {
    return (
      this.config.get('showReplySidecar') &&
      $(item).closest('.thread').outerWidth() >= this.config.get('showReplySidecarMinimumWidth')
    );
  }

  shouldExpand(item) {
    // Fetch thread data if either sidecar or unroll is enabled
    return this.shouldShowSidecar(item) || this.shouldUnroll(item);
  }

  async expandItem(item) {
    if (!this.shouldExpand(item)) {
      return;
    }
    const thread = await this.getThreadForItem(item);
    if (!thread) {
      return;
    }
    // Unroll setting controls visual rearrangement
    if (this.shouldUnroll(item)) {
      await this.unrollThread(item, thread, true);
    }
    // Sidecar setting controls showing replies panel
    if (this.shouldShowSidecar(item)) {
      await this.showSidecar(item, thread, true);
    }
  }

  async unrollThread(item, thread) {
    console.log(
      thread.parent,
      thread.parent?.post,
      thread.parent?.post?.author?.did,
      thread.post?.author?.did
    );

    if (
      thread.parent &&
      thread.parent.post &&
      thread.parent.post.author.did == thread.post.author.did
    ) {
      return;
    }
    if (thread.replies.map((r) => r.post && r.post.author.did).includes(thread.post.author.did)) {
      // Cache this post as a self-thread for feed map display
      const postId = this.postIdForItem(item);
      if (postId) {
        this.selfThreadCache[postId] = true;
        // Update scroll indicator to show thread icon (if method exists in subclass)
        if (typeof this.updateScrollIndicator === 'function') {
          this.updateScrollIndicator();
        }
      }
      const unrolledPosts = await this.api.unrollThread(thread);
      const parent = $(item).find('div[data-testid="contentHider-post"]').first().parent();
      parent.css({ 'overflow-y': 'scroll', 'max-height': '80vH', 'padding-top': '1em' });
      let div = $(parent).find('div.unrolled-replies');
      if ($(div).length) {
        $(div).empty();
      } else {
        div = $('<div class="unrolled-replies"/>');
        parent.append(div);
      }
      const totalPosts = unrolledPosts.length;
      // Track post IDs of unrolled replies to filter duplicates from main feed
      const unrolledIds = [];
      unrolledPosts.slice(1).map((p, i) => {
        const postNum = i + 2;
        const postId = p.uri.split('/').slice(-1)[0];
        unrolledIds.push(postId);
        this.unrolledPostIds.add(postId);

        const reply = $('<div class="unrolled-reply"/>');
        reply.attr('data-unrolled-post-id', postId);
        reply.append($('<hr class="unrolled-divider"/>'));
        reply.append(
          $(
            `<a href="${urlForPost(p)}" class="unrolled-post-number" title="Post ${postNum} of ${totalPosts}">${postNum}<span class="unrolled-post-total">/${totalPosts}</span></a>`
          )
        );
        reply.append($(this.bodyTemplate(formatPost(p))));
        reply.append($(this.footerTemplate(formatPost(p))));
        div.append(reply);
      });
      const threadIndex = $(item).closest('.thread').data('bsky-navigator-thread-index');

      // Filter out feed items that are now shown as unrolled replies
      this.items.each((i, feedItem) => {
        const feedItemPostId = this.postIdForItem(feedItem);
        if (feedItemPostId && unrolledIds.includes(feedItemPostId)) {
          $(feedItem).addClass('filtered unrolled-duplicate');
          $(feedItem).closest('.thread').addClass('has-unrolled-duplicate');
        }
      });

      function isRedundant(item, threadIndex) {
        return (
          $(item).data('bsky-navigator-thread-offset') != 0 &&
          $(item).closest('.thread').data('bsky-navigator-thread-index') == threadIndex
        );
      }
      this.items.each((i, item) => {
        if (isRedundant(item, threadIndex)) {
          console.log('filtered', item);
          $(item).addClass('filtered');
        }
      });
      // Filter out both redundant items and unrolled duplicates
      this.items = this.items.filter((i, item) => {
        if (isRedundant(item, threadIndex)) return false;
        if ($(item).hasClass('unrolled-duplicate')) return false;
        return true;
      });
      // Show focus on first post without scrolling (set directly to skip setter's scroll)
      this._threadIndex = 0;
      $(this.selectedItem).addClass('item-selection-child-focused');
      $(this.selectedItem).removeClass('item-selection-active');
      if (this.selectedPost) {
        this.selectedPost.addClass('reply-selection-active');
      }
    }
  }

  async getSidecarContent(item, thread) {
    if (!item) {
      return this.repliesTemplate({});
    }

    const post = thread.post;

    const replies = thread.replies
      .filter((reply) => reply.post)
      .map((reply) => reply?.post)
      .sort((a, b) => {
        switch (this.config.get('sidecarReplySortOrder')) {
          case 'Default':
            return 0;
          case 'Oldest First':
            return new Date(a.record.createdAt) - new Date(b.record.createdAt);
          case 'Newest First':
            return new Date(b.record.createdAt) - new Date(a.record.createdAt);
          case 'Most Liked First':
            return b.likeCount - a.likeCount;
          case 'Most Reposted First':
            return b.repostCount - a.repostCount;
          default:
            console.error(`unknown sort order: ${this.config.get('sidecarReplySortOrder')}`);
        }
      })
      .map(formatPost);

    return this.repliesTemplate({
      postId: post.cid,
      parent: thread.parent ? formatPost(thread.parent.post) : null,
      replies: replies,
    });
  }

  async showSidecar(item, thread, action = null) {
    const container = $(item).parent();

    // Prevent duplicate sidecars - use data attribute as lock
    const itemKey = this.postIdForItem(item) || Date.now();
    if (container.data('sidecar-loading') === itemKey) {
      return; // Already loading for this item
    }
    container.data('sidecar-loading', itemKey);

    // Remove ALL existing sidecars first to prevent duplicates
    container.find('.sidecar-replies').remove();

    // Show skeleton while loading
    const skeletonContent = this.getSkeletonContent();
    $(container).append(skeletonContent);

    // Load actual content
    const sidecarContent = await this.getSidecarContent(item, thread);
    console.log(sidecarContent);

    // Remove skeleton and add actual content (in case multiple skeletons were added)
    container.find('.sidecar-replies').remove();
    container.append($(sidecarContent));
    container.find('.sidecar-post').each((i, post) => {
      $(post).on('mouseover', this.onSidecarItemMouseOver);
    });

    // Initialize collapsible sections
    container.find('.sidecar-section-toggle').each((i, toggle) => {
      $(toggle).on('click', (e) => {
        e.preventDefault();
        const btn = $(e.currentTarget);
        const contentId = btn.attr('aria-controls');
        const content = $(`#${contentId}`);
        const isExpanded = btn.attr('aria-expanded') === 'true';

        btn.attr('aria-expanded', !isExpanded);
        btn.find('.sidecar-section-icon').text(isExpanded ? '▶' : '▼');

        if (isExpanded) {
          content.slideUp(getAnimationDuration(200, this.config));
        } else {
          content.slideDown(getAnimationDuration(200, this.config));
        }
      });
    });

    const sidecar = container.find('.sidecar-replies')[0];
    const display =
      action == null
        ? sidecar && $(sidecar).is(':visible')
          ? 'none'
          : 'flex'
        : action
          ? 'flex'
          : 'none';
    console.log(display);
    container.find('.sidecar-replies').css('display', display);

    // Clear the loading lock
    container.removeData('sidecar-loading');
  }

  // ===========================================================================
  // Keyboard Handling
  // ===========================================================================

  handleInput(event) {
    if (this.handleMovementKey(event)) {
      return event.key;
    } else if (this.handleItemKey(event)) {
      return event.key;
    } else if (event.key == 'U') {
      this.loadOlderItems();
    } else {
      return super.handleInput(event);
    }
  }

  handleItemKey(event) {
    if (this.isPopupVisible) {
      return false;
    }

    if (event.altKey && !event.metaKey) {
      return this.handleRuleShortcut(event);
    }

    if (!event.metaKey) {
      return this.handleItemAction(event);
    }

    return false;
  }

  handleRuleShortcut(event) {
    if (!event.code.startsWith('Digit')) {
      return false;
    }

    const num = parseInt(event.code.substr(5)) - 1;
    $('#bsky-navigator-search').autocomplete('disable');

    if (num >= 0) {
      const ruleName = Object.keys(this.state.rules)[num];
      $('#bsky-navigator-search').val(`${event.shiftKey ? '!' : ''}$${ruleName}`);
    } else {
      $('#bsky-navigator-search').val(null);
    }

    $('#bsky-navigator-search').trigger('input');
    $('#bsky-navigator-search').autocomplete('enable');
    return event.key;
  }

  handleItemAction(event) {
    const item = this.selectedItem;

    switch (event.key) {
      case 'o':
      case 'Enter':
        this.openCurrentItem(item);
        break;

      case 'O':
        this.openInnerPost(item);
        break;

      case 'i':
        this.openFirstLink(item);
        break;

      case 'm':
        this.toggleMedia(item, event);
        break;

      case 'r':
        this.openReplyDialog(item);
        break;

      case 'l':
        this.handleLikeAction(item);
        break;

      case 'p':
        this.openRepostMenu(item);
        break;

      case 'P':
        this.repostImmediately(item);
        break;

      case '.':
        this.markItemRead(this.index, null);
        break;

      case 'A':
        this.markVisibleRead();
        break;

      case ';':
        if (this.api) {
          this.expandItem(this.selectedItem);
        }
        break;

      case 'c':
        this.captureScreenshot(item[0]);
        break;

      case 'v':
        this.showPostViewModal(item);
        break;

      case 'V':
        this.showReaderModeModal(item);
        break;

      default:
        if (!isNaN(parseInt(event.key))) {
          this.switchToTab(parseInt(event.key) - 1);
        } else {
          return false;
        }
    }

    return event.key;
  }

  handleMovementKey(event) {
    let moved = false;
    let mark = false;
    if (this.isPopupVisible) {
      return;
    }
    // Temporarily suppress mouse hover during keyboard navigation
    this.ignoreMouseMovement = true;

    // Check if page/home/end keys should be handled
    const pageKeysEnabled = this.config.get('enablePageKeys');
    const isPageKey = ['PageDown', 'PageUp', 'Home', 'End'].includes(event.key);

    if (this.keyState.length == 0) {
      // Build list of movement keys, conditionally including page keys
      const movementKeys = ['j', 'k', 'h', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'J', 'G'];
      if (pageKeysEnabled) {
        movementKeys.push('PageDown', 'PageUp', 'Home', 'End');
      }

      if (movementKeys.includes(event.key)) {
        if (['j', 'ArrowDown'].indexOf(event.key) != -1) {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            this.replyIndex += 1;
          } else if (this.config.get('unrolledPostSelection')) {
            if (event.key == 'j') {
              this.markItemRead(this.index, true);
            }
            this.threadIndex += 1;
          } else {
            moved = this.jumpToNext(event.key == 'j');
          }
        } else if (['k', 'ArrowUp'].indexOf(event.key) != -1) {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            this.replyIndex -= 1;
          } else if (this.config.get('unrolledPostSelection')) {
            if (event.key == 'k') {
              this.markItemRead(this.index, true);
            }
            this.threadIndex -= 1;
          } else {
            moved = this.jumpToPrev(event.key == 'k');
          }
        } else if (event.key == 'PageDown') {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            moved = this.jumpSidecarByPage(1);
          } else {
            moved = this.jumpByPage(1);
          }
        } else if (event.key == 'PageUp') {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            moved = this.jumpSidecarByPage(-1);
          } else {
            moved = this.jumpByPage(-1);
          }
        } else if (event.key == 'Home') {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            this.replyIndex = 0;
          } else {
            this.setIndex(0, false, true);
          }
          moved = true;
        } else if (event.key == 'End') {
          event.preventDefault();
          if (this.config.get('showReplySidecar') && this.replyIndex != null) {
            const replies = $(this.selectedItem).parent().find('div.sidecar-post');
            this.replyIndex = replies.length - 1;
          } else {
            this.setIndex(this.items.length - 1, false, true);
          }
          moved = true;
        } else if (event.key == 'h') {
          const back_button = $("button[aria-label^='Back' i]").filter(':visible');
          if (back_button.length) {
            back_button.click();
          } else {
            history.back(1);
          }
        } else if (event.key == 'ArrowLeft') {
          event.preventDefault();
          if (!this.config.get('showReplySidecar') || this.replyIndex == null) {
            return;
          }
          this.toggleFocus();
        } else if (event.key == 'ArrowRight') {
          event.preventDefault();
          if (!this.config.get('showReplySidecar') || this.replyIndex != null) {
            return;
          }
          this.toggleFocus();
        } else if (event.key == 'G') {
          event.preventDefault();
          moved = this.setIndex(this.items.length - 1, false, true);
        } else if (event.key == 'J') {
          mark = true;
          this.jumpToNextUnseenItem(mark);
        }
        moved = true;
      } else if (event.key == 'g') {
        this.keyState.push(event.key);
      }
    } else if (this.keyState[0] == 'g') {
      if (event.key == 'g') {
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

  openCurrentItem(item) {
    if (this.replyIndex == null) {
      $(item).click();
    } else {
      this.selectedReply.find('.sidecar-post-timestamp a')[0].click();
    }
  }

  openInnerPost(item) {
    $(item).find("div[aria-label^='Post by']").click();
  }

  openFirstLink(item) {
    const link = $(item).find(constants.LINK_SELECTOR);
    if (link.length) {
      link[0].click();
    }
  }

  toggleMedia(item, event) {
    const media = $(item).find("img[src*='feed_thumbnail']");
    if (media.length > 0) {
      media[0].click();
      return;
    }

    const video = $(item).find('video')[0];
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

  openReplyDialog(item) {
    const button = $(item).find("button[aria-label^='Reply']");
    button.focus();
    button.click();
  }

  handleLikeAction(item) {
    if (this.config.get('showReplySidecar') && this.replyIndex != null) {
      this.likePost(this.selectedReply);
    } else if (this.threadIndex) {
      this.likePost(this.selectedPost);
    } else {
      $(item).find("button[data-testid='likeBtn']").click();
    }
  }

  openRepostMenu(item) {
    $(item).find("button[aria-label^='Repost']").click();
  }

  repostImmediately(item) {
    $(item).find("button[aria-label^='Repost']").click();
    setTimeout(() => {
      $("div[aria-label^='Repost'][role='menuitem']").click();
    }, constants.REPOST_MENU_DELAY);
  }

  switchToTab(tabIndex) {
    const tabs = $("div[role='tablist'] > div > div > div").filter(':visible');
    if (tabs[tabIndex]) {
      tabs[tabIndex].click();
    }
  }

  toggleFocus() {
    if (this.replyIndex == null) {
      this.replyIndex = 0;
    } else {
      this.replyIndex = null;
    }
  }

  jumpToPrev(mark) {
    this.setIndex(this.index - 1, mark, true);
    return true;
  }

  jumpToNext(mark) {
    if (this.index < this.items.length) {
      this.setIndex(this.index + 1, mark, true);
    } else {
      const next = $(this.selectedItem).parent().parent().parent().next();
      if (next && $.trim(next.text()) == 'Continue thread...') {
        this.loadPageObserver = waitForElement(
          this.THREAD_PAGE_SELECTOR,
          this.handleNewThreadPage
        );
        console.log(this.loadPageObserver);
        $(next).find('div').click();
      }
    }
    return true;
  }

  jumpByPage(direction) {
    // Calculate how many items fit in the viewport
    const viewportHeight = window.innerHeight;
    const currentItem = this.selectedItem;
    if (!currentItem) return false;

    const itemHeight = $(currentItem).outerHeight(true) || 200;
    const itemsPerPage = Math.max(1, Math.floor(viewportHeight / itemHeight) - 1);

    // Calculate new index
    const newIndex = Math.max(0, Math.min(this.items.length - 1, this.index + direction * itemsPerPage));

    if (newIndex !== this.index) {
      this.setIndex(newIndex, false, true);
      return true;
    }
    return false;
  }

  jumpSidecarByPage(direction) {
    const replies = $(this.selectedItem).parent().find('div.sidecar-post');
    if (!replies.length) return false;

    // Get the sidecar container height
    const sidecar = $(this.selectedItem).parent().find('.sidecar-replies');
    const sidecarHeight = sidecar.height() || window.innerHeight;

    // Get the height of a reply item
    const currentReply = replies.eq(this.replyIndex);
    const replyHeight = currentReply.outerHeight(true) || 100;
    const repliesPerPage = Math.max(1, Math.floor(sidecarHeight / replyHeight) - 1);

    // Calculate new index
    const newIndex = Math.max(0, Math.min(replies.length - 1, this.replyIndex + direction * repliesPerPage));

    if (newIndex !== this.replyIndex) {
      this.replyIndex = newIndex;
      return true;
    }
    return false;
  }

  jumpToNextUnseenItem(mark) {
    let i;
    for (i = this.index + 1; i < this.items.length - 1; i++) {
      const postId = this.postIdForItem(this.items[i]);
      if (!this.state.seen[postId]) {
        break;
      }
    }
    this.setIndex(i, mark);
    this.updateItems();
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

  // ===========================================================================
  // Item Actions (like, screenshot, mark read, video)
  // ===========================================================================

  async likePost(post) {
    try {
      const uri = await this.api.getAtprotoUri(this.urlForItem(post));
      const thread = await this.api.getThread(uri);
      const { likeCount, viewer, cid } = thread.post;
      const isLiked = !!viewer.like;

      if (isLiked) {
        await this.api.agent.deleteLike(viewer.like);
      } else {
        await this.api.agent.like(uri, cid);
      }

      this.updateLikeUI(post, likeCount, isLiked);
    } catch (error) {
      console.error('Failed to toggle like:', error);
    }
  }

  updateLikeUI(post, currentLikeCount, wasLiked) {
    const newCount = wasLiked ? currentLikeCount - 1 : currentLikeCount + 1;
    const svgIndex = wasLiked ? 0 : 1;
    const likeButton = $(post).find('.sidecar-like-button');

    likeButton.html(constants.SIDECAR_SVG_LIKE[svgIndex]);
    $(post).find('.sidecar-count-label-likes').html(Math.max(0, newCount));

    // Visual feedback animation
    const animDuration = getAnimationDuration(300, this.config);
    if (animDuration > 0) {
      likeButton.addClass(wasLiked ? 'like-animation-unlike' : 'like-animation-like');
      setTimeout(() => {
        likeButton.removeClass('like-animation-like like-animation-unlike');
      }, animDuration);
    }

    // Screen reader announcement
    const action = wasLiked ? 'unliked' : 'liked';
    announceToScreenReader(`Post ${action}. ${newCount} ${newCount === 1 ? 'like' : 'likes'}.`);
  }

  async captureScreenshot(item) {
    try {
      // Helper to fetch image as data URL using GM_xmlhttpRequest (bypasses CORS)
      const fetchImageAsDataUrl = (url) => {
        return new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            onload: (response) => {
              console.log('[bsky-nav] GM_xmlhttpRequest loaded:', url, 'status:', response.status, 'size:', response.response?.size);
              if (response.status !== 200 || !response.response) {
                console.error('[bsky-nav] Bad response for:', url);
                resolve({ url, dataUrl: null });
                return;
              }
              const reader = new FileReader();
              reader.onloadend = () => {
                console.log('[bsky-nav] Converted to dataUrl:', url.substring(0, 50), 'length:', reader.result?.length);
                resolve({ url, dataUrl: reader.result });
              };
              reader.onerror = (err) => {
                console.error('[bsky-nav] FileReader error for:', url, err);
                resolve({ url, dataUrl: null });
              };
              reader.readAsDataURL(response.response);
            },
            onerror: (err) => {
              console.error('[bsky-nav] GM_xmlhttpRequest error for:', url, err);
              resolve({ url, dataUrl: null });
            }
          });
        });
      };

      // Collect all image URLs from the item
      const imageUrls = new Map(); // url -> dataUrl
      const urlsToFetch = new Set();

      // Find all img elements
      const images = item.querySelectorAll('img');
      images.forEach(img => {
        if (img.src && img.src.startsWith('http')) {
          urlsToFetch.add(img.src);
        }
        // Also check srcset
        if (img.srcset) {
          const srcsetUrls = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
          srcsetUrls.forEach(url => {
            if (url.startsWith('http')) urlsToFetch.add(url);
          });
        }
      });

      // Find all elements with background-image (inline style)
      const bgDivs = item.querySelectorAll('[style*="background-image"]');
      bgDivs.forEach(div => {
        const style = div.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
        if (match && match[1] && match[1].startsWith('http')) {
          urlsToFetch.add(match[1]);
        }
      });

      // Find elements with computed background-image (CSS classes)
      const allElements = item.querySelectorAll('*');
      allElements.forEach(el => {
        const computed = window.getComputedStyle(el);
        const bgImage = computed.backgroundImage;
        if (bgImage && bgImage !== 'none') {
          const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
          if (match && match[1] && match[1].startsWith('http')) {
            urlsToFetch.add(match[1]);
          }
        }
      });

      console.log('[bsky-nav] Screenshot: found', urlsToFetch.size, 'images to fetch:', Array.from(urlsToFetch));

      // Fetch all images as data URLs (with timeout)
      const fetchPromises = Array.from(urlsToFetch).map(url => fetchImageAsDataUrl(url));
      const results = await Promise.race([
        Promise.all(fetchPromises),
        new Promise(resolve => setTimeout(() => resolve([]), 5000))
      ]);

      // Build URL -> dataUrl map
      results.forEach(({ url, dataUrl }) => {
        if (dataUrl) {
          imageUrls.set(url, dataUrl);
        }
      });
      console.log('[bsky-nav] Screenshot: fetched', imageUrls.size, 'of', urlsToFetch.size, 'images');

      // Helper to find data URL for any URL variant
      const findDataUrl = (url) => {
        if (!url) return null;
        if (imageUrls.has(url)) return imageUrls.get(url);
        const baseUrl = url.split('?')[0];
        for (const [key, val] of imageUrls) {
          if (key.split('?')[0] === baseUrl) return val;
          if (key.includes(baseUrl) || baseUrl.includes(key.split('?')[0])) return val;
        }
        return null;
      };

      // Store original values and modify the actual DOM
      const originalValues = [];

      // Replace img src with data URLs on original DOM
      const itemImages = item.querySelectorAll('img');
      itemImages.forEach(img => {
        const dataUrl = findDataUrl(img.src);
        if (dataUrl) {
          originalValues.push({ el: img, attr: 'src', value: img.src });
          img.src = dataUrl;
        }
      });

      // Replace background-image on original DOM
      const bgElements = item.querySelectorAll('*');
      bgElements.forEach(el => {
        const inlineStyle = el.getAttribute('style') || '';
        let match = inlineStyle.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          const dataUrl = findDataUrl(match[1]);
          if (dataUrl) {
            originalValues.push({ el, attr: 'style-bg', value: el.style.backgroundImage });
            el.style.backgroundImage = `url("${dataUrl}")`;
          }
        }
      });

      console.log('[bsky-nav] Modified', originalValues.length, 'elements in original DOM');

      // Log the first data URL to verify it's valid
      if (imageUrls.size > 0) {
        const firstDataUrl = Array.from(imageUrls.values())[0];
        console.log('[bsky-nav] Sample dataUrl prefix:', firstDataUrl?.substring(0, 50));
      }

      // Wait for browser to process DOM changes
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(item, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      // Restore original values
      originalValues.forEach(({ el, attr, value }) => {
        if (attr === 'src') {
          el.src = value;
        } else if (attr === 'style-bg') {
          el.style.backgroundImage = value;
        }
      });
      console.log('[bsky-nav] Restored original DOM');

      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob,
            }),
          ]);
          console.log('Screenshot copied to clipboard!');

          const notification = $('<div>')
            .css({
              position: 'fixed',
              top: '20px',
              right: '20px',
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              borderRadius: '4px',
              zIndex: 10000,
              fontSize: '14px',
            })
            .text('Screenshot copied to clipboard!');

          $('body').append(notification);
          setTimeout(() => notification.fadeOut(500, () => notification.remove()), 2000);
        } catch (err) {
          console.error('Failed to copy screenshot to clipboard:', err);
        }
      });
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
    }
  }

  async showPostViewModal(item) {
    const postElement = item[0];
    if (!postElement) {
      console.warn('showPostViewModal: no post element found');
      return;
    }

    // Create modal instance if needed
    if (!this.postViewModal) {
      this.postViewModal = new PostViewModal(this.config);
    }

    // Show modal immediately with loading state
    this.postViewModal.show(postElement, null);

    // Fetch thread data and update sidecar
    try {
      const thread = await this.getThreadForItem(postElement);
      if (thread) {
        const sidecarHtml = await this.getSidecarContent(postElement, thread);
        // Wrap in modal-specific container to isolate from feed sidecar selectors
        const wrappedHtml = `<div class="post-view-modal-sidecar-content">${sidecarHtml}</div>`;
        this.postViewModal.updateSidecar(wrappedHtml);
      } else {
        this.postViewModal.updateSidecar('<div class="post-view-modal-error">Could not load replies</div>');
      }
    } catch (err) {
      console.error('Failed to load thread for post view modal:', err);
      this.postViewModal.updateSidecar('<div class="post-view-modal-error">Error loading replies</div>');
    }
  }

  async showReaderModeModal(item) {
    const postElement = item[0];
    if (!postElement) {
      console.warn('showReaderModeModal: no post element found');
      return;
    }

    // Create modal instance if needed
    if (!this.postViewModal) {
      this.postViewModal = new PostViewModal(this.config);
    }

    // Show modal immediately with loading state
    this.postViewModal.showReaderMode(null, 'Reader View');

    // Fetch thread data and build reader content
    try {
      const thread = await this.getThreadForItem(postElement);
      if (thread) {
        // Get all posts in the thread by the same author (unrolled)
        const unrolledPosts = await this.api.unrollThread(thread);
        const authorName = thread.post.author.displayName || thread.post.author.handle;

        // Build the reader content HTML
        const readerHtml = this.buildReaderContent(unrolledPosts, authorName);
        this.postViewModal.updateReaderContent(readerHtml);
      } else {
        this.postViewModal.updateReaderContent('<div class="post-view-modal-error">Could not load thread</div>');
      }
    } catch (err) {
      console.error('Failed to load thread for reader mode:', err);
      this.postViewModal.updateReaderContent('<div class="post-view-modal-error">Error loading thread</div>');
    }
  }

  buildReaderContent(posts, authorName) {
    if (!posts || posts.length === 0) {
      return '<div class="post-view-modal-error">No posts found</div>';
    }

    const bodyTemplate = Handlebars.compile($('#sidecar-body-template').html());
    Handlebars.registerPartial('bodyTemplate', bodyTemplate);

    let html = `<div class="reader-mode-thread">`;
    const totalPosts = posts.length;
    html += `<div class="reader-mode-author">Thread by ${this.escapeHtml(authorName)} (${totalPosts} post${totalPosts > 1 ? 's' : ''})</div>`;

    posts.forEach((post, index) => {
      const postNum = index + 1;
      const formattedPost = formatPost(post);
      html += `
        <article class="reader-mode-post" data-post-index="${index}">
          <div class="reader-mode-post-number">${postNum}<span class="reader-mode-post-total">/${totalPosts}</span></div>
          <div class="reader-mode-post-content">
            ${bodyTemplate(formattedPost)}
          </div>
        </article>
      `;
    });

    html += `</div>`;
    return html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  markItemRead(index, isRead) {
    if (this.name == 'post' && !this.config.get('savePostState')) {
      return;
    }
    const mainItem = $(this.items)[index];
    const item =
      this.threadIndex != null ? this.getPostForThreadIndex(this.threadIndex) : mainItem;
    const postId = this.postIdForItem(item) || this.postIdForItem(mainItem);
    if (!postId) {
      console.warn('markItemRead: no postId found');
      return;
    }
    const markedRead = this.markPostRead(postId, isRead);
    console.log(isRead, markedRead);
    if (this.unrolledReplies.length) {
      $(item).addClass(markedRead ? 'item-read' : 'item-unread');
      $(item).removeClass(markedRead ? 'item-unread' : 'item-read');
    } else {
      this.applyItemStyle(mainItem, index == this.index);
    }
    if (
      this.unrolledReplies.length &&
      this.unrolledReplies.get().every((r) => $(r).hasClass('item-read'))
    ) {
      this.markPostRead(this.postIdForItem(mainItem), isRead);
      this.applyItemStyle(this.items[index], index == this.index);
    }
    this.updateInfoIndicator();
  }

  markPostRead(postId, isRead) {
    const currentTime = new Date().toISOString();
    const seen = { ...this.state.seen };

    if (isRead || (isRead == null && !seen[postId])) {
      seen[postId] = currentTime;
    } else {
      seen[postId] = null;
    }
    this.state.stateManager.updateState({ seen, lastUpdated: currentTime });
    return !!seen[postId];
  }

  markVisibleRead() {
    $(this.items).each((i, _item) => {
      this.markItemRead(i, true);
    });
  }

  playVideo(video) {
    video.dataset.allowPlay = 'true';
    video.play();
  }

  pauseVideo(video) {
    video.dataset.allowPlay = 'true';
    video.pause();
  }

  // ===========================================================================
  // Observer Setup
  // ===========================================================================

  setupIntersectionObservers() {
    this.intersectionObserver = new IntersectionObserver(this.onIntersection, {
      root: null,
      threshold: Array.from({ length: 101 }, (_, i) => i / 100),
    });
    this.setupIntersectionObserver();

    this.footerIntersectionObserver = new IntersectionObserver(this.onFooterIntersection, {
      root: null,
      threshold: Array.from({ length: 101 }, (_, i) => i / 100),
    });
  }

  setupIntersectionObserver() {
    if (this.intersectionObserver) {
      console.log('[bsky-nav] setupIntersectionObserver: observing', $(this.items).length, 'items');
      $(this.items).each((i, item) => {
        this.intersectionObserver.observe($(item)[0]);
      });
    }
  }

  setupItemObserver() {
    const safeSelector = `${this.selector}:not(.thread ${this.selector})`;
    this.observer = waitForElement(safeSelector, (element) => {
      this.onItemAdded(element);
      this.onItemRemoved(element);
    });
  }

  setupLoadNewerObserver() {
    // Use the simpler button selector instead of the complex indicator selector
    this.loadNewerObserver = waitForElement(constants.LOAD_NEW_BUTTON_SELECTOR, (button, observer) => {
      // Disconnect observer to prevent repeated firing
      if (observer) observer.disconnect();

      const btn = $(button)[0];
      if (this.loadNewerButton === btn) return;

      this.loadNewerButton = btn;
      console.log('[bsky-navigator] Load newer button found:', btn);

      $('img#loadNewerIndicatorImage').addClass('image-highlight');
      $('img#loadNewerIndicatorImage').removeClass('toolbar-icon-pending');

      // Show floating "New posts" pill
      this.showNewPostsPill();
    });
  }

  showNewPostsPill() {
    // Remove existing pill if any
    $('#bsky-navigator-new-posts-pill').remove();

    const pill = $(`
      <button id="bsky-navigator-new-posts-pill" class="new-posts-pill" aria-label="Load new posts">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4l-8 8h6v8h4v-8h6z"/>
        </svg>
        <span>New posts</span>
      </button>
    `);

    pill.on('click', (e) => {
      e.preventDefault();
      this.hideNewPostsPill();
      this.loadNewerItems();
    });

    $('body').append(pill);
    announceToScreenReader('New posts available. Press u to load.');
  }

  hideNewPostsPill() {
    const pill = $('#bsky-navigator-new-posts-pill');
    pill.addClass('new-posts-pill-hiding');
    setTimeout(() => pill.remove(), 200);
  }

  setupFloatingButtons() {
    console.log(this.state.mobileView);
    this.floatingButtonsObserver = waitForElement(
      this.state.mobileView ? constants.HOME_SCREEN_SELECTOR : constants.LEFT_SIDEBAR_SELECTOR,
      (container) => {
        console.log(container);
        if (!this.prevButton) {
          this.prevButton = $(
            `<div id="prevButton" title="previous post" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="prevButtonImage" class="indicator-image" src="${this.FLOATING_BUTTON_IMAGES.prev[0]}"/></div>`
          );
          $(container).append(this.prevButton);
          if (this.state.mobileView) {
            $('#prevButton').addClass('mobile');
          }
          $('#prevButton').on('click', (event) => {
            event.preventDefault();
            this.jumpToPrev(true);
          });
        }

        if (!this.nextButton) {
          this.nextButton = $(
            `<div id="nextButton" title="next post" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="nextButtonImage" class="indicator-image" src="${this.FLOATING_BUTTON_IMAGES.next[0]}"/></div>`
          );
          $(this.prevButton).after(this.nextButton);
          if (this.state.mobileView) {
            $('#nextButton').addClass('mobile');
          }
          $('#nextButton').on('click', (event) => {
            event.preventDefault();
            this.jumpToNext(true);
          });
        }
      }
    );
  }

  enableFooterObserver() {
    if (this.config.get('disableLoadMoreOnScroll')) return;
    if (!this.state.feedSortReverse && this.items.length > 0) {
      this.footerIntersectionObserver.observe(this.items.slice(-1)[0]);
    }
  }

  disableFooterObserver() {
    if (this.footerIntersectionObserver) {
      this.footerIntersectionObserver.disconnect();
    }
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  onItemAdded(element) {
    this.applyItemStyle(element);
    clearTimeout(this.loadItemsDebounceTimeout);
    this.loadItemsDebounceTimeout = setTimeout(() => this.loadItems(), 500);

    // Initialize swipe gestures and long press on mobile
    if (this.gestureHandler) {
      this.gestureHandler.init(element);
    }
    if (this.bottomSheet) {
      this.bottomSheet.init(element);
    }
  }

  onItemRemoved(_element) {
    // No-op - footer observer handles its own cleanup
  }

  /**
   * Handle wheel events - mark scroll as user-initiated
   */
  onWheel(_event) {
    this.userInitiatedScroll = true;
  }

  /**
   * Handle scroll events - track direction and set ignoreMouseMovement
   */
  onScroll(_event) {
    if (!this.enableScrollMonitor) {
      return;
    }
    this.ignoreMouseMovement = true;
    if (!this.scrollTick) {
      requestAnimationFrame(() => {
        const currentScroll = $(window).scrollTop();
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

  /**
   * Handle intersection observer events - track visible items and focus best target
   */
  onIntersection(entries) {
    if (!this.enableIntersectionObserver || this.loading || this.loadingNew) {
      return;
    }

    // Update visible items tracking
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        this.visibleItems = this.visibleItems.filter((item) => item.target != entry.target);
        this.visibleItems.push(entry);
      } else {
        const oldLength = this.visibleItems.length;
        this.visibleItems = this.visibleItems.filter((item) => item.target != entry.target);
        if (this.visibleItems.length < oldLength) {
          if (this.config.get('markReadOnScroll')) {
            const index = this.getIndexFromItem(entry.target);
            this.markItemRead(index, true);
          }
        }
      }
    });

    if (!this.visibleItems.length) return;

    // Debounce selection changes to prevent blinking
    if (this.intersectionDebounceTimeout) {
      clearTimeout(this.intersectionDebounceTimeout);
    }

    this.intersectionDebounceTimeout = setTimeout(() => {
      this.selectBestVisibleItem();
    }, 50);
  }

  /**
   * Select the best visible item based on scroll direction
   * Scrolling down: select item closest to bottom where bottom is visible
   * Scrolling up: select item closest to top where top is visible
   */
  selectBestVisibleItem() {
    // Check if scroll-to-focus is enabled
    if (!this.config.get('scrollToFocus')) return;

    // Only activate on user-initiated scrolls (mouse wheel/touchpad), not programmatic
    if (!this.userInitiatedScroll) return;

    // Get viewport bounds accounting for toolbar and status bar
    const toolbarHeight = this.getToolbarHeight();
    const statusBarHeight = this.getStatusBarHeight();
    const viewportTop = toolbarHeight;
    const viewportBottom = window.innerHeight - statusBarHeight;

    // Query visible items and their viewport positions
    const visibleInViewport = [];
    $(this.items).each((arrayIndex, item) => {
      // Skip embedded posts (posts inside another post)
      if ($(item).parents(this.selector).length > 0) return;

      const rect = item.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom) {
        visibleInViewport.push({ item, rect, arrayIndex });
      }
    });

    if (!visibleInViewport.length) return;

    let newIndex = -1;

    if (this.scrollDirection === -1) {
      // Scrolling DOWN: find item closest to bottom where bottom is visible
      let bestBottom = -Infinity;
      for (const v of visibleInViewport) {
        // Item's bottom must be within viewport
        if (v.rect.bottom <= viewportBottom && v.rect.bottom > bestBottom) {
          bestBottom = v.rect.bottom;
          newIndex = v.arrayIndex;
        }
      }
      // Fallback: if no item has bottom in viewport, pick the one closest to viewport bottom
      if (newIndex < 0) {
        let closestDist = Infinity;
        for (const v of visibleInViewport) {
          const dist = Math.abs(v.rect.bottom - viewportBottom);
          if (dist < closestDist) {
            closestDist = dist;
            newIndex = v.arrayIndex;
          }
        }
      }
    } else {
      // Scrolling UP: find item closest to top where top is visible
      let bestTop = Infinity;
      for (const v of visibleInViewport) {
        // Item's top must be within viewport
        if (v.rect.top >= viewportTop && v.rect.top < bestTop) {
          bestTop = v.rect.top;
          newIndex = v.arrayIndex;
        }
      }
      // Fallback: if no item has top in viewport, pick the one closest to viewport top
      if (newIndex < 0) {
        let closestDist = Infinity;
        for (const v of visibleInViewport) {
          const dist = Math.abs(v.rect.top - viewportTop);
          if (dist < closestDist) {
            closestDist = dist;
            newIndex = v.arrayIndex;
          }
        }
      }
    }

    if (newIndex >= 0 && newIndex !== this.index) {
      // Use setIndex with update=false to avoid scrolling, skipSidecar=true
      this.setIndex(newIndex, false, false, true);
    }
  }

  /**
   * Get the height of the toolbar at the top (fixed position, not scroll-dependent)
   */
  getToolbarHeight() {
    const toolbar = $(`${constants.HOME_SCREEN_SELECTOR} > div > div`).eq(2);
    if (toolbar.length) {
      // Use getBoundingClientRect for screen position, not offset() which includes scroll
      const rect = toolbar[0].getBoundingClientRect();
      return rect.bottom || 60;
    }
    return 60;
  }

  /**
   * Get the height of the status bar at the bottom
   */
  getStatusBarHeight() {
    const statusBar = $('#scroll-indicator-container');
    if (statusBar.length && statusBar.is(':visible')) {
      return statusBar.outerHeight() || 0;
    }
    return 0;
  }

  onPopupAdd() {
    this.isPopupVisible = true;
  }

  onPopupRemove() {
    this.isPopupVisible = false;
  }

  onFooterIntersection(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        this.disableFooterObserver();
        this.loadOlderItems();
      }
    });
  }

  // ===========================================================================
  // Mouse Handling
  // ===========================================================================

  /**
   * Debounced mouse over handler for items - only focus when not scrolling
   */
  onItemMouseOver(event) {
    // Check if hover-to-focus is enabled
    if (!this.config.get('hoverToFocus')) return;

    // Ignore mouse events while scrolling
    if (this.ignoreMouseMovement) return;

    const target = $(event.target).closest(this.selector);
    const index = this.getIndexFromItem(target);

    // Clear any pending debounce
    if (this.hoverDebounceTimeout) {
      clearTimeout(this.hoverDebounceTimeout);
    }

    // Debounce the focus change
    this.hoverDebounceTimeout = setTimeout(() => {
      // Double-check we're still not scrolling
      if (this.ignoreMouseMovement) return;

      this.replyIndex = null;
      if (index !== this.index && index >= 0) {
        // Hover opens sidecar (unlike scroll which skips it)
        this.setIndex(index, false, false, false);
      } else if (index === this.index && index >= 0) {
        // Hovering over already-selected item (e.g., focused via scroll) - ensure sidecar is open
        this.expandItem(this.selectedItem);
      }
    }, this.hoverDebounceDelay);
  }

  /**
   * Debounced mouse over handler for sidecar items
   */
  onSidecarItemMouseOver(event) {
    // Check if hover-to-focus is enabled (parent setting and sidecar-specific)
    if (!this.config.get('hoverToFocus') || !this.config.get('hoverToFocusSidecar')) return;

    // Ignore mouse events while scrolling
    if (this.ignoreMouseMovement) return;

    const target = $(event.target).closest('.sidecar-post');
    const index = this.getSidecarIndexFromItem(target);
    const parent = target.closest('.thread').find('.item');
    const parentIndex = this.getIndexFromItem(parent);

    // Clear any pending debounce
    if (this.hoverDebounceTimeout) {
      clearTimeout(this.hoverDebounceTimeout);
    }

    // Debounce the focus change
    this.hoverDebounceTimeout = setTimeout(() => {
      if (this.ignoreMouseMovement) return;

      if (parentIndex !== this.index && parentIndex >= 0) {
        // Hover opens sidecar (unlike scroll which skips it)
        this.setIndex(parentIndex, false, false, false);
      }
      this.replyIndex = index;
    }, this.hoverDebounceDelay);
  }

  // ===========================================================================
  // Scroll & Navigation Helpers
  // ===========================================================================

  scrollToElement(target, block = null) {
    // Temporarily suppress focus changes during programmatic scroll
    this.ignoreMouseMovement = true;
    target.scrollIntoView({
      behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant',
      block: block == null ? 'start' : block,
    });
    // Reset after scroll completes
    setTimeout(() => {
      this.ignoreMouseMovement = false;
    }, 500);
  }

  get scrollMargin() {
    let margin;
    let el;
    if (this.state.mobileView) {
      el = $(`${constants.HOME_SCREEN_SELECTOR} > div > div > div`);
      el = el.first().children().filter(':visible').first();
      if (this.index) {
        const transform = el[0].style.transform;
        const translateY =
          transform.indexOf('(') == -1 ? 0 : parseInt(transform.split('(')[1].split('px')[0]);
        margin = el.outerHeight() + translateY;
      } else {
        margin = el.outerHeight();
      }
    } else {
      el = $(`${constants.HOME_SCREEN_SELECTOR} > div > div`).eq(2);
      margin = el.outerHeight();
    }
    const itemMargin = parseInt($(this.selector).css('margin-top').replace('px', ''));
    return margin + itemMargin;
  }

  updateItems() {
    // Temporarily suppress focus changes during programmatic scroll
    this.ignoreMouseMovement = true;
    if (this.index == 0) {
      window.scrollTo(0, 0);
    } else if ($(this.selectedItem).length) {
      this.scrollToElement($(this.selectedItem)[0]);
    }
    setTimeout(() => {
      this.ignoreMouseMovement = false;
    }, 500);
  }

  handleNewThreadPage(_element) {
    console.log(this.items.length);
    this.loadPageObserver.disconnect();
  }

  // ===========================================================================
  // Item Utilities
  // ===========================================================================

  postIdFromUrl() {
    return window.location.href.split('/')[6];
  }

  urlForItem(item) {
    return `https://bsky.app${$(item).find("a[href*='/post/']").attr('href')}`;
  }

  postIdForItem(item) {
    try {
      return extractPostIdFromUrl(this.urlForItem(item));
    } catch (_e) {
      return this.postIdFromUrl();
    }
  }

  handleFromItem(item) {
    return $.trim(
      $(item)
        .find(constants.PROFILE_SELECTOR)
        .find('span')
        .eq(1)
        .text()
        .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    ).slice(1);
  }

  displayNameFromItem(item) {
    return $.trim(
      $(item)
        .find(constants.PROFILE_SELECTOR)
        .find('span')
        .eq(0)
        .text()
        .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    );
  }

  async getThreadForItem(item) {
    const url = this.urlForItem(item);
    if (!url) return;
    const uri = await this.api.getAtprotoUri(url);
    if (!uri) return;
    return await this.api.getThread(uri);
  }

  getHandles() {
    return Array.from(new Set(this.items.map((i, item) => this.handleFromItem(item))));
  }

  getDisplayNames() {
    return Array.from(new Set(this.items.map((i, item) => this.displayNameFromItem(item))));
  }

  getAuthors() {
    const authors = $(this.items)
      .get()
      .map((item) => ({
        handle: this.handleFromItem(item),
        displayName: this.displayNameFromItem(item),
      }))
      .filter((author) => author.handle.length > 0);
    const uniqueMap = new Map();
    authors.forEach((author) => uniqueMap.set(author.handle, author));
    return Array.from(uniqueMap.values());
  }

  getTimestampForItem(item) {
    const postTimestampElement = $(item).find('a[href^="/profile/"][data-tooltip*=" at "]').first();
    const postTimeString = postTimestampElement.attr('aria-label');
    if (!postTimeString) return null;
    return new Date(postTimeString.replace(' at', ''));
  }

  // ===========================================================================
  // Item Styling
  // ===========================================================================

  applyItemStyle(element, selected) {
    $(element).addClass('item');

    if (this.config.get('postActionButtonPosition') == 'Left') {
      const postContainer = $(element).find(constants.POST_CONTENT_SELECTOR).prev();
      if (postContainer.length) {
        postContainer.css('flex', '');
      }
    }

    this.applyTimestampFormat(element);
    this.applyThreadStyling(element, selected);
    this.applySelectionStyling(element, selected);
    this.applyReadStatus(element);
    this.applyBlockStatus(element);
  }

  applyTimestampFormat(element) {
    const postTimestampElement = $(element)
      .find('a[href^="/profile/"][data-tooltip*=" at "]')
      .first();
    if (!postTimestampElement.attr('data-bsky-navigator-age')) {
      postTimestampElement.attr('data-bsky-navigator-age', postTimestampElement.text());
    }
    const userFormat = this.config.get(
      this.state.mobileView ? 'postTimestampFormatMobile' : 'postTimestampFormat'
    );
    const postTimeString = postTimestampElement.attr('aria-label');
    if (postTimeString && userFormat) {
      const postTimestamp = new Date(postTimeString.replace(' at', ''));
      const formattedDate = dateFns
        .format(postTimestamp, userFormat)
        .replace('$age', postTimestampElement.attr('data-bsky-navigator-age'));
      if (this.config.get('showDebuggingInfo')) {
        postTimestampElement.text(
          `${formattedDate} (${$(element).parent().parent().attr('data-bsky-navigator-thread-index')}, ${$(element).attr('data-bsky-navigator-item-index')})`
        );
      } else {
        postTimestampElement.text(formattedDate);
      }
    }
  }

  applyThreadStyling(element, selected) {
    const threadIndicator = $(element).find('div.r-lchren, div.r-1mhb1uw > svg');
    const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]');

    $(element).parent().parent().addClass('thread');
    $(element).css('scroll-margin-top', `${this.scrollMargin}px`, `!important`);

    if (selected) {
      $(element).parent().parent().addClass('thread-selection-active');
      $(element).parent().parent().removeClass('thread-selection-inactive');
    } else {
      $(element).parent().parent().removeClass('thread-selection-active');
      $(element).parent().parent().addClass('thread-selection-inactive');
    }

    if (threadIndicator.length) {
      const parent = threadIndicator.parents().has(avatarDiv).first();
      const children = parent.find('*');
      if (threadIndicator.length == 1) {
        if (children.index(threadIndicator) < children.index(avatarDiv)) {
          $(element).parent().parent().addClass('thread-last');
        } else {
          $(element).parent().parent().addClass('thread-first');
        }
      } else {
        $(element).parent().parent().addClass('thread-middle');
      }
    } else {
      $(element).parent().parent().addClass(['thread-first', 'thread-middle', 'thread-last']);
    }
  }

  applySelectionStyling(element, selected) {
    if (selected) {
      $(element).addClass('item-selection-active');
      $(element).removeClass('item-selection-child-focused');
      $(element).removeClass('item-selection-inactive');
    } else {
      $(element).removeClass('item-selection-active');
      $(element).removeClass('item-selection-child-focused');
      $(element).addClass('item-selection-inactive');
    }
  }

  applyReadStatus(element) {
    const postId = this.postIdForItem($(element));
    if (postId != null && this.state.seen[postId]) {
      $(element).addClass('item-read');
      $(element).removeClass('item-unread');
    } else {
      $(element).addClass('item-unread');
      $(element).removeClass('item-read');
    }
  }

  applyBlockStatus(element) {
    const handle = this.handleFromItem(element);
    if (this.state.blocks.all.includes(handle)) {
      $(element).find(constants.PROFILE_SELECTOR).css(constants.CLEARSKY_BLOCKED_ALL_CSS);
    }
    if (this.state.blocks.recent.includes(handle)) {
      $(element).find(constants.PROFILE_SELECTOR).css(constants.CLEARSKY_BLOCKED_RECENT_CSS);
    }
  }

  // ===========================================================================
  // Item Loading
  // ===========================================================================

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
      $(messageTitle).html(title);
      this.messageContainer.append(messageTitle);
    }
    const messageBody = $('<div class="messageBody">');
    this.messageContainer.append(messageBody);
    $(messageBody).html(message);
    $(constants.FEED_CONTAINER_SELECTOR).filter(':visible').append(this.messageContainer);
    window.scrollTo(0, 0);
  }

  hideMessage() {
    $('#messageContainer').remove();
    this.messageContainer = null;
  }

  loadItems(focusedPostId) {
    const classes = ['thread-first', 'thread-middle', 'thread-last'];
    const set = [];

    // Clean up unrolled replies and sidecar containers from previous load
    // Exclude elements inside post-view-modal to avoid affecting the modal's sidecar
    $('.unrolled-replies').not('.post-view-modal *').remove();
    $('.sidecar-replies').not('.post-view-modal *').remove();
    // Clear tracked unrolled post IDs when unrolled content is removed
    this.unrolledPostIds.clear();
    // Remove unrolled-duplicate class from items
    $('.unrolled-duplicate').removeClass('unrolled-duplicate filtered');

    // Clean up empty thread containers (threads with no visible items)
    $('div.thread').each((i, thread) => {
      const hasVisibleItems = $(thread).find(this.selector).filter(':visible').length > 0;
      if (!hasVisibleItems) {
        $(thread).remove();
      }
    });

    $(this.items).css('opacity', '0%');
    let itemIndex = 0;
    let threadIndex = 0;
    let threadOffset = 0;

    $(this.selector)
      .filter(':visible')
      .each((i, item) => {
        $(item).attr('data-bsky-navigator-item-index', itemIndex++);
        $(item).parent().parent().attr('data-bsky-navigator-thread-index', threadIndex);

        const threadDiv = $(item).parent().parent();
        if (classes.some((cls) => $(threadDiv).hasClass(cls))) {
          set.push(threadDiv[0]);
          $(item).attr('data-bsky-navigator-thread-offset', threadOffset);
          threadOffset++;
          if ($(threadDiv).hasClass('thread-last')) {
            threadIndex++;
            threadOffset = 0;
          }
        }
      });

    this.sortItems();
    this.filterItems();

    // Filter out embedded posts (posts that are inside another post)
    // Also filter out "View full thread" placeholders (they match selector but have no data-testid)
    this.items = $(this.selector).filter(':visible').filter((i, item) => {
      // Check if this item is inside another item matching the selector
      if ($(item).parents(this.selector).length > 0) return false;
      // Exclude "View full thread" elements - real posts have data-testid="feedItem-by-..."
      const testId = $(item).attr('data-testid') || '';
      if (!testId.startsWith('feedItem-by-') && !testId.startsWith('postThreadItem-by-')) return false;
      return true;
    });

    // Re-setup intersection observer for the new items
    this.visibleItems = [];
    this.setupIntersectionObserver();

    this.itemStats.oldest = this.itemStats.newest = null;
    $(this.selector)
      .filter(':visible')
      .each((i, item) => {
        const timestamp = this.getTimestampForItem(item);
        if (!this.itemStats.oldest || timestamp < this.itemStats.oldest) {
          this.itemStats.oldest = timestamp;
        }
        if (!this.itemStats.newest || timestamp > this.itemStats.newest) {
          this.itemStats.newest = timestamp;
        }

        // Add empty sidecar container placeholder (actual content loads on selection)
        // Skip on mobile view
        if (
          !this.state.mobileView &&
          this.config.get('showReplySidecar') &&
          $(this.selectedItem).closest('.thread').outerWidth() >=
            this.config.get('showReplySidecarMinimumWidth')
        ) {
          if (!$(item).parent().find('.sidecar-replies').length) {
            // Add empty placeholder - content loads lazily on selection
            $(item).parent().append('<div class="sidecar-replies sidecar-replies-empty"></div>');
          }
        }
      });

    this.enableFooterObserver();

    if (this.index != null) {
      this.applyItemStyle(this.selectedItem, true);
    }

    this.applyThreadIndicatorStyles();

    $(this.selector).on('mouseover', this.onItemMouseOver);
    $(this.selector).closest('div.thread').addClass('bsky-navigator-seen');
    $(this.selector)
      .closest('div.thread')
      .removeClass(['loading-indicator-reverse', 'loading-indicator-forward']);

    this.refreshItems();

    this.loading = false;
    $('img#loadOlderIndicatorImage').addClass('image-highlight');
    $('img#loadOlderIndicatorImage').removeClass('toolbar-icon-pending');

    if (focusedPostId) {
      this.jumpToPost(focusedPostId);
    } else if (!this.jumpToPost(this.postId)) {
      this.setIndex(0);
      // Ensure sidecar opens on initial load
      this.expandItem(this.selectedItem);
    }

    this.updateInfoIndicator();
    this.enableFooterObserver();

    if ($(this.items).filter(':visible').length == 0) {
      this.showMessage(
        'No more unread posts.',
        `<p>You're all caught up.</p><div id="messageActions"/>`
      );
      if ($('#loadOlderAction').length == 0) {
        $('#messageActions').append($('<div id="loadOlderAction"><a>Load older posts</a></div>'));
        $('#loadOlderAction > a').on('click', () => this.loadOlderItems());
      }
      if ($('img#loadNewerIndicatorImage').hasClass('image-highlight')) {
        $('#messageActions').append($('<div id="loadNewerAction"><a>Load newer posts</a></div>'));
        $('#loadNewerAction > a').on('click', () => this.loadNewerItems());
      }
    } else {
      this.hideMessage();
    }

    // Re-enable mouse focus after loading
    this.ignoreMouseMovement = false;
  }

  applyThreadIndicatorStyles() {
    $('div.r-1mhb1uw').each((i, el) => {
      const ancestor = $(el).parent().parent().parent().parent();
      $(el).parent().parent().parent().addClass('item-selection-inactive');
      if ($(ancestor).prev().find('div.item-unread').length) {
        $(el).parent().parent().parent().addClass('item-unread');
        $(el).parent().parent().parent().removeClass('item-read');
      } else {
        $(el).parent().parent().parent().addClass('item-read');
        $(el).parent().parent().parent().removeClass('item-unread');
      }
    });
    $('div.r-1mhb1uw svg').each((i, el) => {
      $(el).find('line').attr('stroke', this.config.get('threadIndicatorColor'));
      $(el).find('circle').attr('fill', this.config.get('threadIndicatorColor'));
    });
  }

  refreshItems() {
    $(this.items).each((index, _item) => {
      this.applyItemStyle(this.items[index], index == this.index);
    });
    $(this.items).css('opacity', '100%');
  }

  updateInfoIndicator() {
    // Use this.items but filter out items with .filtered class
    const allItems = this.items;
    const visibleItems = $(allItems).not('.filtered');
    const filteredItems = $(allItems).filter('.filtered');

    this.itemStats.unreadCount = visibleItems.filter('.item-unread').length;
    this.itemStats.filteredCount = filteredItems.length;
    this.itemStats.shownCount = visibleItems.length;

    // Find current index within visible items only
    const visibleIndex = visibleItems.index(this.selectedItem);
    const index = this.itemStats.shownCount ? visibleIndex + 1 : 0;

    // Build stats string - only show filtered count if there are filtered items
    const filterStats = this.itemStats.filteredCount > 0 ? `<strong>${this.itemStats.filteredCount}</strong> filtered, ` : '';
    $('div#infoIndicatorText').html(`
<div id="itemCountStats">
<strong>${index}${this.threadIndex != null ? `<small>.${this.threadIndex + 1}</small>` : ''}</strong>/<strong>${this.itemStats.shownCount}</strong> (${filterStats}<strong>${this.itemStats.unreadCount}</strong> new)
</div>
<div id="itemTimestampStats">
${
  this.itemStats.oldest
    ? `${dateFns.format(this.itemStats.oldest, 'yyyy-MM-dd hh:mmaaa')} - ${dateFns.format(this.itemStats.newest, 'yyyy-MM-dd hh:mmaaa')}</div>`
    : ``
}`);

    if (
      this.config.get('showPostCounts') == 'All' ||
      (this.selectedItem && this.config.get('showPostCounts') == 'Selection')
    ) {
      const bannerDiv = $(this.selectedItem).find('div.item-banner').first().length
        ? $(this.selectedItem).find('div.item-banner').first()
        : $(this.selectedItem)
            .find('div')
            .first()
            .prepend($('<div class="item-banner"/>'))
            .children('.item-banner')
            .last();
      $(bannerDiv).html(
        `<strong>${index}${this.threadIndex != null ? `<small>.${this.threadIndex + 1}/${this.unrolledReplies.length + 1}</small>` : ''}</strong>/<strong>${this.itemStats.shownCount}</strong>`
      );
    }
  }

  loadNewerItems() {
    // Try to find the button if not already set
    if (!this.loadNewerButton) {
      const button = $(constants.LOAD_NEW_BUTTON_SELECTOR)[0];
      if (button) {
        this.loadNewerButton = button;
        console.log('[bsky-navigator] Found load new button:', button);
      } else {
        console.log('[bsky-navigator] No load new button found');
        return;
      }
    }
    this.loadingNew = true;
    this.hideNewPostsPill();
    this.applyItemStyle(this.selectedItem, false);
    const oldPostId = this.postIdForItem(this.selectedItem);
    $(this.loadNewerButton).click();
    setTimeout(() => {
      this.loadItems(oldPostId);
      $('img#loadNewerIndicatorImage').removeClass('image-highlight');
      $('img#loadNewerIndicatorImage').removeClass('toolbar-icon-pending');
      $('#loadNewerAction').remove();
      this.loadingNew = false;
      // Clear button reference and restart observer to detect new buttons
      this.loadNewerButton = null;
      this.setupLoadNewerObserver();
    }, 1000);
  }

  loadOlderItems() {
    if (this.loading) return;

    // Get the stored callback and sentinel from the IntersectionObserver proxy
    const loadMoreCallback = unsafeWindow.__bskyNavGetLoadMoreCallback?.();
    const loadMoreSentinel = unsafeWindow.__bskyNavGetLoadMoreSentinel?.();

    if (!loadMoreCallback) {
      console.log('[bsky-navigator] No load-more callback available');
      return;
    }

    if (!loadMoreSentinel) {
      console.log('[bsky-navigator] No load-more sentinel available');
      return;
    }

    console.log('[bsky-navigator] Loading more posts via sentinel:', loadMoreSentinel);
    $('img#loadOlderIndicatorImage').removeClass('image-highlight');
    $('img#loadOlderIndicatorImage').addClass('toolbar-icon-pending');
    this.loading = true;
    const reversed = this.state.feedSortReverse;
    const index = reversed ? 0 : this.items.length - 1;
    this.setIndex(index);
    this.updateItems();
    const indicatorElement = this.items.length ? this.items[index] : $(this.selector).eq(index)[0];
    $(indicatorElement)
      .closest('div.thread')
      .addClass(
        this.state.feedSortReverse ? 'loading-indicator-forward' : 'loading-indicator-reverse'
      );

    // Use the actual sentinel element that Bluesky's observer is watching
    loadMoreCallback([
      {
        time: performance.now(),
        target: loadMoreSentinel,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: loadMoreSentinel.getBoundingClientRect(),
        intersectionRect: loadMoreSentinel.getBoundingClientRect(),
        rootBounds: document.documentElement.getBoundingClientRect(),
      },
    ]);

    // Fallback timeout to reset loading state if items don't trigger loadItems()
    // This handles edge cases where new items aren't detected by the MutationObserver
    setTimeout(() => {
      if (this.loading) {
        console.log('[bsky-navigator] Loading timeout - resetting state');
        this.loading = false;
        $('img#loadOlderIndicatorImage').addClass('image-highlight');
        $('img#loadOlderIndicatorImage').removeClass('toolbar-icon-pending');
        this.loadItems();
      }
    }, 3000);
  }
}
