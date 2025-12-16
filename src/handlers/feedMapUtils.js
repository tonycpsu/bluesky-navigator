// feedMapUtils.js - Shared utilities for feed map creation across handlers
/* global $ */

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
 * @returns {object} Object containing all created jQuery elements
 */
export function createFeedMapElements(feedMapConfig, options = {}) {
  const { styleClass, themeClass, customPropsStyle } = feedMapConfig;
  const { isToolbar = false } = options;

  // Container class varies by position
  const containerClass = isToolbar ? 'feed-map-container feed-map-container-toolbar' : 'feed-map-container';
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
  wrapper.append(container);

  // Add connector SVG between main indicator and zoom
  const connector = $(`<div class="feed-map-connector">
    <svg class="feed-map-connector-svg" preserveAspectRatio="none">
      <path class="feed-map-connector-path feed-map-connector-left" fill="none"/>
      <path class="feed-map-connector-path feed-map-connector-right" fill="none"/>
    </svg>
  </div>`);
  wrapper.append(connector);

  // Create zoom container and elements
  const zoomContainer = $(`<div class="${zoomContainerClass}"></div>`);
  const zoomLabelStart = $(`<span class="feed-map-label feed-map-label-start"></span>`);
  const zoomLabelEnd = $(`<span class="feed-map-label feed-map-label-end"></span>`);
  const zoom = $(
    `<div id="feed-map-position-indicator-zoom" class="feed-map-position-indicator feed-map-position-indicator-zoom"></div>`
  );

  // Inner wrapper for smooth scroll animation (only for toolbar)
  let zoomInner = null;
  if (isToolbar) {
    zoomInner = $(`<div class="feed-map-zoom-inner"></div>`);
    zoom.append(zoomInner);
  }

  zoomContainer.append(zoomLabelStart);
  zoomContainer.append(zoom);
  zoomContainer.append(zoomLabelEnd);
  wrapper.append(zoomContainer);

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
