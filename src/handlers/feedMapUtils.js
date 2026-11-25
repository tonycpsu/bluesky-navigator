// feedMapUtils.js - Shared utilities for feed map creation across handlers
/* global $ */

/** Number of heat levels; .feed-map-segment-heat-1 through -5 in style.css. */
export const HEAT_LEVELS = 5;

/** Space-separated list of every heat class, for jQuery removeClass(). */
export const HEAT_CLASSES = Array.from(
  { length: HEAT_LEVELS },
  (_, i) => `feed-map-segment-heat-${i + 1}`
).join(' ');

/**
 * Build a score -> heat level function for one feed map render.
 *
 * Levels are rank based (quantiles): the positive finite scores in `scores` are
 * sorted, and a post's level comes from its percentile rank, so each of the
 * HEAT_LEVELS levels holds about 1/HEAT_LEVELS of the posts no matter how
 * heavy-tailed the engagement is. Build it once per render from the displayed
 * posts, then call the returned function per segment (O(log n) each).
 *
 * Rules:
 * - Scores that are not positive (0, negative, NaN from a bad timestamp) get
 *   level 0 (no heat) and are left out of the ranking.
 * - Ties use the mid-rank: every post with the same score gets the same level,
 *   placed at the middle of the span its tie block covers.
 * - The highest score (and anything tied with it) always gets the top level.
 * - With fewer posts than levels, levels are filled top down without gaps
 *   (1 post -> 5; 3 posts -> 3, 4, 5), so a short feed is not drawn as cold.
 *   This works as a floor: a post with k higher-scoring posts above it is never
 *   below level HEAT_LEVELS - k.
 * - A score outside the ranked population (or Infinity) is placed by where it
 *   would fall in the sorted scores, clamped to 1..HEAT_LEVELS.
 *
 * @param {Iterable<number>} scores - Engagement scores of the displayed posts
 * @returns {(score: number) => number} Maps a score to 0 or 1..HEAT_LEVELS
 */
export function createHeatLevelFn(scores) {
  const sorted = [];
  for (const score of scores) {
    if (score > 0 && Number.isFinite(score)) sorted.push(score);
  }
  sorted.sort((a, b) => a - b);
  const n = sorted.length;

  // First index i with sorted[i] > score (or >= score when strict is false)
  const bound = (score, strict) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? sorted[mid] <= score : sorted[mid] < score) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const levelOf = (score) => {
    if (!(score > 0) || n === 0) return 0;
    const below = bound(score, false); // posts with a lower score
    const atOrBelow = bound(score, true); // posts with a lower or equal score
    const midRank = (below + atOrBelow) / 2 / n; // 0..1
    const quantileLevel = Math.floor(midRank * HEAT_LEVELS) + 1;
    const topDownLevel = HEAT_LEVELS - (n - atOrBelow);
    return Math.min(HEAT_LEVELS, Math.max(1, quantileLevel, topDownLevel));
  };

  /**
   * Where a score ranks in the same population, for the hover tooltip.
   * Returns null for scores that get no heat (see the rules above).
   * - atOrAbove: share of ranked posts scoring at least this much (0..1]
   * - atOrBelow: share of ranked posts scoring at most this much (0..1]
   */
  levelOf.rankOf = (score) => {
    if (!(score > 0) || n === 0) return null;
    const below = Math.min(bound(score, false), n - 1);
    const atOrBelow = Math.max(bound(score, true), 1);
    return {
      level: levelOf(score),
      atOrAbove: (n - below) / n,
      atOrBelow: atOrBelow / n,
      n,
    };
  };

  return levelOf;
}

/**
 * Short label for a post's rank band, e.g. "top 5%" or "bottom 30%".
 * Uses the side of the feed the post is on, rounding the share up so the very
 * top post of 40 reads "top 3%" rather than "top 0%".
 *
 * @param {{atOrAbove: number, atOrBelow: number, n: number} | null} rank - From rankOf()
 * @returns {string} Label, or '' when there is no rank
 */
