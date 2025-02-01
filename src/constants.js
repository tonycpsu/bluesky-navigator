const constants = {
  DEFAULT_HISTORY_MAX: 5000,
  DEFAULT_STATE_SAVE_TIMEOUT: 5000,
  URL_MONITOR_INTERVAL: 500,
  STATE_KEY: "bluesky_state",
  TOOLBAR_CONTAINER_SELECTOR: 'div[data-testid="HomeScreen"] > div > div > div:first-child',
  STATUS_BAR_CONTAINER_SELECTOR: 'div[style="background-color: rgb(255, 255, 255),"]',
  LOAD_NEW_BUTTON_SELECTOR: "button[aria-label^='Load new']",
  get LOAD_NEW_INDICATOR_SELECTOR() {
    return `${constants.LOAD_NEW_BUTTON_SELECTOR} div[style*="border-color: rgb(197, 207, 217)"]`;
  },
  FEED_CONTAINER_SELECTOR: 'div[data-testid="HomeScreen"] div[data-testid$="FeedPage"] div[style*="removed-body-scroll-bar-size"] > div',
  FEED_ITEM_SELECTOR: 'div:not(.css-175oi2r) > div[tabindex="0"][role="link"]:not(.r-1awozwy)',
  POST_ITEM_SELECTOR: 'div[data-testid^="postThreadItem-by-"]',
  PROFILE_SELECTOR: 'a[aria-label="View profile"]',
  LINK_SELECTOR: 'a[target="_blank"]',
  CLEARSKY_LIST_REFRESH_INTERVAL: 60*60*24,
  CLEARSKY_BLOCKED_ALL_CSS: {"background-color": "#ff8080"},
  CLEARSKY_BLOCKED_RECENT_CSS: {"background-color": "#cc4040"},
  ITEM_SCROLL_MARGIN: 100
}

export default constants;
