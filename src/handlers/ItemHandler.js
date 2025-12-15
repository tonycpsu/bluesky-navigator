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
import { NavigableList } from '../utils/NavigableList.js';
import icons from '../icons.js';

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

  // Use shared color palette from constants
  FILTER_LIST_COLORS = constants.FILTER_LIST_COLORS;

  FLOATING_BUTTON_IMAGES = {
    prev: [icons.upArrow],
    next: [icons.downArrow],
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
    this.onProfileHoverCardAdd = this.onProfileHoverCardAdd.bind(this);
    this.onProfileHoverCardRemove = this.onProfileHoverCardRemove.bind(this);

    // Performance logging state
    this._perfLog = [];
    this._perfCallCounts = {};
    this._perfLastReport = Date.now();
  }

  /**
   * Log performance metrics when performanceLogging is enabled.
   * Tracks call counts, timing, and can detect runaway loops.
   */
  perfLog(label, durationMs = null) {
    if (!this.config.get('performanceLogging')) return;

    const now = Date.now();
    const entry = {
      time: now,
      label,
      duration: durationMs,
    };

    // Track call counts per label
    this._perfCallCounts[label] = (this._perfCallCounts[label] || 0) + 1;

    // Keep last 500 entries
    this._perfLog.push(entry);
    if (this._perfLog.length > 500) this._perfLog.shift();

    // Log to console
    if (durationMs !== null) {
      console.log(`[perf] ${label}: ${durationMs.toFixed(1)}ms`);
    } else {
      console.log(`[perf] ${label} (count: ${this._perfCallCounts[label]})`);
    }

    // Periodic summary every 10 seconds
    if (now - this._perfLastReport > 10000) {
      this._perfLastReport = now;
      const summary = Object.entries(this._perfCallCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      console.log(`[perf] === 10s summary === ${summary}`);

      // Warn if any function called excessively (>100 times in 10s)
      Object.entries(this._perfCallCounts).forEach(([k, v]) => {
        if (v > 100) {
          console.warn(`[perf] WARNING: ${k} called ${v} times in 10s - possible runaway loop!`);
        }
      });

      // Reset counts
      this._perfCallCounts = {};
    }
  }

  /**
   * Start a performance timer. Returns a function to call when done.
   */
  perfStart(label) {
    if (!this.config.get('performanceLogging')) return () => {};
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.perfLog(label, duration);
    };
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

    // Watch for hover card portals (added as direct children of body)
    // Using custom observer instead of waitForElement to avoid interfering with Bluesky's render
    this.hoverCardObserver = new MutationObserver(() => {
      this.perfLog('hoverCardObserver mutation');
      // Debounce and defer processing to avoid interfering with Bluesky's render cycle
      if (this.hoverCardDebounce) return;
      this.hoverCardDebounce = requestAnimationFrame(() => {
        this.hoverCardDebounce = null;
        const hoverCardAvatar = document.querySelector(
          'div[data-testid="userAvatarImage"][style*="width: 64px"]'
        );
        if (hoverCardAvatar && !this.currentHoverCard) {
          this.onProfileHoverCardAdd(hoverCardAvatar);
        } else if (!hoverCardAvatar && this.currentHoverCard) {
          this.currentHoverCard = null;
        }
      });
    });

    // Watch body and subtree, but defer processing with requestAnimationFrame
    this.hoverCardObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

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
        // Show sidecar toggle after scrolling stops (if sidecar is hidden and post is selected)
        if (this.isFixedSidecar() &&
            this.config.get('fixedSidecarVisible') === false &&
            this.selectedItem && this.selectedItem.length) {
          this.positionFixedSidecarToggle();
          $('#fixed-sidecar-toggle').addClass('visible');
        }
      }, 500);
    });

    super.activate();
  }

  deactivate() {
    if (this.floatingButtonsObserver) this.floatingButtonsObserver.disconnect();
    if (this.observer) this.observer.disconnect();
    if (this.popupObserver) this.popupObserver.disconnect();
    if (this.hoverCardObserver) this.hoverCardObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    this.disableFooterObserver();

    if (this.hoverDebounceTimeout) clearTimeout(this.hoverDebounceTimeout);
    if (this.intersectionDebounceTimeout) clearTimeout(this.intersectionDebounceTimeout);

    // Hide sidecar toggle when leaving feed
    $('#fixed-sidecar-toggle').removeClass('visible');

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
    this.sidecarNavList = null;
    this.threadNavList = null;
    // Hide the sidecar toggle when selection is cleared
    $('#fixed-sidecar-toggle').removeClass('visible');
  }

  /**
   * Create or get the sidecar NavigableList for reply navigation
   */
  getSidecarNavList() {
    if (!this.sidecarNavList) {
      this.sidecarNavList = new NavigableList({
        getItems: () => this.getSidecarReplies(),
        selectedClass: 'reply-selection-active',
        autoScroll: false, // We handle scrolling ourselves
        onSelect: (item, index) => {
          // Update parent item styling to show child is focused
          $(this.selectedItem).addClass('item-selection-child-focused');
          $(this.selectedItem).removeClass('item-selection-active');
          // Custom scroll handling
          this.scrollSidecarToReply(item);
        },
      });
    }
    return this.sidecarNavList;
  }

  /**
   * Create or get the thread NavigableList for unrolled thread navigation
   */
  getThreadNavList() {
    if (!this.threadNavList) {
      this.threadNavList = new NavigableList({
        getItems: () => this.getUnrolledThreadPosts(),
        selectedClass: 'reply-selection-active',
        autoScroll: false, // We handle scrolling ourselves
        onSelect: (item, index) => {
          // Update parent item styling to show child is focused
          $(this.selectedItem).addClass('item-selection-child-focused');
          $(this.selectedItem).removeClass('item-selection-active');
          // Custom scroll handling for thread posts
          this.scrollThreadPostIntoView(item);
        },
      });
    }
    return this.threadNavList;
  }

  /**
   * Get unrolled thread posts (main post + unrolled replies) for navigation
   */
  getUnrolledThreadPosts() {
    if (!this.selectedItem || !this.unrolledReplies.length) return [];
    // Return array: [main post, ...unrolled replies]
    const mainPost = $(this.selectedItem).find('div[data-testid="contentHider-post"]').first();
    return [mainPost[0], ...this.unrolledReplies.toArray()];
  }

  /**
   * Scroll a thread post into view within the unrolled thread container
   */
  scrollThreadPostIntoView(post) {
    if (!post) return;

    // Find the scroll container (parent of contentHider-post with overflow-y: scroll)
    const scrollContainer = $(this.selectedItem).find('div[data-testid="contentHider-post"]').first().parent()[0];

    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      // Container is scrollable - scroll within it
      const containerRect = scrollContainer.getBoundingClientRect();
      const postRect = post.getBoundingClientRect();

      // Calculate position relative to container
      const postTopInContainer = postRect.top - containerRect.top + scrollContainer.scrollTop;
      const targetScrollTop = postTopInContainer - 10; // 10px padding from top

      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant',
      });
    } else {
      // Fallback to window scroll if no scroll container
      const rect = post.getBoundingClientRect();
      const toolbarHeight = this.getToolbarHeight();
      const scrollNeeded = rect.top - toolbarHeight - 10;

      if (Math.abs(scrollNeeded) > 50) {
        this.ignoreMouseMovement = true;
        window.scrollBy({
          top: scrollNeeded,
          behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant',
        });
        setTimeout(() => {
          this.ignoreMouseMovement = false;
        }, 500);
      }
    }
  }

  set index(value) {
    this._index = value;
    this._threadIndex = null;
    this._replyIndex = null;
    // Reset navLists for new item (they'll be recreated on demand)
    this.sidecarNavList = null;
    this.threadNavList = null;
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
    return this.getSidecarReplies().eq(index);
  }

  get selectedReply() {
    if (this._replyIndex == null) return $();
    return $(this.getSidecarNavList().getSelectedItem());
  }

  get replyIndex() {
    return this._replyIndex;
  }

  set replyIndex(value) {
    const replies = this.getSidecarReplies();

    // Handle null - deactivate sidecar focus
    if (value == null) {
      if (this._replyIndex != null) {
        this.getSidecarNavList().clearSelection();
        $(this.selectedItem).addClass('item-selection-active');
        $(this.selectedItem).removeClass('item-selection-child-focused');
      }
      this._replyIndex = null;
      return;
    }

    // Bounds check
    if (value < 0 || value >= replies.length) {
      return;
    }

    // Activate or navigate sidecar
    const navList = this.getSidecarNavList();
    const wasNull = this._replyIndex == null;

    if (wasNull) {
      // First activation - reset and jump to requested index
      navList.reset();
      if (value > 0) {
        navList.jumpTo(value);
      } else {
        navList.updateSelection();
      }
    } else {
      // Already active - navigate to new index
      navList.jumpTo(value);
    }

    this._replyIndex = navList.getSelectedIndex();
  }

  get threadIndex() {
    return this._threadIndex;
  }

  set threadIndex(value) {
    const posts = this.getUnrolledThreadPosts();

    // Handle exiting thread at the start - go to previous main post
    if (value < 0) {
      if (this._threadIndex != null) {
        this.getThreadNavList().clearSelection();
        $(this.selectedItem).addClass('item-selection-active');
        $(this.selectedItem).removeClass('item-selection-child-focused');
      }
      this._threadIndex = null;
      // Navigate to previous main post
      this.setIndex(this.index - 1, false, false);
      if (!this.isElementFullyVisible(this.selectedItem)) {
        this.scrollElementIntoView(this.selectedItem[0], -1);
      }
      return;
    }

    // Handle exiting thread at the end - go to next main post
    if (value >= posts.length) {
      if (this._threadIndex != null) {
        this.getThreadNavList().clearSelection();
        $(this.selectedItem).addClass('item-selection-active');
        $(this.selectedItem).removeClass('item-selection-child-focused');
      }
      this._threadIndex = null;
      // Navigate to next main post
      this.setIndex(this.index + 1, false, false);
      if (!this.isElementFullyVisible(this.selectedItem)) {
        this.scrollElementIntoView(this.selectedItem[0], 1);
      }
      return;
    }

    // Handle null - deactivate thread focus
    if (value == null) {
      if (this._threadIndex != null) {
        this.getThreadNavList().clearSelection();
        $(this.selectedItem).addClass('item-selection-active');
        $(this.selectedItem).removeClass('item-selection-child-focused');
      }
      this._threadIndex = null;
      this.updateInfoIndicator();
      return;
    }

    // Activate or navigate thread
    const navList = this.getThreadNavList();
    const wasNull = this._threadIndex == null;

    if (wasNull) {
      // First activation - reset and jump to requested index
      navList.reset();
      if (value > 0) {
        navList.jumpTo(value);
      } else {
        navList.updateSelection();
      }
    } else {
      // Already active - navigate to new index
      navList.jumpTo(value);
    }

    this._threadIndex = navList.getSelectedIndex();
    this.updateInfoIndicator();
  }

  get unrolledReplies() {
    return $(this.selectedItem).find('.unrolled-reply');
  }

  /**
   * Check if fixed sidecar mode is enabled (vs inline)
   * Handles both new string values ('Fixed'/'Inline') and legacy boolean (true/false)
   */
  isFixedSidecar() {
    const value = this.config.get('fixedSidecar');
    // Handle legacy boolean true or new 'Fixed' string
    return value === true || value === 'Fixed';
  }

  getPostForThreadIndex(index) {
    const posts = this.getUnrolledThreadPosts();
    return $(posts[index]);
  }

  get selectedPost() {
    if (this._threadIndex == null) return $();
    return $(this.getThreadNavList().getSelectedItem());
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
    // Be defensive - old item may have been removed from DOM by React
    const oldItem = this.items[oldIndex];
    if (oldItem && document.contains(oldItem)) {
      this.applyItemStyle(oldItem, false);
    }
    this.index = index;
    // Also check new item is in DOM (should always be, but be safe)
    if (this.selectedItem && document.contains($(this.selectedItem)[0])) {
      this.applyItemStyle(this.selectedItem, true);
    }

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
    const replies = this.getSidecarReplies();
    return replies.filter(':visible').index(item);
  }

  /**
   * Get the jQuery collection of sidecar replies, handling both inline and fixed sidecar modes
   */
  getSidecarReplies() {
    if (this.isFixedSidecar() && $('#fixed-sidecar-panel').hasClass('visible')) {
      return $('#fixed-sidecar-panel .fixed-sidecar-panel-content').find('div.sidecar-post');
    }
    return $(this.selectedItem).parent().find('div.sidecar-post');
  }

  /**
   * Get the sidecar container element for scrolling purposes
   */
  getSidecarContainer() {
    if (this.isFixedSidecar() && $('#fixed-sidecar-panel').hasClass('visible')) {
      return $('#fixed-sidecar-panel .fixed-sidecar-panel-content');
    }
    return $(this.selectedItem).parent().find('.sidecar-replies');
  }

  /**
   * Check if sidecar navigation is available (either inline or fixed sidecar with content)
   */
  isSidecarNavigationAvailable() {
    if (!this.config.get('showReplySidecar')) return false;

    // For fixed sidecar, check if panel is visible and has replies
    if (this.isFixedSidecar()) {
      const panel = $('#fixed-sidecar-panel');
      if (!panel.hasClass('visible')) return false;
    }

    // Check if there are any replies to navigate
    const replies = this.getSidecarReplies();
    return replies.length > 0;
  }

  /**
   * Scroll to a reply within the sidecar, handling both inline and fixed sidecar modes
   */
  scrollSidecarToReply(replyElement) {
    if (this.isFixedSidecar() && $('#fixed-sidecar-panel').hasClass('visible')) {
      // For fixed sidecar, scroll within the panel container
      const container = $('#fixed-sidecar-panel .fixed-sidecar-panel-content')[0];
      if (container && replyElement) {
        const containerRect = container.getBoundingClientRect();
        const replyRect = replyElement.getBoundingClientRect();

        // Check if reply is outside visible area of container
        if (replyRect.top < containerRect.top || replyRect.bottom > containerRect.bottom) {
          replyElement.scrollIntoView({
            behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant',
            block: 'nearest'
          });
        }
      }
    } else {
      // For inline sidecar, scroll the main window
      this.scrollToElement(replyElement, 'nearest');
    }
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

    // Initialize fixed sidecar panel if enabled
    if (this.isFixedSidecar() && this.config.get('showReplySidecar')) {
      this.initFixedSidecarPanel();
    }
  }

  /**
   * Initialize the fixed sidecar panel that displays thread context for the selected post
   */
  initFixedSidecarPanel() {
    // Remove any existing panel and toggle button
    $('#fixed-sidecar-panel').remove();
    $('#fixed-sidecar-toggle').remove();

    // Create the fixed panel
    this.fixedSidecarPanel = $(`
      <div id="fixed-sidecar-panel" class="fixed-sidecar-panel">
        <div class="fixed-sidecar-panel-header">
          <span class="fixed-sidecar-panel-title">Thread Context</span>
          <button class="fixed-sidecar-panel-close" aria-label="Close sidecar panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="fixed-sidecar-panel-content">
          <div class="fixed-sidecar-panel-empty">Select a post to see thread context</div>
        </div>
      </div>
    `);

    // Create the toggle button (will be attached to selected item)
    this.fixedSidecarToggle = $(`
      <button id="fixed-sidecar-toggle" class="fixed-sidecar-toggle" aria-label="Show thread context" title="Show thread context (t)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          <line x1="9" y1="10" x2="15" y2="10"/>
        </svg>
        <span class="fixed-sidecar-toggle-count"></span>
      </button>
    `);

    $('body').append(this.fixedSidecarPanel);
    // Toggle is not appended to body - it will be attached to selected item

    // Close button handler
    this.fixedSidecarPanel.find('.fixed-sidecar-panel-close').on('click', () => {
      this.config.set('fixedSidecarVisible', false);
      this.config.save();
      this.hideFixedSidecarPanel();
    });

    // Toggle button handler (use event delegation since toggle moves around)
    $(document).on('click', '#fixed-sidecar-toggle', async () => {
      await this.openFixedSidecarPanel();
    });

    // Update panel position on resize (toggle doesn't need repositioning - it's attached to item)
    $(window).on('resize.fixedSidecar', () => {
      if ($('#fixed-sidecar-panel').hasClass('visible')) {
        this.positionFixedSidecarPanel();
      }
    });
  }

  /**
   * Position the fixed sidecar panel next to the feed container
   */
  positionFixedSidecarPanel() {
    const panel = $('#fixed-sidecar-panel');
    if (!panel.length) return;

    // Find the feed container or use the selected item's thread container
    let feedContainer = null;
    if (this.selectedItem) {
      feedContainer = $(this.selectedItem).closest('.thread')[0];
    }
    if (!feedContainer) {
      // Fallback: find the main feed area
      feedContainer = document.querySelector('main[role="main"] [style*="max-width"]');
    }

    if (feedContainer) {
      const rect = feedContainer.getBoundingClientRect();
      const gap = 16; // Gap between feed and sidecar
      const panelWidth = 350;

      // Position to the right of the feed container
      const left = rect.right + gap;

      // Check if there's enough space on the right
      const availableWidth = window.innerWidth - left;
      if (availableWidth >= panelWidth) {
        panel.css({
          left: `${left}px`,
          right: 'auto',
          top: `${rect.top}px`
        });
      } else {
        // Fall back to right-aligned if not enough space
        panel.css({
          left: 'auto',
          right: '16px',
          top: `${rect.top}px`
        });
      }
    }
  }

  /**
   * Show the fixed sidecar panel
   */
  showFixedSidecarPanel() {
    this.positionFixedSidecarPanel();
    $('#fixed-sidecar-panel').addClass('visible');
    $('#fixed-sidecar-toggle').removeClass('visible');
  }

  /**
   * Hide the fixed sidecar panel
   */
  hideFixedSidecarPanel() {
    $('#fixed-sidecar-panel').removeClass('visible');
    this.positionFixedSidecarToggle();
    $('#fixed-sidecar-toggle').addClass('visible');
  }

  /**
   * Attach the toggle button to the selected item so it scrolls with it
   */
  positionFixedSidecarToggle() {
    const toggle = this.fixedSidecarToggle;
    if (!toggle || !toggle.length) return;

    // Get the selected item
    const $item = this.selectedItem;
    if (!$item || !$item.length) {
      // No item selected - detach toggle
      toggle.detach();
      return;
    }

    // Find the item's container (the post wrapper that has position: relative)
    // Look for the closest element that can serve as positioning context
    let container = $item;

    // Ensure the container has relative positioning for absolute child
    if (container.css('position') === 'static') {
      container.css('position', 'relative');
    }

    // Attach toggle to this item if not already there
    if (!container.find('#fixed-sidecar-toggle').length) {
      toggle.detach();
      container.append(toggle);
    }
  }

  /**
   * Open the fixed sidecar panel with current item's thread
   */
  async openFixedSidecarPanel() {
    if (!this.api) {
      console.warn('[bsky-nav] openFixedSidecarPanel: API not initialized');
      return;
    }

    // If no items loaded yet, trigger a load first
    if (!this.items?.length) {
      await this.loadItems();
    }

    // If no item is selected, select the first one
    if (!this.selectedItem?.length && this.items?.length > 0) {
      this.setIndex(0, true);
    }

    if (!this.selectedItem?.length) {
      console.warn('[bsky-nav] openFixedSidecarPanel: no items available');
      return;
    }

    this.config.set('fixedSidecarVisible', true);
    this.config.save();

    const thread = await this.getThreadForItem(this.selectedItem);
    if (thread) {
      await this.updateFixedSidecarPanel(this.selectedItem, thread);
    }
  }

  /**
   * Toggle the fixed sidecar panel visibility
   */
  async toggleFixedSidecarPanel(item) {
    const panel = $('#fixed-sidecar-panel');
    if (panel.hasClass('visible')) {
      this.config.set('fixedSidecarVisible', false);
      this.config.save();
      this.hideFixedSidecarPanel();
    } else if (item && this.api) {
      this.config.set('fixedSidecarVisible', true);
      this.config.save();
      // Show and update with current item's thread
      const thread = await this.getThreadForItem(item);
      if (thread) {
        await this.updateFixedSidecarPanel(item, thread);
      }
    }
  }

  /**
   * Update the fixed sidecar panel with content for the given item
   */
  async updateFixedSidecarPanel(item, thread) {
    if (!this.fixedSidecarPanel || !document.contains(this.fixedSidecarPanel[0])) {
      this.initFixedSidecarPanel();
    }

    // Use direct DOM selection to avoid stale jQuery reference
    const contentContainer = $('#fixed-sidecar-panel .fixed-sidecar-panel-content');

    // Show loading skeleton
    contentContainer.html(this.getSkeletonContent());

    // Wait for selected item to stop moving before positioning panel
    await this.waitForElementStable(item);
    this.showFixedSidecarPanel();

    // Get the sidecar content
    const sidecarContent = await this.getSidecarContent(item, thread);

    // Update the panel content
    contentContainer.html(sidecarContent);

    // Initialize event handlers for sidecar posts
    contentContainer.find('.sidecar-post').each((i, post) => {
      $(post).on('mouseover', this.onSidecarItemMouseOver);
    });

    // Initialize collapsible sections
    contentContainer.find('.sidecar-section-toggle').each((i, toggle) => {
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
  }

  /**
   * Clear the fixed sidecar panel content
   */
  clearFixedSidecarPanel() {
    if (this.fixedSidecarPanel) {
      const contentContainer = this.fixedSidecarPanel.find('.fixed-sidecar-panel-content');
      contentContainer.html('<div class="fixed-sidecar-panel-empty">Select a post to see thread context</div>');
    }
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

      // Hide "View full thread" element that follows unrolled threads (it's redundant)
      // Get the root post ID from the unrolled thread
      const rootPostId = thread.post.uri?.split('/').slice(-1)[0];
      console.log('[hideViewFullThread] rootPostId:', rootPostId, 'unrolledIds:', unrolledIds);
      if (rootPostId) {
        // Collect all post IDs in this thread (root + all unrolled replies)
        const threadPostIds = new Set([rootPostId, ...unrolledIds]);
        console.log('[hideViewFullThread] threadPostIds:', [...threadPostIds]);

        // Get the thread containing the unrolled item - we must NOT hide this one
        const unrolledThread = $(item).closest('.thread')[0];

        // Find and hide ALL "View full thread" elements in the feed that link to any post in this thread
        $('div.thread').each(function () {
          const threadEl = $(this);

          // Skip the thread containing our unrolled content
          if (this === unrolledThread) return;

          // Skip if already hidden
          if (threadEl.hasClass('unrolled-view-full-thread-hidden')) return;

          // Look for items with and without feedItem-by- testid
          const items = threadEl.find('[role="link"]');
          const realPosts = items.filter(function () {
            const testId = $(this).attr('data-testid') || '';
            return testId.startsWith('feedItem-by-') || testId.startsWith('postThreadItem-by-');
          });
          const viewFullThreadItems = items.filter(function () {
            const testId = $(this).attr('data-testid') || '';
            return !testId.startsWith('feedItem-by-') && !testId.startsWith('postThreadItem-by-');
          });

          // Only hide threads that ONLY contain "View full thread" (no real posts)
          if (viewFullThreadItems.length > 0 && realPosts.length === 0) {
            console.log('[hideViewFullThread] Found View full thread only element:', threadEl[0]);
            // Check if any link in this thread points to one of our thread's posts
            const links = threadEl.find('a[href*="/post/"]');
            console.log('[hideViewFullThread] Links found:', links.toArray().map(l => $(l).attr('href')));
            const matchesThread = links.toArray().some((link) => {
              const href = $(link).attr('href');
              const linkPostId = href?.split('/post/')[1]?.split('?')[0];
              console.log('[hideViewFullThread] Checking linkPostId:', linkPostId, 'in threadPostIds:', threadPostIds.has(linkPostId));
              return linkPostId && threadPostIds.has(linkPostId);
            });

            if (matchesThread) {
              console.log('[hideViewFullThread] HIDING thread:', threadEl[0]);
              threadEl.addClass('unrolled-view-full-thread-hidden');
              // CSS rule handles hiding with !important
            }
          }
        });
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
      .filter((reply) => {
        // Omit replies already shown in unrolled thread
        const replyPostId = reply.post.uri?.split('/').slice(-1)[0];
        return !replyPostId || !this.unrolledPostIds.has(replyPostId);
      })
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
    // If fixed sidecar is enabled, use the fixed panel instead of inline
    if (this.isFixedSidecar()) {
      // Don't show if user hid it with 't' key (persisted in config)
      if (this.config.get('fixedSidecarVisible') !== false) {
        await this.updateFixedSidecarPanel(item, thread);
      } else {
        // Show the toggle button when sidecar is hidden
        const toggle = $('#fixed-sidecar-toggle');

        // Show indicator if thread has context (parent or replies)
        const hasContext = thread && (thread.parent || (thread.replies && thread.replies.length > 0));
        toggle.toggleClass('has-context', hasContext);

        // Show reply count on toggle button (exclude self-replies when unrolling is enabled)
        let replyCount = thread?.replies?.length || 0;
        if (replyCount > 0 && this.shouldUnroll(item) && thread?.post?.author?.did) {
          const authorDid = thread.post.author.did;
          replyCount = thread.replies.filter((r) => r.post?.author?.did !== authorDid).length;
        }
        const countEl = toggle.find('.fixed-sidecar-toggle-count');
        if (replyCount > 0) {
          countEl.text(replyCount).show();
        } else {
          countEl.hide();
        }

        // Attach toggle to item and show it (it scrolls with the item)
        this.positionFixedSidecarToggle();
        toggle.addClass('visible');
      }
      return;
    }

    // Inline sidecar mode (original behavior)
    const container = $(item).parent();

    // Verify container still exists in DOM (React may have removed it)
    if (!container.length || !document.contains(container[0])) {
      return;
    }

    // Prevent duplicate sidecars - use data attribute as lock
    const itemKey = this.postIdForItem(item) || Date.now();
    if (container.data('sidecar-loading') === itemKey) {
      return; // Already loading for this item
    }
    container.data('sidecar-loading', itemKey);

    // Remove ALL existing sidecars first to prevent duplicates
    // Use native DOM removal with try-catch for each element
    container.find('.sidecar-replies').each((i, el) => {
      try {
        if (el.parentNode) el.parentNode.removeChild(el);
      } catch (e) {
        // Ignore - element may have been removed by React
      }
    });

    // Verify container still exists before appending
    if (!document.contains(container[0])) {
      container.removeData('sidecar-loading');
      return;
    }

    // Show skeleton while loading
    const skeletonContent = this.getSkeletonContent();
    $(container).append(skeletonContent);

    // Load actual content
    const sidecarContent = await this.getSidecarContent(item, thread);

    // Verify container still exists after async operation
    if (!document.contains(container[0])) {
      container.removeData('sidecar-loading');
      return;
    }

    // Remove skeleton and add actual content (in case multiple skeletons were added)
    container.find('.sidecar-replies').each((i, el) => {
      try {
        if (el.parentNode) el.parentNode.removeChild(el);
      } catch (e) {
        // Ignore - element may have been removed by React
      }
    });
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
    // Skip if rules dropdown is active
    if (this.rulesDropdownActive) {
      return false;
    }

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

      case 't':
        this.toggleFixedSidecarPanel(item);
        break;

      case '+':
        this.openAddToRulesForItem(item);
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
        const sidecarFocused = this.isSidecarNavigationAvailable() && this.replyIndex != null;
        if (['j', 'ArrowDown'].indexOf(event.key) != -1) {
          event.preventDefault();
          if (sidecarFocused) {
            this.replyIndex += 1;
          } else if (this.config.get('unrolledPostSelection') && this.unrolledReplies.length > 0 && this.threadIndex !== null) {
            // In unrolled thread (threadIndex is set)
            const currentThreadPost = this.getPostForThreadIndex(this.threadIndex);
            const isVisible = this.isElementFullyVisible(currentThreadPost);
            console.log('[thread-nav] j pressed, threadIndex:', this.threadIndex, 'unrolledReplies.length:', this.unrolledReplies.length, 'isVisible:', isVisible);
            if (!isVisible) {
              // Scroll current thread post into view (direction: down)
              // If scrollElementIntoView returns false, post scrolled past - continue to next
              if (!this.scrollElementIntoView(currentThreadPost[0], 1)) {
                // Post scrolled past - go to next
                if (this.threadIndex < this.unrolledReplies.length) {
                  if (event.key == 'j') this.markItemRead(this.index, true);
                  this.threadIndex += 1;
                } else {
                  this.jumpToNext(event.key == 'j');
                }
              }
            } else if (this.threadIndex < this.unrolledReplies.length) {
              // More posts in thread - go to next (setter handles scrolling)
              console.log('[thread-nav] advancing from', this.threadIndex, 'to', this.threadIndex + 1);
              if (event.key == 'j') {
                this.markItemRead(this.index, true);
              }
              this.threadIndex += 1;
            } else {
              // End of thread - go to next main post
              this.jumpToNext(event.key == 'j');
            }
          } else {
            // Normal post - check visibility first
            const isVisible = this.isElementFullyVisible(this.selectedItem);
            console.log('[nav] j pressed, isVisible:', isVisible, 'selectedItem:', this.selectedItem?.length, this.selectedItem?.[0]);
            if (!isVisible) {
              // Scroll to make the post visible (direction: down)
              // If scrollElementIntoView returns false, post scrolled past - jump to next
              if (!this.scrollElementIntoView(this.selectedItem[0], 1)) {
                moved = this.jumpToNext(event.key == 'j');
              }
            } else {
              moved = this.jumpToNext(event.key == 'j');
            }
          }
        } else if (['k', 'ArrowUp'].indexOf(event.key) != -1) {
          event.preventDefault();
          if (sidecarFocused) {
            this.replyIndex -= 1;
          } else if (this.config.get('unrolledPostSelection') && this.unrolledReplies.length > 0 && this.threadIndex !== null) {
            // In unrolled thread (threadIndex is set)
            const currentThreadPost = this.getPostForThreadIndex(this.threadIndex);
            if (!this.isElementFullyVisible(currentThreadPost)) {
              // Scroll current thread post into view (direction: up)
              // If scrollElementIntoView returns false, post scrolled past - continue to prev
              if (!this.scrollElementIntoView(currentThreadPost[0], -1)) {
                // Post scrolled past - go to prev
                if (this.threadIndex > 0) {
                  if (event.key == 'k') this.markItemRead(this.index, true);
                  this.threadIndex -= 1;
                } else {
                  this.jumpToPrev(event.key == 'k');
                }
              }
            } else if (this.threadIndex > 0) {
              // More posts in thread - go to previous (setter handles scrolling)
              if (event.key == 'k') {
                this.markItemRead(this.index, true);
              }
              this.threadIndex -= 1;
            } else {
              // Start of thread - go to previous main post
              this.jumpToPrev(event.key == 'k');
            }
          } else {
            // Normal post - check visibility first
            if (!this.isElementFullyVisible(this.selectedItem)) {
              // Scroll to make the post visible (direction: up)
              // If scrollElementIntoView returns false, post scrolled past - jump to prev
              if (!this.scrollElementIntoView(this.selectedItem[0], -1)) {
                moved = this.jumpToPrev(event.key == 'k');
              }
            } else {
              moved = this.jumpToPrev(event.key == 'k');
            }
          }
        } else if (event.key == 'PageDown') {
          event.preventDefault();
          if (sidecarFocused) {
            moved = this.jumpSidecarByPage(1);
          } else {
            moved = this.jumpByPage(1);
          }
        } else if (event.key == 'PageUp') {
          event.preventDefault();
          if (sidecarFocused) {
            moved = this.jumpSidecarByPage(-1);
          } else {
            moved = this.jumpByPage(-1);
          }
        } else if (event.key == 'Home') {
          event.preventDefault();
          if (sidecarFocused) {
            this.replyIndex = 0;
          } else {
            this.setIndex(0, false, true);
          }
          moved = true;
        } else if (event.key == 'End') {
          event.preventDefault();
          if (sidecarFocused) {
            const replies = this.getSidecarReplies();
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
          if (!this.isSidecarNavigationAvailable() || this.replyIndex == null) {
            return;
          }
          this.toggleFocus();
        } else if (event.key == 'ArrowRight') {
          event.preventDefault();
          if (!this.isSidecarNavigationAvailable() || this.replyIndex != null) {
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
    const replies = this.getSidecarReplies();
    if (!replies.length) return false;

    // Get the sidecar container height
    const sidecar = this.getSidecarContainer();
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
      const postUrl = this.urlForItem(post);
      if (!postUrl) {
        console.error('Failed to get post URL for like action', post);
        return;
      }
      const uri = await this.api.getAtprotoUri(postUrl);
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
              if (response.status !== 200 || !response.response) {
                console.error('[bsky-nav] Bad response for:', url);
                resolve({ url, dataUrl: null });
                return;
              }
              const reader = new FileReader();
              reader.onloadend = () => {
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

      // Wait for browser to process DOM changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Hide action buttons during capture (html2canvas has issues with flex layouts)
      const actionButtons = item.querySelectorAll('[data-testid="repostBtn"], [data-testid="likeBtn"], [data-testid="replyBtn"], [data-testid="postDropdownBtn"]');
      const hiddenButtons = [];
      actionButtons.forEach(btn => {
        const container = btn.closest('div[style*="flex"]') || btn.parentElement;
        if (container && container.style.display !== 'none') {
          hiddenButtons.push({ el: container, display: container.style.display });
          container.style.display = 'none';
        }
      });

      const canvas = await html2canvas(item, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      // Restore action buttons
      hiddenButtons.forEach(({ el, display }) => {
        el.style.display = display;
      });

      // Restore original values
      originalValues.forEach(({ el, attr, value }) => {
        if (attr === 'src') {
          el.src = value;
        } else if (attr === 'style-bg') {
          el.style.backgroundImage = value;
        }
      });

      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob,
            }),
          ]);

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

    // Check if this is an unrolled thread (has .unrolled-reply elements)
    const hasUnrolledThread = $(postElement).find('.unrolled-reply').length > 0;

    // Create modal instance if needed
    if (!this.postViewModal) {
      this.postViewModal = new PostViewModal(this.config, () => {
        // Callback when modal closes
        this.isPopupVisible = false;
      });
    }

    // Block feed keyboard handling while modal is open
    this.isPopupVisible = true;

    // Show modal immediately with loading state
    // Pass whether this is an unrolled thread to determine navigation selector
    this.postViewModal.show(postElement, null, hasUnrolledThread);

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
      this.postViewModal = new PostViewModal(this.config, () => {
        // Callback when modal closes
        this.isPopupVisible = false;
      });
    }

    // Block feed keyboard handling while modal is open
    this.isPopupVisible = true;

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

      $('img#loadNewerIndicatorImage').addClass('image-highlight');
      $('img#loadNewerIndicatorImage').removeClass('toolbar-icon-pending');

      // Add "Load newer posts" link to message actions if message is visible
      if ($('#messageActions').length && $('#loadNewerAction').length === 0) {
        $('#messageActions').append($('<div id="loadNewerAction"><a>Load newer posts</a></div>'));
        $('#loadNewerAction > a').on('click', () => this.loadNewerItems());
      }

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
    this.floatingButtonsObserver = waitForElement(
      this.state.mobileView ? constants.HOME_SCREEN_SELECTOR : constants.LEFT_SIDEBAR_SELECTOR,
      (container) => {
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
    this.perfLog('onItemAdded');
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
    this.perfLog('onScroll');
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
   * Includes any sticky tab bars (profile page, home feed tabs)
   */
  getToolbarHeight() {
    let height = 0;

    // Get navigator toolbar height
    const navigatorToolbar = $('#bsky-navigator-toolbar, #bsky-navigator-global-toolbar').filter(':visible').first();
    if (navigatorToolbar.length) {
      height += navigatorToolbar.outerHeight(true) || 0;
    }

    // Get tab bar height (profile page or home feed tabs)
    const tabBar = $('div[data-testid="profilePager"], div[data-testid="homeScreenFeedTabs"]').filter(':visible').first();
    if (tabBar.length) {
      height += tabBar.outerHeight(true) || 0;
    }

    // Add space for the focus ring outline (2px) plus a small buffer
    const focusRingSpace = 4;

    // Return at least a minimum height
    return Math.max(height, 60) + focusRingSpace;
  }

  /**
   * Get the height of the status bar at the bottom
   */
  getStatusBarHeight() {
    const statusBar = $('#statusBar');
    if (statusBar.length && statusBar.is(':visible')) {
      return statusBar.outerHeight() || 0;
    }
    return 0;
  }

  /**
   * Scroll to make an element more visible, accounting for toolbar and status bar.
   * For tall posts that don't fit, scrolls by a page amount.
   * Returns true if scrolled, false if element is already fully visible and should jump to next/prev.
   */
  scrollElementIntoView(element, direction = 1) {
    if (!element) return false;

    const el = element[0] || element;
    const rect = el.getBoundingClientRect();
    const toolbarHeight = this.getToolbarHeight();
    const statusBarHeight = this.getStatusBarHeight();
    const viewportHeight = window.innerHeight - toolbarHeight - statusBarHeight;
    const viewportBottom = window.innerHeight - statusBarHeight;

    let scrollAmount;

    // Check if post is taller than viewport
    const postHeight = rect.bottom - rect.top;
    if (postHeight > viewportHeight) {
      // Tall post handling
      if (direction > 0) {
        // Going down: check if bottom is visible
        if (rect.bottom <= viewportBottom) {
          // Bottom is visible - jump to next post
          console.log('[scroll] tall post bottom visible, jumping to next');
          return false;
        }
        // Scroll down to show more of the post (by half viewport or remaining distance)
        const remaining = rect.bottom - viewportBottom;
        scrollAmount = Math.min(viewportHeight * 0.5, remaining + 10);
      } else {
        // Going up: check if top is visible
        if (rect.top >= toolbarHeight) {
          // Top is visible - jump to prev post
          console.log('[scroll] tall post top visible, jumping to prev');
          return false;
        }
        // Scroll up to show more of the post (by half viewport or remaining distance)
        const remaining = toolbarHeight - rect.top;
        scrollAmount = -Math.min(viewportHeight * 0.5, remaining + 10);
      }
    } else if (rect.top < toolbarHeight) {
      // Normal post above viewport - scroll up to show top
      // But if bottom would go off-screen and post almost fits, consider it visible
      const topOverlap = toolbarHeight - rect.top;
      const bottomOverlap = rect.bottom - viewportBottom;
      if (bottomOverlap > 0 && topOverlap < 20 && bottomOverlap < 20) {
        // Post almost fits, both edges just slightly off - consider visible
        console.log('[scroll] post almost fits (top overlap:', topOverlap, 'bottom overlap:', bottomOverlap, ') - skipping');
        return false;
      }
      scrollAmount = rect.top - toolbarHeight - 10;
    } else if (rect.bottom > viewportBottom) {
      // Normal post below viewport - scroll to show bottom
      // But if top would go off-screen and post almost fits, consider it visible
      const bottomOverlap = rect.bottom - viewportBottom;
      const topGap = rect.top - toolbarHeight;
      if (topGap < 20 && bottomOverlap < 20) {
        // Post almost fits, both edges just slightly off - consider visible
        console.log('[scroll] post almost fits (top gap:', topGap, 'bottom overlap:', bottomOverlap, ') - skipping');
        return false;
      }
      // If post fits in viewport, align top with toolbar; otherwise just show more of bottom
      const scrollToShowTop = rect.top - toolbarHeight - 10;
      const scrollToShowBottom = rect.bottom - viewportBottom + 10;
      // Use whichever scroll amount actually moves the viewport
      scrollAmount = Math.max(scrollToShowTop, scrollToShowBottom);
    } else {
      // Already visible, shouldn't happen but handle gracefully
      return true;
    }

    console.log('[scroll] scrolling by', scrollAmount, 'postHeight:', postHeight, 'viewportHeight:', viewportHeight);

    this.ignoreMouseMovement = true;
    window.scrollBy({
      top: scrollAmount,
      behavior: this.config.get('enableSmoothScrolling') ? 'smooth' : 'instant',
    });

    setTimeout(() => {
      this.ignoreMouseMovement = false;
    }, 500);

    return true;
  }

  /**
   * Check if an element is fully visible in the viewport,
   * accounting for toolbar and status bar.
   */
  isElementFullyVisible(element) {
    if (!element || (element.length !== undefined && element.length === 0)) return false;

    const el = element[0] || element;
    const rect = el.getBoundingClientRect();

    const toolbarHeight = this.getToolbarHeight();
    const statusBarHeight = this.getStatusBarHeight();

    const viewportTop = toolbarHeight;
    const viewportBottom = window.innerHeight - statusBarHeight;

    const isVisible = rect.top >= viewportTop && rect.bottom <= viewportBottom;
    console.log('[visibility]', { top: rect.top, bottom: rect.bottom, viewportTop, viewportBottom, isVisible });

    // Element is fully visible if entirely within the unobstructed viewport
    return isVisible;
  }

  onPopupAdd() {
    this.isPopupVisible = true;
  }

  onPopupRemove() {
    this.isPopupVisible = false;
  }

  /**
   * Called when a profile hover card appears in the DOM
   */
  onProfileHoverCardAdd(avatarElement) {
    // Find the card container (parent with width: 300px)
    let card = avatarElement.closest('div[style*="width: 300px"]');
    if (!card) {
      card = avatarElement.closest('div[style*="will-change: transform"]')?.querySelector('div[style*="width: 300px"]');
    }
    if (!card) return;

    // Set currentHoverCard to prevent re-processing
    this.currentHoverCard = card;

    // Don't add button if already present
    if (card.querySelector('.bsky-nav-add-to-rules-btn')) return;

    // Extract handle from profile link
    const profileLink = card.querySelector('a[href^="/profile/"]');
    if (!profileLink) return;

    const href = profileLink.getAttribute('href');
    const handle = href.replace('/profile/', '').split('/')[0];

    // Find the follow button to position our button near it
    const followButton = card.querySelector('button[aria-label="Following"], button[aria-label="Follow"]');
    if (!followButton) return;

    // Create the "Add to Rules" button
    const addButton = document.createElement('button');
    addButton.className = 'bsky-nav-add-to-rules-btn';
    addButton.setAttribute('aria-label', 'Add to filter rules');
    addButton.setAttribute('title', 'Add to filter rules');
    addButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    `;

    // Insert button before follow button
    followButton.parentNode.insertBefore(addButton, followButton);

    // Handle click
    addButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = addButton.getBoundingClientRect();
      this.showAddToRulesDropdown(rect, handle);
    });
  }

  /**
   * Called when a profile hover card is removed from the DOM
   */
  onProfileHoverCardRemove() {
    // Dropdown cleanup is handled by its own click-outside listener
  }

  /**
   * Open Add to Rules dropdown for the author of the selected item
   * @param {jQuery} item - The selected item
   */
  openAddToRulesForItem(item) {
    if (!item || !item.length) return;

    let handle = this.handleFromItem(item);

    // Fallback: try data-testid
    if (!handle) {
      const testId = $(item).attr('data-testid') || '';
      const match = testId.match(/^feedItem-by-(.+)$/);
      if (match) {
        handle = match[1];
      }
    }

    if (!handle) return;

    // Find the author name element to position the dropdown near it
    const authorElement = $(item).find(constants.PROFILE_SELECTOR).find('span').eq(0)[0];
    let rect;

    if (authorElement) {
      rect = authorElement.getBoundingClientRect();
      // Check if rect is valid (not at 0,0 or off-screen)
      if (rect.top > 0 && rect.left > 0) {
        this.showAddToRulesDropdown(rect, handle);
        return;
      }
    }

    // Fallback: position near the top of the item
    rect = item[0].getBoundingClientRect();
    this.showAddToRulesDropdown(rect, handle);
  }

  /**
   * Show dropdown to select which rule category to add the author to
   * @param {DOMRect} buttonRect - The bounding rect of the button (captured before hover card disappears)
   * @param {string} handle - The user handle to add to rules
   */
  showAddToRulesDropdown(buttonRect, handle) {
    // Remove any existing dropdown
    $('.bsky-nav-rules-dropdown').remove();

    // Disable global keyboard handling
    this.rulesDropdownActive = true;

    // Get rule categories from config
    const rulesConfig = this.config.get('rulesConfig') || '';
    const categories = this.parseRuleCategories(rulesConfig);

    // Check if a rule filter is currently active (e.g., "$politics")
    const activeFilter = this.state.filter || '';
    const activeRuleMatch = activeFilter.match(/\$(\S+)/);
    const activeCategory = activeRuleMatch ? activeRuleMatch[1] : null;

    // Create dropdown
    const dropdown = $(`
      <div class="bsky-nav-rules-dropdown">
        <div class="bsky-nav-rules-dropdown-header">Add @${handle} to:</div>
        <div class="bsky-nav-rules-dropdown-actions">
          <button class="bsky-nav-rules-action-btn bsky-nav-rules-allow" data-action="allow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            Allow
          </button>
          <button class="bsky-nav-rules-action-btn bsky-nav-rules-deny" data-action="deny">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            Deny
          </button>
        </div>
        <div class="bsky-nav-rules-dropdown-categories">
          ${categories.length > 0
            ? categories.map((cat, index) => {
                const color = this.getColorForCategory(cat, index);
                const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const sc = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
                const shadow = `1px 1px 0 ${sc}, -1px -1px 0 ${sc}, 1px -1px 0 ${sc}, -1px 1px 0 ${sc}`;
                return `
                <button class="bsky-nav-rules-category-btn${activeCategory === cat ? ' selected' : ''}" data-category="${cat}" style="color: ${color}; text-shadow: ${shadow}">
                  ${cat}
                </button>
              `;
              }).join('')
            : '<div class="bsky-nav-rules-no-categories">No rule categories defined.<br>Create one in Settings → Rules.</div>'
          }
        </div>
        <div class="bsky-nav-rules-dropdown-footer">
          <input type="text" class="bsky-nav-rules-quick-filter" placeholder="${categories.length > 0 ? 'Type # or name...' : 'Create first category...'}" autocomplete="off" spellcheck="false">
          <button class="bsky-nav-rules-create-btn" title="Create new category">+</button>
        </div>
      </div>
    `);

    // Position dropdown near the top of the element
    dropdown.css({
      position: 'fixed',
      top: buttonRect.top + 'px',
      left: buttonRect.left + 'px',
      zIndex: 10001
    });

    $('body').append(dropdown);

    // Track selected action (default to allow)
    let selectedAction = 'allow';
    dropdown.find('.bsky-nav-rules-allow').addClass('selected');

    // Action button handlers
    dropdown.find('.bsky-nav-rules-action-btn').on('click', function() {
      dropdown.find('.bsky-nav-rules-action-btn').removeClass('selected');
      $(this).addClass('selected');
      selectedAction = $(this).data('action');
    });

    // Helper to close dropdown and cleanup
    const closeDropdown = () => {
      dropdown.remove();
      this.rulesDropdownActive = false;
      $(document).off('mousedown', closeHandler);
      $(document).off('keydown', keyHandler);
    };

    // Category button handlers
    dropdown.find('.bsky-nav-rules-category-btn').on('click', (e) => {
      const category = $(e.target).data('category');
      this.addAuthorToRules(handle, category, selectedAction);
      closeDropdown();
    });

    // Quick filter input reference
    const quickFilterInput = dropdown.find('.bsky-nav-rules-quick-filter');

    // Create new category handler (uses quick filter input value)
    dropdown.find('.bsky-nav-rules-create-btn').on('click', () => {
      const newCategory = quickFilterInput.val().trim();
      // Only create if it's not purely numeric and not empty
      if (newCategory && !/^\d+$/.test(newCategory)) {
        this.addAuthorToRules(handle, newCategory, selectedAction);
        closeDropdown();
      }
    });

    // Prevent dropdown from triggering hover card close
    dropdown.on('mousedown mouseup click', (e) => {
      e.stopPropagation();
    });

    // Close dropdown when clicking outside
    const closeHandler = (e) => {
      if (!$(e.target).closest('.bsky-nav-rules-dropdown').length &&
          !$(e.target).closest('.bsky-nav-add-to-rules-btn').length) {
        closeDropdown();
      }
    };
    setTimeout(() => {
      $(document).on('mousedown', closeHandler);
    }, 100);

    // Keyboard handler for quick filter (supports both number and text entry)
    const categoryButtons = dropdown.find('.bsky-nav-rules-category-btn');
    let numTimeout = null;

    const selectCategory = (index) => {
      if (index >= 0 && index < categoryButtons.filter(':visible').length) {
        categoryButtons.removeClass('selected');
        const visibleButtons = categoryButtons.filter(':visible');
        const selected = visibleButtons.eq(index);
        selected.addClass('selected');
        selected[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };

    const filterCategories = (filterText) => {
      const lowerFilter = filterText.toLowerCase();
      let visibleCount = 0;
      let firstVisible = null;

      categoryButtons.each(function() {
        const btn = $(this);
        const category = btn.data('category').toLowerCase();
        const matches = category.includes(lowerFilter);
        btn.toggle(matches);
        if (matches) {
          visibleCount++;
          if (!firstVisible) firstVisible = btn;
        }
      });

      // Auto-select first visible match
      if (firstVisible) {
        categoryButtons.removeClass('selected');
        firstVisible.addClass('selected');
      }

      // Update create button visibility - show if filter could be a new category
      const createBtn = dropdown.find('.bsky-nav-rules-create-btn');
      const isNewCategory = filterText && !/^\d+$/.test(filterText) &&
        !categories.some(cat => cat.toLowerCase() === lowerFilter);
      createBtn.toggle(isNewCategory);

      return { visibleCount, firstVisible };
    };

    const processInput = () => {
      const val = quickFilterInput.val();

      // Pure numeric input - select by number
      if (/^\d+$/.test(val)) {
        const num = parseInt(val);
        // Show all categories when doing numeric selection
        categoryButtons.show();
        if (num > 0 && num <= categoryButtons.length) {
          selectCategory(num - 1);
        }
        // Hide create button for pure numbers
        dropdown.find('.bsky-nav-rules-create-btn').hide();
      } else if (val) {
        // Text input - filter categories
        filterCategories(val);
      } else {
        // Empty - show all
        categoryButtons.show();
        dropdown.find('.bsky-nav-rules-create-btn').show();
      }
    };

    // Input event handler for real-time filtering
    quickFilterInput.on('input', () => {
      // Clear any pending number timeout
      if (numTimeout) clearTimeout(numTimeout);
      processInput();
    });

    // Focus the input when dropdown opens
    setTimeout(() => quickFilterInput.focus(), 50);

    const keyHandler = (e) => {
      // Handle Enter key
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();

        const val = quickFilterInput.val().trim();
        const selected = dropdown.find('.bsky-nav-rules-category-btn.selected:visible');

        if (selected.length) {
          // Select the highlighted category
          const category = selected.data('category');
          this.addAuthorToRules(handle, category, selectedAction);
          closeDropdown();
        } else if (val && !/^\d+$/.test(val)) {
          // Create new category if text entered and no match
          this.addAuthorToRules(handle, val, selectedAction);
          closeDropdown();
        }
        return;
      }

      // Escape closes dropdown
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        return;
      }

      // Arrow keys for navigation
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();

        const visibleButtons = categoryButtons.filter(':visible');
        if (visibleButtons.length === 0) return;

        const currentSelected = visibleButtons.filter('.selected');
        let currentIndex = currentSelected.length ? visibleButtons.index(currentSelected) : -1;

        if (e.key === 'ArrowDown') {
          currentIndex = (currentIndex + 1) % visibleButtons.length;
        } else {
          currentIndex = currentIndex <= 0 ? visibleButtons.length - 1 : currentIndex - 1;
        }

        categoryButtons.removeClass('selected');
        visibleButtons.eq(currentIndex).addClass('selected');
        visibleButtons[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      // Tab to toggle allow/deny
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const allowBtn = dropdown.find('.bsky-nav-rules-allow');
        const denyBtn = dropdown.find('.bsky-nav-rules-deny');
        if (allowBtn.hasClass('selected')) {
          allowBtn.removeClass('selected');
          denyBtn.addClass('selected');
          selectedAction = 'deny';
        } else {
          denyBtn.removeClass('selected');
          allowBtn.addClass('selected');
          selectedAction = 'allow';
        }
        return;
      }
    };
    $(document).on('keydown', keyHandler);
  }

  /**
   * Parse rule categories from config text
   */
  parseRuleCategories(configText) {
    const categories = [];
    const lines = configText.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^\[(.+)\]$/);
      if (match) {
        categories.push(match[1]);
      }
    }
    return categories;
  }

  /**
   * Add an author to the rules config
   */
  addAuthorToRules(handle, category, action) {
    let rulesConfig = this.config.get('rulesConfig') || '';

    // Format the rule
    const rule = `${action} from @${handle}`;

    // Check if this exact rule already exists anywhere in config
    if (rulesConfig.includes(rule)) {
      this.showRuleAddedNotification(`@${handle} already has this rule`);
      return;
    }

    // Check if author already has a rule in this category (with different action)
    const oppositeAction = action === 'allow' ? 'deny' : 'allow';
    const oppositeRule = `${oppositeAction} from @${handle}`;

    // Check if category exists
    const categoryHeader = `[${category}]`;
    let replacedOpposite = false;

    if (rulesConfig.includes(categoryHeader)) {
      // Add rule under existing category
      const lines = rulesConfig.split('\n');
      const newLines = [];
      let inCategory = false;
      let ruleAdded = false;

      for (const line of lines) {
        // Check if this line is the opposite rule in this category - replace it
        if (inCategory && line.trim() === oppositeRule) {
          newLines.push(rule);
          ruleAdded = true;
          replacedOpposite = true;
          continue;
        }

        newLines.push(line);
        if (line.trim() === categoryHeader) {
          inCategory = true;
        } else if (line.trim().startsWith('[')) {
          // Hit next category
          if (inCategory && !ruleAdded) {
            // Add rule before this category header
            newLines.splice(newLines.length - 1, 0, rule);
            ruleAdded = true;
          }
          inCategory = false;
        }
      }

      // If still in category at end, add rule
      if (inCategory && !ruleAdded) {
        newLines.push(rule);
      }

      rulesConfig = newLines.join('\n');

      if (replacedOpposite) {
        this.showRuleAddedNotification(`Updated @${handle} to ${action} in ${category}`);
      }
    } else {
      // Create new category with rule
      if (rulesConfig && !rulesConfig.endsWith('\n')) {
        rulesConfig += '\n';
      }
      rulesConfig += `\n${categoryHeader}\n${rule}`;
    }

    // Save config
    this.config.set('rulesConfig', rulesConfig);
    this.config.save();

    // Also update state.rulesConfig so it syncs and doesn't overwrite on reload
    this.state.rulesConfig = rulesConfig;
    if (this.state.stateManager) {
      this.state.stateManager.saveStateImmediately(true, true);
    }

    // Re-parse rules and apply filter
    if (this.state && this.state.rules !== undefined) {
      this.state.rules = this.parseRulesForState(rulesConfig);
    }

    // Show confirmation (unless we already showed an "Updated" message)
    if (!replacedOpposite) {
      this.showRuleAddedNotification(handle, category, action);
    }
  }

  /**
   * Parse rules config into state format (simplified version of main.js parseRulesConfig)
   */
  parseRulesForState(configText) {
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

      const ruleMatch = line.match(/(allow|deny) (all|from|content|include) "?([^"]+)"?/);
      if (ruleMatch) {
        const [_, action, type, value] = ruleMatch;
        rules[rulesName].push({ action, type, value });
        continue;
      }

      if (line.startsWith('$')) {
        rules[rulesName].push({ action: 'allow', type: 'include', value: line.substring(1) });
      } else if (line.startsWith('@')) {
        rules[rulesName].push({ action: 'allow', type: 'from', value: line });
      } else {
        rules[rulesName].push({ action: 'allow', type: 'content', value: line });
      }
    }
    return rules;
  }

  /**
   * Check if a handle matches any rule in a category (including via includes).
   * @param {string} normalizedHandle - The handle to check (with @)
   * @param {string} categoryName - The category to check
   * @param {Set} [visited] - Set of visited categories for circular dependency detection
   * @returns {boolean} True if handle matches any rule in the category
   * @private
   */
  handleMatchesCategory(normalizedHandle, categoryName, visited = new Set()) {
    if (visited.has(categoryName)) {
      return false; // Circular dependency - stop recursion
    }

    const rules = this.state.rules?.[categoryName];
    if (!rules) return false;

    visited.add(categoryName);

    for (const rule of rules) {
      if (rule.type === 'from' && rule.value.toLowerCase() === normalizedHandle.toLowerCase()) {
        return true;
      }
      if (rule.type === 'include') {
        if (this.handleMatchesCategory(normalizedHandle, rule.value, visited)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get the index of the first filter category that contains a handle.
   * Returns -1 if handle is not in any filter list.
   * @param {string} handle - The handle to search for (with or without @)
   * @returns {number} Index of the category, or -1 if not found
   */
  getFilterCategoryIndexForHandle(handle) {
    if (!handle || !this.state.rules) {
      return -1;
    }

    // Normalize handle (ensure it has @)
    const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;

    const categories = Object.keys(this.state.rules);
    for (let i = 0; i < categories.length; i++) {
      if (this.handleMatchesCategory(normalizedHandle, categories[i])) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Check if content matches any rule in a category (including via includes).
   * @param {string} content - The content to check
   * @param {string} categoryName - The category to check
   * @param {Set} [visited] - Set of visited categories for circular dependency detection
   * @returns {boolean} True if content matches any rule in the category
   * @private
   */
  contentMatchesCategory(content, categoryName, visited = new Set()) {
    if (visited.has(categoryName)) {
      return false; // Circular dependency - stop recursion
    }

    const rules = this.state.rules?.[categoryName];
    if (!rules) return false;

    visited.add(categoryName);

    for (const rule of rules) {
      if (rule.type === 'content') {
        try {
          const pattern = new RegExp(rule.value, 'i');
          if (pattern.test(content)) {
            return true;
          }
        } catch (e) {
          // Invalid regex, skip this rule
        }
      }
      if (rule.type === 'include') {
        if (this.contentMatchesCategory(content, rule.value, visited)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get the matching content rule pattern for an item.
   * @param {HTMLElement} item - The post item element
   * @returns {{pattern: RegExp, categoryIndex: number}|null} The matching pattern and category index, or null
   */
  getMatchingContentRule(item) {
    if (!item || !this.state.rules) {
      return null;
    }

    const content = $(item).find('div[data-testid="postText"]').text();
    if (!content) return null;

    const categories = Object.keys(this.state.rules);
    for (let i = 0; i < categories.length; i++) {
      const result = this.findMatchingContentPattern(content, categories[i]);
      if (result) {
        return { pattern: result, categoryIndex: i };
      }
    }
    return null;
  }

  /**
   * Find the first matching content pattern in a category (including via includes).
   * @param {string} content - The content to check
   * @param {string} categoryName - The category to check
   * @param {Set} [visited] - Set of visited categories for circular dependency detection
   * @returns {RegExp|null} The matching pattern, or null
   * @private
   */
  findMatchingContentPattern(content, categoryName, visited = new Set()) {
    if (visited.has(categoryName)) {
      return null;
    }

    const rules = this.state.rules?.[categoryName];
    if (!rules) return null;

    visited.add(categoryName);

    for (const rule of rules) {
      if (rule.type === 'content') {
        try {
          const pattern = new RegExp(rule.value, 'gi');
          if (pattern.test(content)) {
            return new RegExp(rule.value, 'gi'); // Return fresh regex
          }
        } catch (e) {
          // Invalid regex, skip
        }
      }
      if (rule.type === 'include') {
        const result = this.findMatchingContentPattern(content, rule.value, visited);
        if (result) return result;
      }
    }
    return null;
  }

  /**
   * Get the index of the first filter category that matches post content.
   * Returns -1 if content doesn't match any filter list.
   * @param {HTMLElement} item - The post item element
   * @returns {number} Index of the category, or -1 if not found
   */
  getFilterCategoryIndexForContent(item) {
    if (!item || !this.state.rules) {
      return -1;
    }

    const content = $(item).find('div[data-testid="postText"]').text();
    if (!content) return -1;

    const categories = Object.keys(this.state.rules);
    for (let i = 0; i < categories.length; i++) {
      if (this.contentMatchesCategory(content, categories[i])) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Get the color for a category by name, using custom color if set
   * @param {string} categoryName - The category name
   * @param {number} defaultIndex - The default index to use if no custom color
   * @returns {string} The color hex code
   */
  getColorForCategory(categoryName, defaultIndex) {
    try {
      const rulesetColors = JSON.parse(this.config.get('rulesetColors') || '{}');
      if (categoryName in rulesetColors) {
        const colorIndex = rulesetColors[categoryName] % this.FILTER_LIST_COLORS.length;
        return this.FILTER_LIST_COLORS[colorIndex];
      }
    } catch (e) {
      // Invalid JSON, use default
    }
    return this.FILTER_LIST_COLORS[defaultIndex % this.FILTER_LIST_COLORS.length];
  }

  /**
   * Get the color for a category by index, using custom color if set
   * @param {number} categoryIndex - The category index
   * @returns {string} The color hex code
   */
  getColorForCategoryIndex(categoryIndex) {
    if (!this.state.rules || categoryIndex < 0) {
      return this.FILTER_LIST_COLORS[0];
    }
    const categories = Object.keys(this.state.rules);
    if (categoryIndex < categories.length) {
      const categoryName = categories[categoryIndex];
      return this.getColorForCategory(categoryName, categoryIndex);
    }
    return this.FILTER_LIST_COLORS[categoryIndex % this.FILTER_LIST_COLORS.length];
  }

  /**
   * Show notification that rule was added
   * Can be called with (message) or (handle, category, action)
   */
  showRuleAddedNotification(handleOrMessage, category, action) {
    let message, icon;
    if (category === undefined) {
      // Called with single message string
      message = handleOrMessage;
      icon = 'ℹ';
    } else {
      // Called with handle, category, action
      message = `@${handleOrMessage} added to "${category}" (${action})`;
      icon = action === 'allow' ? '✓' : '✗';
    }

    const notification = $(`
      <div class="bsky-nav-rule-notification">
        <span class="bsky-nav-rule-notification-icon">${icon}</span>
        <span>${message}</span>
      </div>
    `);

    $('body').append(notification);

    // Animate in
    setTimeout(() => notification.addClass('visible'), 10);

    // Remove after delay
    setTimeout(() => {
      notification.removeClass('visible');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
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

    // For fixed sidecar, the sidecar always corresponds to the currently selected item
    // For inline sidecar, we need to find the parent item
    const isFixedSidecar = this.isFixedSidecar() && $('#fixed-sidecar-panel').hasClass('visible');

    // Clear any pending debounce
    if (this.hoverDebounceTimeout) {
      clearTimeout(this.hoverDebounceTimeout);
    }

    // Debounce the focus change
    this.hoverDebounceTimeout = setTimeout(() => {
      if (this.ignoreMouseMovement) return;

      if (!isFixedSidecar) {
        // For inline sidecar, check if we need to change parent item
        const parent = target.closest('.thread').find('.item');
        const parentIndex = this.getIndexFromItem(parent);
        if (parentIndex !== this.index && parentIndex >= 0) {
          // Hover opens sidecar (unlike scroll which skips it)
          this.setIndex(parentIndex, false, false, false);
        }
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

  /**
   * Wait for an element's position to stabilize (no movement for stabilityMs)
   * @param {Element|jQuery} element - The element to monitor
   * @param {number} stabilityMs - How long position must be stable (default 100ms)
   * @param {number} maxWaitMs - Maximum time to wait (default 600ms)
   * @returns {Promise} Resolves when element position has stabilized
   */
  waitForElementStable(element, stabilityMs = 100, maxWaitMs = 600) {
    return new Promise((resolve) => {
      if (!this.config.get('enableSmoothScrolling')) {
        // No smooth scrolling, resolve immediately
        resolve();
        return;
      }

      const el = element instanceof $ ? element[0] : element;
      if (!el) {
        resolve();
        return;
      }

      let lastTop = el.getBoundingClientRect().top;
      let stableTime = 0;
      let elapsed = 0;
      const checkInterval = 16; // ~60fps

      const check = () => {
        elapsed += checkInterval;
        const currentTop = el.getBoundingClientRect().top;

        if (Math.abs(currentTop - lastTop) < 1) {
          stableTime += checkInterval;
          if (stableTime >= stabilityMs) {
            resolve();
            return;
          }
        } else {
          stableTime = 0;
          lastTop = currentTop;
        }

        if (elapsed >= maxWaitMs) {
          resolve();
          return;
        }

        requestAnimationFrame(check);
      };

      requestAnimationFrame(check);
    });
  }

  get scrollMargin() {
    // Use getToolbarHeight which properly handles all pages (home, profile, etc.)
    return this.getToolbarHeight();
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
    this.loadPageObserver.disconnect();
  }

  // ===========================================================================
  // Item Utilities
  // ===========================================================================

  postIdFromUrl() {
    return window.location.href.split('/')[6];
  }

  urlForItem(item) {
    const href = $(item).find("a[href*='/post/']").attr('href');
    if (!href) return null;
    // Sidecar posts have full URLs, feed items have relative paths
    return href.startsWith('https://') ? href : `https://bsky.app${href}`;
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
    this.applyRuleColorStyling(element);
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

  applyRuleColorStyling(element) {
    const $el = $(element);
    const profileLink = $el.find(constants.PROFILE_SELECTOR).first();
    const avatar = $el.find('div[data-testid="userAvatarImage"]').first();
    const postText = $el.find('div[data-testid="postText"]').first();

    // Get handle - try handleFromItem first, fallback to data-testid
    let handle = this.handleFromItem(element);
    if (!handle) {
      const testId = $el.attr('data-testid') || '';
      const match = testId.match(/^feedItem-by-(.+)$/);
      if (match) {
        handle = match[1];
      }
    }

    const authorCategoryIndex = handle ? this.getFilterCategoryIndexForHandle(handle) : -1;

    // Check if color-coding is enabled
    if (!this.config.get('ruleColorCoding')) {
      // Clear any added styles
      if (profileLink.length) {
        profileLink.css({ 'background-color': '', 'border': '', 'border-radius': '', 'padding': '' });
      }
      if (avatar.length) avatar.css('box-shadow', '');
      // Clear content highlights
      postText.find('.rule-content-highlight').each(function() {
        $(this).replaceWith($(this).text());
      });
      return;
    }

    // Color by author rules (display name and avatar)
    if (authorCategoryIndex >= 0) {
      const color = this.getColorForCategoryIndex(authorCategoryIndex);

      if (profileLink.length) {
        profileLink[0].style.setProperty('background-color', `${color}55`, 'important');
        profileLink[0].style.setProperty('border', `1px solid ${color}88`, 'important');
        profileLink[0].style.setProperty('border-radius', '3px', 'important');
        profileLink[0].style.setProperty('padding', '0 2px', 'important');
      }

      if (avatar.length) {
        avatar.css({
          'box-shadow': `0 0 0 3px ${color}`,
          'border-radius': '50%'
        });
      }
    } else {
      // No author match - clear styles
      if (profileLink.length) {
        profileLink.css({ 'background-color': '', 'border': '', 'border-radius': '', 'padding': '' });
      }
      if (avatar.length) avatar.css('box-shadow', '');
    }

    // Highlight matching content phrases by content rules
    // Clear any previous content highlights
    postText.find('.rule-content-highlight').each(function() {
      $(this).replaceWith($(this).text());
    });

    const matchResult = this.getMatchingContentRule(element);
    if (matchResult) {
      const { pattern, categoryIndex } = matchResult;
      const color = this.getColorForCategoryIndex(categoryIndex);

      // Highlight matching text in the post
      this.highlightMatchingText(postText, pattern, color);
    }
  }

  /**
   * Highlight matching text within an element by wrapping matches in styled spans.
   * @param {jQuery} $container - The container element
   * @param {RegExp} pattern - The pattern to match
   * @param {string} color - The highlight color
   */
  highlightMatchingText($container, pattern, color) {
    if (!$container.length) return;

    const highlightStyle = `background-color: ${color}55; border: 1px solid ${color}88; border-radius: 3px; padding: 0 2px;`;

    // Process text nodes recursively
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text || !pattern.test(text)) return;

        // Reset regex lastIndex
        pattern.lastIndex = 0;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
          // Add text before match
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }

          // Add highlighted match
          const span = document.createElement('span');
          span.className = 'rule-content-highlight';
          span.style.cssText = highlightStyle;
          span.textContent = match[0];
          fragment.appendChild(span);

          lastIndex = pattern.lastIndex;
        }

        // Add remaining text
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        // Replace the text node with the fragment
        if (fragment.childNodes.length > 0) {
          node.parentNode.replaceChild(fragment, node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && !$(node).hasClass('rule-content-highlight')) {
        // Process child nodes (make a copy since we're modifying)
        Array.from(node.childNodes).forEach(processNode);
      }
    };

    $container.each(function() {
      Array.from(this.childNodes).forEach(processNode);
    });
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

  showFeedLoading() {
    // Only show loading indicator on first load (early indicator from main.js)
    // Subsequent loads just use the CSS hiding without the spinner
    if (this.initialLoadComplete) {
      // For subsequent loads, just ensure CSS hiding is active if enabled
      if (this.config.get('showLoadingIndicator') !== false) {
        $('body').addClass('bsky-nav-loading-enabled').removeClass('bsky-nav-feed-ready');
      }
      return;
    }

    // Check if loading indicator is enabled (default true)
    if (this.config.get('showLoadingIndicator') === false) {
      // Remove classes and indicator when disabled
      $('body').removeClass('bsky-nav-feed-ready bsky-nav-loading-enabled');
      $('#feedLoadingIndicator').remove();
      return;
    }

    // Add class to enable CSS hiding, remove ready class
    $('body').addClass('bsky-nav-loading-enabled').removeClass('bsky-nav-feed-ready');

    // Only add indicator if not already present (may be added early in main.js)
    if ($('#feedLoadingIndicator').length) return;

    const indicator = $(`
      <div id="feedLoadingIndicator" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(255,255,255,0.95);z-index:999;min-height:200px;">
        <div class="spinner" style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <div class="loading-text" style="color:#6b7280;font-size:14px;margin-top:12px;">Loading...</div>
      </div>
    `);
    // Try to append to main content area, fall back to body with fixed position
    const container = $('main[role="main"]').first();
    if (container.length) {
      container.css('position', 'relative').append(indicator);
    } else {
      indicator.css('position', 'fixed');
      $('body').append(indicator);
    }
  }

  hideFeedLoading() {
    // Mark initial load complete so subsequent loads don't show spinner
    this.initialLoadComplete = true;

    // Add ready class to show items (CSS hides by default, shows when ready)
    $('body').addClass('bsky-nav-feed-ready');
    $('#feedLoadingIndicator').remove();
  }

  loadItems(focusedPostId) {
    this.perfLog('loadItems called');

    // Show loading indicator while items are being processed
    this.showFeedLoading();

    // Minimal delay to allow browser to paint the loading indicator
    setTimeout(() => {
      this._doLoadItems(focusedPostId);
    }, 0);
  }

  _doLoadItems(focusedPostId) {
    const perfEnd = this.perfStart('_doLoadItems');
    try {
      this._doLoadItemsInner(focusedPostId);
    } finally {
      perfEnd();
    }
  }

  _doLoadItemsInner(focusedPostId) {
    const classes = ['thread-first', 'thread-middle', 'thread-last'];
    const set = [];

    // Check if there are unrolled threads BEFORE cleanup - we want to preserve their state
    const unrolledRepliesCount = $('.unrolled-replies').not('.post-view-modal *').length;
    const hasUnrolledContent = unrolledRepliesCount > 0;
    console.log('[_doLoadItemsInner] hasUnrolledContent:', hasUnrolledContent, 'count:', unrolledRepliesCount);

    // Only clean up unrolled content if the user has navigated away (no unrolled content visible)
    // If there's still unrolled content, preserve it and its hidden "View full thread" elements
    if (!hasUnrolledContent) {
      console.log('[_doLoadItemsInner] Cleaning up - no unrolled content');
      // Clean up unrolled replies and sidecar containers from previous load
      // These are elements WE created and appended to React containers
      // Use individual try-catch per element since React may have removed parents
      // Exclude elements inside post-view-modal to avoid affecting the modal's sidecar
      $('.sidecar-replies').not('.post-view-modal *').each((i, el) => {
        try {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        } catch (e) {
          // Element already removed or parent changed - ignore
        }
      });

      // Clear tracked unrolled post IDs when unrolled content is removed
      this.unrolledPostIds.clear();
      // Remove unrolled-duplicate class from items (safely)
      try {
        $('.unrolled-duplicate').removeClass('unrolled-duplicate filtered');
      } catch (e) {
        // Ignore - elements may have been removed
      }
      // Show any hidden "View full thread" elements
      try {
        const hiddenCount = $('.unrolled-view-full-thread-hidden').length;
        console.log('[_doLoadItemsInner] Unhiding View full thread elements, count:', hiddenCount);
        $('.unrolled-view-full-thread-hidden').removeClass('unrolled-view-full-thread-hidden').show();
      } catch (e) {
        // Ignore - elements may have been removed
      }
    } else {
      console.log('[_doLoadItemsInner] Preserving unrolled state - NOT cleaning up');
    }

    // Hide empty thread containers (threads with no visible items)
    // .thread class is added to React-managed elements, so we CANNOT remove them
    // Only hide via CSS to avoid interfering with React's DOM management
    $('div.thread').each((i, thread) => {
      try {
        if (!document.contains(thread)) return;
        const hasVisibleItems = $(thread).find(this.selector).filter(':visible').length > 0;
        if (!hasVisibleItems) {
          $(thread).css('display', 'none');
        }
      } catch (e) {
        // Ignore errors during visibility check
      }
    });

    // Items are hidden via CSS body.bsky-nav-feed-loading class
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
        // Skip on mobile view and when using fixed sidecar
        if (
          !this.state.mobileView &&
          this.config.get('showReplySidecar') &&
          !this.isFixedSidecar() &&
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
      // Check if load newer button exists (more reliable than checking image class)
      if (this.loadNewerButton && $('#loadNewerAction').length == 0) {
        $('#messageActions').append($('<div id="loadNewerAction"><a>Load newer posts</a></div>'));
        $('#loadNewerAction > a').on('click', () => this.loadNewerItems());
      }
    } else {
      this.hideMessage();
    }

    // Re-enable mouse focus after loading
    this.ignoreMouseMovement = false;

    // Hide loading indicator now that items are fully processed and sorted
    this.hideFeedLoading();

    // Scroll to restored post after DOM is ready (deferred to allow layout to settle)
    if (focusedPostId && this.selectedItem && this.selectedItem.length) {
      requestAnimationFrame(() => {
        this.scrollToElement(this.selectedItem[0]);
      });
    }
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
      } else {
        return;
      }
    }
    this.loadingNew = true;
    this.hideNewPostsPill();

    // Show loading indicator (CSS class hides items)
    this.showFeedLoading();

    // Save post ID before any DOM changes - be defensive about missing elements
    const oldPostId = this.selectedItem ? this.postIdForItem(this.selectedItem) : null;

    // Clear selection styling before clicking (be defensive)
    // Check that element is still in the DOM before trying to style it
    try {
      if (this.selectedItem && $(this.selectedItem).length && document.contains($(this.selectedItem)[0])) {
        this.applyItemStyle(this.selectedItem, false);
      }
    } catch (e) {
      console.warn('[bsky-navigator] Error clearing selection:', e);
    }

    // Click the native button to load new posts
    $(this.loadNewerButton).click();

    setTimeout(() => {
      try {
        this.loadItems(oldPostId);
      } catch (e) {
        console.warn('[bsky-navigator] Error in loadItems after loadNewer:', e);
      }
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
      return;
    }

    if (!loadMoreSentinel) {
      return;
    }

    // Show loading indicator (CSS class hides items)
    this.showFeedLoading();

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
        this.loading = false;
        $('img#loadOlderIndicatorImage').addClass('image-highlight');
        $('img#loadOlderIndicatorImage').removeClass('toolbar-icon-pending');
        this.loadItems();
      }
    }, 3000);
  }
}