export function formatRankBand(rank) {
  if (!rank || !(rank.n > 0)) return '';
  const pct = (share) => Math.min(100, Math.max(1, Math.ceil(share * 100 - 1e-9)));
  if (rank.n === 1) return 'only post with engagement';
  if (rank.atOrAbove >= 1 && rank.atOrBelow >= 1) return 'tied with every post';
  if (rank.atOrAbove <= 0.5) return `top ${pct(rank.atOrAbove)}%`;
  return `bottom ${pct(rank.atOrBelow)}%`;
}

/**
 * Find the boundary between posts that are new since the user last looked at a
 * feed and the posts they had already seen.
 *
 * The "anchor" is the newest post of the feed (the top post in Bluesky's feed
 * order) at the time the user last looked: when they last opened this feed, or
 * the top post just before they loaded newer posts. Every post newer than the
 * anchor in feed order is new. Display order is feed order, or its reverse when
 * the feed is sorted oldest first.
 *
 * Posts hidden by filters still count for finding the anchor, so a filtered
 * anchor still places the boundary among the posts that are shown.
 *
 * @param {Array<string|null>} allPostIds - Post ID of every feed item, in display order
 * @param {number[]} displayIndices - Index into allPostIds of each displayed item, ascending
 * @param {string|null} anchorPostId - Newest post the user had already seen
 * @param {boolean} [reversed=false] - True when the display is oldest first
 * @returns {{index: number, newCount: number} | null} The divider goes on the
 *   leading edge of displayed segment `index` (between index - 1 and index).
 *   null when the anchor is not loaded, or when no shown post (or every shown
 *   post) is new, since then there is nothing to divide.
 */
export function findNewPostsBoundary(allPostIds, displayIndices, anchorPostId, reversed = false) {
  if (!anchorPostId || !allPostIds || !displayIndices) return null;
  const anchorIndex = allPostIds.indexOf(anchorPostId);
  if (anchorIndex < 0) return null;
  const total = displayIndices.length;
  // Displayed items that come before the divider: the new ones (newest first),
  // or the anchor and everything older (oldest first)
  const before = reversed
    ? displayIndices.filter((i) => i <= anchorIndex).length
    : displayIndices.filter((i) => i < anchorIndex).length;
  if (before === 0 || before === total) return null;
  return { index: before, newCount: reversed ? total - before : before };
}

/**
 * Index (into allPostIds) of the newest post in feed order: the first item, or
 * the last one when the display is oldest first. Skips items without a post ID.
 *
 * @param {Array<string|null>} allPostIds - Post IDs in display order
 * @param {boolean} [reversed=false] - True when the display is oldest first
 * @returns {string|null} Post ID, or null if there is none
 */
export function newestPostId(allPostIds, reversed = false) {
  if (!allPostIds || !allPostIds.length) return null;
  const ids = reversed ? [...allPostIds].reverse() : allPostIds;
  return ids.find((id) => !!id) || null;
}

/**
 * Extract feed map configuration from config object.
 * This pattern was duplicated 4+ times across handlers.
 *
 * @param {object} config - Config object with get() method
 * @returns {object} Feed map configuration
 */
export function getFeedMapConfig(config) {
  const position = config.get('feedMapPosition');
  const style = config.get('feedMapStyle') || 'Advanced';
  const isAdvanced = style === 'Advanced';
  const theme = config.get('feedMapTheme') || 'Default';
  const scale = parseInt(config.get('feedMapScale'), 10) || 100;
  const animationSpeed = parseInt(config.get('feedMapAnimationSpeed'), 10);

  return {
    position,
    style,
    isAdvanced,
    styleClass: isAdvanced ? 'feed-map-advanced' : 'feed-map-basic',
    theme,
    themeClass: `feed-map-theme-${theme.toLowerCase()}`,
    scale,
    scaleValue: scale / 100,
    animationSpeed: isNaN(animationSpeed) ? 100 : animationSpeed,
    animationSpeedValue: (isNaN(animationSpeed) ? 100 : animationSpeed) / 100,
    customPropsStyle: `--indicator-scale: ${scale / 100}; --zoom-animation-speed: ${(isNaN(animationSpeed) ? 100 : animationSpeed) / 100};`,
  };
}

