const constants = {
  DEFAULT_STATE_SAVE_TIMEOUT: 5000,
  URL_MONITOR_INTERVAL: 500,
  STATE_KEY: "bluesky_state",
  DRAWER_MENU_SELECTOR: 'button[aria-label="Open drawer menu"]',
  SCREEN_SELECTOR: "main > div > div > div",
  HOME_SCREEN_SELECTOR: 'div[data-testid="HomeScreen"]',
  get FEED_TAB_SELECTOR() {
    return `${constants.HOME_SCREEN_SELECTOR} > div > div`;
  },
  get TOOLBAR_CONTAINER_SELECTOR() {
    return `${constants.FEED_TAB_SELECTOR} > div:first-child`;
  },
  LOAD_NEW_BUTTON_SELECTOR: "button[aria-label^='Load new']",
  get LOAD_NEW_INDICATOR_SELECTOR() {
    return `${constants.LOAD_NEW_BUTTON_SELECTOR} div[style*="border-color: rgb(197, 207, 217)"]`;
  },
  get FEED_CONTAINER_SELECTOR() {
    return `${constants.HOME_SCREEN_SELECTOR} div[data-testid$="FeedPage"] div[style*="removed-body-scroll-bar-size"] > div`;
  },
  get STATUS_BAR_CONTAINER_SELECTOR() {
    return `${constants.HOME_SCREEN_SELECTOR} div[data-testid$="FeedPage"] div[style*="removed-body-scroll-bar-size"]`;
  },
  FEED_ITEM_SELECTOR: 'div:not(.css-175oi2r) > div[tabindex="0"][role="link"]:not(.r-1awozwy)',
  LEFT_SIDEBAR_SELECTOR: 'nav.r-pgf20v',
  POST_ITEM_SELECTOR: 'div[data-testid^="postThreadItem-by-"]',
  WIDTH_SELECTOR: 'div[style*="removed-body-scroll-bar-size"][style*="width: 100%"]',
  PROFILE_SELECTOR: 'a[aria-label="View profile"]',
  LINK_SELECTOR: 'a[target="_blank"]',
  CLEARSKY_LIST_REFRESH_INTERVAL: 60*60*24,
  CLEARSKY_BLOCKED_ALL_CSS: {"background-color": "#ff8080"},
  CLEARSKY_BLOCKED_RECENT_CSS: {"background-color": "#cc4040"},
  ITEM_SCROLL_MARGIN: 100
}

export default constants;
