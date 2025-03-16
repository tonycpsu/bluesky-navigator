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
  LEFT_SIDEBAR_SELECTOR: 'nav[role="navigation"]',
  POST_ITEM_SELECTOR: 'div[data-testid^="postThreadItem-by-"]',
  POST_CONTENT_SELECTOR: 'div[data-testid="contentHider-post"]',
  WIDTH_SELECTOR: 'div[style*="removed-body-scroll-bar-size"][style*="width: 100%"]',
  PROFILE_SELECTOR: 'a[aria-label="View profile"]',
  LINK_SELECTOR: 'a[target="_blank"]',
  CLEARSKY_LIST_REFRESH_INTERVAL: 60*60*24,
  CLEARSKY_BLOCKED_ALL_CSS: {"background-color": "#ff8080"},
  CLEARSKY_BLOCKED_RECENT_CSS: {"background-color": "#cc4040"},
  ITEM_SCROLL_MARGIN: 100,
  SIDECAR_SVG_REPLY: `<svg fill="none" width="18" viewBox="0 0 24 24" height="18" style="color: rgb(111, 134, 159); pointer-events: none; flex-shrink: 0; display: block;"><path fill="hsl(211, 20%, 53%)" fill-rule="evenodd" clip-rule="evenodd" d="M2.002 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H12.28l-4.762 2.858A1 1 0 0 1 6.002 21v-2h-1a3 3 0 0 1-3-3V6Zm3-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2a1 1 0 0 1 1 1v1.234l3.486-2.092a1 1 0 0 1 .514-.142h7a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-14Z"></path></svg>`,
  SIDECAR_SVG_REPOST: [
    `<svg fill="none" width="18" viewBox="0 0 24 24" height="18" style="color: rgb(111, 134, 159); flex-shrink: 0; display: block;"><path fill="hsl(211, 20%, 53%)" fill-rule="evenodd" clip-rule="evenodd" d="M17.957 2.293a1 1 0 1 0-1.414 1.414L17.836 5H6a3 3 0 0 0-3 3v3a1 1 0 1 0 2 0V8a1 1 0 0 1 1-1h11.836l-1.293 1.293a1 1 0 0 0 1.414 1.414l2.47-2.47a1.75 1.75 0 0 0 0-2.474l-2.47-2.47ZM20 12a1 1 0 0 1 1 1v3a3 3 0 0 1-3 3H6.164l1.293 1.293a1 1 0 1 1-1.414 1.414l-2.47-2.47a1.75 1.75 0 0 1 0-2.474l2.47-2.47a1 1 0 0 1 1.414 1.414L6.164 17H18a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1Z"></path></svg>`,
    `<svg fill="none" width="18" viewBox="0 0 24 24" height="18" style="color: rgb(19, 195, 113); flex-shrink: 0; display: block;"><path fill="hsl(152, 82%, 42%)" fill-rule="evenodd" clip-rule="evenodd" d="M17.957 2.293a1 1 0 1 0-1.414 1.414L17.836 5H6a3 3 0 0 0-3 3v3a1 1 0 1 0 2 0V8a1 1 0 0 1 1-1h11.836l-1.293 1.293a1 1 0 0 0 1.414 1.414l2.47-2.47a1.75 1.75 0 0 0 0-2.474l-2.47-2.47ZM20 12a1 1 0 0 1 1 1v3a3 3 0 0 1-3 3H6.164l1.293 1.293a1 1 0 1 1-1.414 1.414l-2.47-2.47a1.75 1.75 0 0 1 0-2.474l2.47-2.47a1 1 0 0 1 1.414 1.414L6.164 17H18a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1Z"></path></svg>`
  ],
  SIDECAR_SVG_LIKE: [
    `<svg fill="none" width="18" viewBox="0 0 24 24" height="18" style="color: rgb(111, 134, 159); pointer-events: none; flex-shrink: 0; display: block;"><path fill="hsl(211, 20%, 53%)" fill-rule="evenodd" clip-rule="evenodd" d="M16.734 5.091c-1.238-.276-2.708.047-4.022 1.38a1 1 0 0 1-1.424 0C9.974 5.137 8.504 4.814 7.266 5.09c-1.263.282-2.379 1.206-2.92 2.556C3.33 10.18 4.252 14.84 12 19.348c7.747-4.508 8.67-9.168 7.654-11.7-.541-1.351-1.657-2.275-2.92-2.557Zm4.777 1.812c1.604 4-.494 9.69-9.022 14.47a1 1 0 0 1-.978 0C2.983 16.592.885 10.902 2.49 6.902c.779-1.942 2.414-3.334 4.342-3.764 1.697-.378 3.552.003 5.169 1.286 1.617-1.283 3.472-1.664 5.17-1.286 1.927.43 3.562 1.822 4.34 3.764Z"></path></svg>`,
    `<svg fill="none" width="18" viewBox="0 0 24 24" height="18" class="r-84gixx" style="flex-shrink: 0; display: block;"><path fill="#ec4899" fill-rule="evenodd" clip-rule="evenodd" d="M12.489 21.372c8.528-4.78 10.626-10.47 9.022-14.47-.779-1.941-2.414-3.333-4.342-3.763-1.697-.378-3.552.003-5.169 1.287-1.617-1.284-3.472-1.665-5.17-1.287-1.927.43-3.562 1.822-4.34 3.764-1.605 4 .493 9.69 9.021 14.47a1 1 0 0 0 .978 0Z"></path></svg>`
  ],
  WIDTH_OFFSET: 32
}

export default constants;