/**
 * Create feed map DOM elements.
 * Returns all elements needed for the feed map UI.
 *
 * @param {object} feedMapConfig - Config from getFeedMapConfig()
 * @param {object} options - Additional options
 * @param {boolean} options.isToolbar - True for toolbar position, false for status bar
 * @param {boolean} options.isStatusBar - True for status bar position
 * @param {boolean} [options.withZoomInner=isToolbar] - Create the inner zoom wrapper used for
 *   segment rendering and smooth scroll animation (updateFeedMapZoom() needs it)
 * @param {boolean} [options.zoomFirst=false] - Put the zoom map before the main map in the
 *   wrapper (zoom, connector, main) instead of (main, connector, zoom)
 * @returns {object} Object containing all created jQuery elements
 */
export function createFeedMapElements(feedMapConfig, options = {}) {
  const { styleClass, themeClass, customPropsStyle } = feedMapConfig;
  const { isToolbar = false, withZoomInner = isToolbar, zoomFirst = false } = options;

  // Container class varies by position
  const containerClass = isToolbar
    ? 'feed-map-container feed-map-container-toolbar'
    : 'feed-map-container';
  const zoomContainerClass = isToolbar
    ? 'feed-map-container feed-map-container-toolbar feed-map-zoom-container'
    : 'feed-map-container feed-map-zoom-container';

  // Create main container and elements
  const container = $(`<div class="${containerClass}"></div>`);
  const labelStart = $(`<span class="feed-map-label feed-map-label-start"></span>`);
  const labelEnd = $(`<span class="feed-map-label feed-map-label-end"></span>`);
  const map = $(
    `<div id="feed-map-position-indicator" class="feed-map-position-indicator" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="feed-map-position-fill"></div><div class="feed-map-position-zoom-highlight"></div></div>`
  );

  container.append(labelStart);
  container.append(map);
  container.append(labelEnd);

  // Get reference to zoom highlight element
  const zoomHighlight = map.find('.feed-map-position-zoom-highlight');

  // Create wrapper with style and theme classes
  const wrapperClass = isToolbar
    ? `feed-map-wrapper ${styleClass} ${themeClass}`
    : `feed-map-wrapper feed-map-wrapper-statusbar ${styleClass} ${themeClass}`;
  const wrapper = $(`<div class="${wrapperClass}" style="${customPropsStyle}"></div>`);

  // Add connector SVG between main indicator and zoom
  const connector = $(`<div class="feed-map-connector">
    <svg class="feed-map-connector-svg" preserveAspectRatio="none">
      <path class="feed-map-connector-path feed-map-connector-left" fill="none"/>
      <path class="feed-map-connector-path feed-map-connector-right" fill="none"/>
    </svg>
  </div>`);

  // Heat legend. It sits in the connector row over the end label column: the
  // connector curves always run between the label columns, so that corner is
  // free. CSS shows it only when the heatmap is on (.feed-map-has-heat).
  const legendLabel = 'Engagement heat, ranked within this feed: less to more';
  const legendSwatches = Array.from(
    { length: HEAT_LEVELS },
    (_, i) => `<span class="feed-map-legend-swatch feed-map-segment-heat-${i + 1}"></span>`
  ).join('');
  const legend = $(
    `<div class="feed-map-legend" role="img" aria-label="${legendLabel}" title="${legendLabel}">` +
      `<span class="feed-map-legend-text" aria-hidden="true">less</span>${legendSwatches}` +
      `<span class="feed-map-legend-text" aria-hidden="true">more</span></div>`
  );
  connector.append(legend);

  // Create zoom container and elements
  const zoomContainer = $(`<div class="${zoomContainerClass}"></div>`);
  const zoomLabelStart = $(`<span class="feed-map-label feed-map-label-start"></span>`);
  const zoomLabelEnd = $(`<span class="feed-map-label feed-map-label-end"></span>`);
  const zoom = $(
    `<div id="feed-map-position-indicator-zoom" class="feed-map-position-indicator feed-map-position-indicator-zoom"></div>`
  );

  // Inner wrapper for smooth scroll animation
  let zoomInner = null;
  if (withZoomInner) {
    zoomInner = $(`<div class="feed-map-zoom-inner"></div>`);
    zoom.append(zoomInner);
  }

  zoomContainer.append(zoomLabelStart);
  zoomContainer.append(zoom);
  zoomContainer.append(zoomLabelEnd);

  if (zoomFirst) {
    wrapper.append(zoomContainer, connector, container);
  } else {
    wrapper.append(container, connector, zoomContainer);
  }

  return {
    container,
    labelStart,
    labelEnd,
    map,
    wrapper,
    connector,
    zoomContainer,
    zoomLabelStart,
    zoomLabelEnd,
    zoom,
    zoomInner,
    zoomHighlight,
    legend,
  };
}

/**
 * Attach feed map elements to handler instance properties.
 * This sets up the standard property names used throughout the codebase.
 *
 * @param {object} handler - Handler instance to attach elements to
 * @param {object} elements - Elements from createFeedMapElements()
 */
export function attachFeedMapToHandler(handler, elements) {
  handler.feedMapContainer = elements.container;
  handler.feedMapLabelStart = elements.labelStart;
  handler.feedMapLabelEnd = elements.labelEnd;
  handler.feedMap = elements.map;
  handler.feedMapWrapper = elements.wrapper;
  handler.feedMapConnector = elements.connector;
  handler.feedMapZoomContainer = elements.zoomContainer;
  handler.feedMapZoomLabelStart = elements.zoomLabelStart;
  handler.feedMapZoomLabelEnd = elements.zoomLabelEnd;
  handler.feedMapZoom = elements.zoom;
  handler.feedMapZoomInner = elements.zoomInner;
  handler.feedMapZoomHighlight = elements.zoomHighlight;

  // Initialize zoom window tracking
  handler.zoomWindowStart = null;
}

/**
 * Setup feed map event handlers.
 * Attaches click, scroll, and tooltip handlers to the feed map elements.
 *
 * @param {object} handler - Handler instance with setup methods
 * @param {jQuery} feedMap - Main feed map element
 * @param {jQuery} feedMapZoom - Zoom feed map element
 */
export function setupFeedMapHandlers(handler, feedMap, feedMapZoom) {
  handler.setupScrollIndicatorZoomClick();
  handler.setupScrollIndicatorClick();
  handler.setupScrollIndicatorScroll();
  handler.setupFeedMapTooltipHandlers(feedMap);
  handler.setupFeedMapTooltipHandlers(feedMapZoom);
}

/**
 * Complete feed map setup - creates elements, attaches to handler, sets up handlers.
 * Convenience function that combines the above utilities.
 *
 * @param {object} handler - Handler instance
 * @param {object} config - Config object with get() method
 * @param {object} options - Options for element creation
 * @returns {object} Created elements
 */
export function setupFeedMap(handler, config, options = {}) {
  const feedMapConfig = getFeedMapConfig(config);
  const elements = createFeedMapElements(feedMapConfig, options);
  attachFeedMapToHandler(handler, elements);
  setupFeedMapHandlers(handler, elements.map, elements.zoom);
  return elements;
}

const ZOOM_SEGMENT_STATE_CLASSES =
  'feed-map-segment-read feed-map-segment-current feed-map-segment-empty feed-map-segment-ratioed ' +
  'feed-map-segment-new-boundary ' +
  HEAT_CLASSES;

/**
 * Render one feed map zoom segment (state classes, icon, avatar, handle, time, thread progress).
 * Shared by FeedItemHandler.updateFeedMapZoom() and updateFeedMapZoomDirect().
 *
 * @param {object} handler - FeedItemHandler instance (for engagement/rule/format helpers)
 * @param {jQuery} $segment - Zoom segment element to render into
 * @param {object} segmentState - { item, hasItem, isCurrent, engData, isNewBoundary } for
 *   this segment (isNewBoundary: the new-posts divider runs along its leading edge)
 * @param {object} options - { heatmapMode, heatLevelOf, showIcons, showAvatars, avatarScale,
 *   showHandles, showTimestamps, showRuleColors }
 */
export function renderZoomSegment(handler, $segment, segmentState, options) {
  const { item, hasItem, isCurrent, engData, isNewBoundary } = segmentState;
  const {
    heatmapMode,
    heatLevelOf,
    showIcons,
    showAvatars,
    avatarScale,
    showHandles,
    showTimestamps,
    showRuleColors,
  } = options;

  $segment.empty(); // Clear previous content before updating
  const isRead = item && $(item).hasClass('item-read');

  // Store item reference on segment for tooltip handler
  $segment.data('item', hasItem ? item : null);

  // Remove all state classes
  $segment.removeClass(ZOOM_SEGMENT_STATE_CLASSES);

  // Clear existing icon, avatar, handle, time, and progress bar
  $segment
    .find(
      '.feed-map-segment-icon, .feed-map-segment-avatar, .feed-map-segment-handle, .feed-map-segment-time, .feed-map-segment-progress'
    )
    .remove();

  // Mark empty segments (no corresponding item)
  if (!hasItem) {
    $segment.addClass('feed-map-segment-empty');
    return;
  }

  // Apply read state first
  if (isRead) {
    $segment.addClass('feed-map-segment-read');
  }

  // Apply current selection indicator (outline only, doesn't affect background)
  if (isCurrent) {
    $segment.addClass('feed-map-segment-current');
  }

  // First post on the far side of the new-posts divider (see findNewPostsBoundary)
  if (isNewBoundary) {
    $segment.addClass('feed-map-segment-new-boundary');
  }

  // Apply background color: ratioed takes precedence, then heatmap
  if (engData?.engagement?.isRatioed) {
    $segment.addClass('feed-map-segment-ratioed');
  } else if (heatmapMode !== 'None' && engData && heatLevelOf) {
    const heatLevel = heatLevelOf(engData.score);
    if (heatLevel > 0) {
      $segment.addClass(`feed-map-segment-heat-${heatLevel}`);
    }
  }

  // Add content icon if enabled (appears on top)
  if (showIcons && engData?.engagement) {
    const icon = handler.getContentIcon(engData.engagement);
    if (icon) {
      $segment.append(`<span class="feed-map-segment-icon">${icon}</span>`);
    }
  }

  // Add avatar if enabled (appears below icons, with reposter overlay for reposts)
  if (showAvatars && engData?.engagement?.avatarUrl) {
    const avatarUrl = engData.engagement.avatarUrl;
    // Avatar size in pixels: base 32px scaled by user preference (25-100%)
    const avatarHeight = Math.round(32 * (avatarScale / 100));
    let avatarStyle = `height: ${avatarHeight}px`;
    // Apply author rule color border if enabled
    if (showRuleColors && engData?.engagement?.handle) {
      const categoryIndex = handler.getFilterCategoryIndexForHandle(engData.engagement.handle);
      if (categoryIndex >= 0) {
        const color = handler.getColorForCategoryIndex(categoryIndex);
        avatarStyle += `; box-shadow: 0 0 0 2px ${color}; border-radius: 50%`;
      }
    }
    // Apply Clearsky block styling (overrides rule color if blocked)
    const blockInfo = handler.getClearskyBlockInfo(engData?.engagement?.handle);
    if (blockInfo.type && blockInfo.color) {
      avatarStyle += `; box-shadow: 0 0 0 3px ${blockInfo.color}; border-radius: 50%`;
    }

    // For reposts with reposter avatar, wrap in container and add reposter overlay
    if (engData?.engagement?.isRepost && engData?.engagement?.reposterAvatarUrl) {
      const reposterHeight = Math.round(avatarHeight * 0.5); // Reposter avatar is half the size
      let reposterStyle = `height: ${reposterHeight}px`;
      // Apply reposter rule color if enabled
      if (showRuleColors && engData?.engagement?.reposterHandle) {
        const reposterCategoryIndex = handler.getFilterCategoryIndexForHandle(
          engData.engagement.reposterHandle
        );
        if (reposterCategoryIndex >= 0) {
          const color = handler.getColorForCategoryIndex(reposterCategoryIndex);
          reposterStyle += `; box-shadow: 0 0 0 1px ${color}`;
        }
      }
      // Apply Clearsky block styling to reposter
      const reposterBlockInfo = handler.getClearskyBlockInfo(engData?.engagement?.reposterHandle);
      if (reposterBlockInfo.type && reposterBlockInfo.color) {
        reposterStyle += `; box-shadow: 0 0 0 2px ${reposterBlockInfo.color}`;
      }
      $segment.append(`
            <span class="feed-map-segment-avatar-container">
              <img class="feed-map-segment-avatar" src="${handler.escapeHtml(avatarUrl)}" alt="" style="${avatarStyle}">
              <img class="feed-map-segment-reposter-avatar" src="${handler.escapeHtml(engData.engagement.reposterAvatarUrl)}" alt="" style="${reposterStyle}">
            </span>
          `);
    } else {
      $segment.append(
        `<img class="feed-map-segment-avatar" src="${handler.escapeHtml(avatarUrl)}" alt="" style="${avatarStyle}">`
      );
    }
  }

  // Add handle if enabled (appears below avatar)
  if (showHandles && engData?.engagement?.handle) {
    const handle = engData.engagement.handle;
    const dotIndex = handle.indexOf('.');
    const handleHtml =
      dotIndex > 0
        ? `<span class="feed-map-segment-handle-name">${handler.escapeHtml(handle.substring(0, dotIndex))}</span><span class="feed-map-segment-handle-domain">${handler.escapeHtml(handle.substring(dotIndex))}</span>`
        : `<span class="feed-map-segment-handle-name">${handler.escapeHtml(handle)}</span>`;
    // Apply author rule color if enabled
    let handleStyle = '';
    if (showRuleColors) {
      const categoryIndex = handler.getFilterCategoryIndexForHandle(handle);
      if (categoryIndex >= 0) {
        const color = handler.getColorForCategoryIndex(categoryIndex);
        handleStyle = ` style="background-color: ${color}55; border: 1px solid ${color}88; border-radius: 3px; padding: 0 2px;"`;
      }
    }
    // Apply Clearsky block styling (overrides rule color if blocked)
    const blockInfo = handler.getClearskyBlockInfo(handle);
    if (blockInfo.type && blockInfo.color) {
      handleStyle = ` style="background-color: ${blockInfo.color}55; border: 2px solid ${blockInfo.color}; border-radius: 3px; padding: 0 2px;"`;
    }
    $segment.append(`<span class="feed-map-segment-handle"${handleStyle}>${handleHtml}</span>`);
  }

  // Add relative time in bottom right if enabled
  if (showTimestamps) {
    const timestamp = handler.getTimestampForItem(item);
    if (timestamp) {
      const relativeTime = handler.formatRelativeTime(timestamp);
      // Apply content rule color if enabled
      let timeStyle = '';
      if (showRuleColors) {
        const categoryIndex = handler.getFilterCategoryIndexForContent(item);
        if (categoryIndex >= 0) {
          const color = handler.getColorForCategoryIndex(categoryIndex);
          timeStyle = ` style="background-color: ${color}55; border: 1px solid ${color}88; border-radius: 3px; padding: 0 2px;"`;
        }
      }
      $segment.append(`<span class="feed-map-segment-time"${timeStyle}>${relativeTime}</span>`);
    }
  }

  // Add thread progress bar for unrolled threads
  if (engData?.engagement?.unrolledCount > 0) {
    const unrolledCount = engData.engagement.unrolledCount;
    const totalPosts = unrolledCount + 1; // main post + replies
    // For current item, determine which posts have been visited based on threadIndex
    const currentThreadIndex = isCurrent && handler.threadIndex != null ? handler.threadIndex : -1;
    // Build segments for each post in thread
    let segmentsHtml = '';
    for (let i = 0; i < totalPosts; i++) {
      const isVisited = i <= currentThreadIndex;
      const segmentClass = isVisited
        ? 'feed-map-thread-segment feed-map-thread-segment-visited'
        : 'feed-map-thread-segment';
      segmentsHtml += `<div class="${segmentClass}"></div>`;
    }
    $segment.append(
      `<div class="feed-map-segment-progress" data-total="${totalPosts}">${segmentsHtml}</div>`
    );
  }
}
