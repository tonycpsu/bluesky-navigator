// unrollScroll.js - Scroll math for selecting posts inside an unrolled thread

// Sub-pixel tolerance, as in ItemHandler.isElementFullyVisible()
const TOLERANCE = 2;

/**
 * Plan how to bring a post inside an unrolled thread's scroll container into view.
 *
 * The post is scrolled to the top of the container (plus `padding`, so it sits where
 * post 1 sits), and the page is scrolled only when the item itself is not fully in
 * view. Then the item's header is aligned at the toolbar line, the same as when the
 * item (or its post 1) is selected. If the container can't scroll far enough to keep
 * the post on screen that way (it doesn't overflow, or the window is very short), the
 * page instead scrolls the post's top to the toolbar line.
 *
 * All positions are viewport coordinates (getBoundingClientRect()) measured before
 * any scrolling. Pure: it only does arithmetic.
 *
 * @param {Object} m
 * @param {number} m.scrollTop - Container's current scrollTop
 * @param {number} m.scrollHeight - Container's scrollHeight
 * @param {number} m.clientHeight - Container's clientHeight
 * @param {number} m.containerTop - Container's top
 * @param {number} m.postTop - Post's top
 * @param {number} m.postHeight - Post's height
 * @param {number} m.itemTop - Item's (the post row with its header) top
 * @param {number} m.itemBottom - Item's bottom
 * @param {number} m.viewTop - Top of the unobstructed viewport (toolbar bottom)
 * @param {number} m.viewBottom - Bottom of the unobstructed viewport (status bar top)
 * @param {number} [m.padding=0] - Gap to leave between the container's top and the post
 * @returns {{containerScrollTop: number, pageDelta: number}} The container's new
 *   scrollTop, and how far to scroll the window (0 = leave the page alone)
 */
export function planUnrolledPostScroll(m) {
  const padding = m.padding || 0;
  const maxScroll = Math.max(0, m.scrollHeight - m.clientHeight);
  const wanted = m.scrollTop + (m.postTop - m.containerTop) - padding;
  const containerScrollTop = Math.round(Math.min(Math.max(wanted, 0), maxScroll));
  // Where the post ends up once the container has scrolled
  const postTop = m.postTop - (containerScrollTop - m.scrollTop);

  const itemFullyVisible =
    m.itemTop >= m.viewTop - TOLERANCE && m.itemBottom <= m.viewBottom + TOLERANCE;
  if (itemFullyVisible) return { containerScrollTop, pageDelta: 0 };

  // Align the item's header at the toolbar line
  let pageDelta = m.itemTop - m.viewTop;
  // ... unless that leaves too little of the post on screen
  const viewHeight = m.viewBottom - m.viewTop;
  const minVisible = Math.min(m.postHeight, viewHeight / 2);
  if (postTop - pageDelta > m.viewBottom - minVisible) {
    pageDelta = postTop - m.viewTop;
  }
  if (Math.abs(pageDelta) <= TOLERANCE) pageDelta = 0;
  return { containerScrollTop, pageDelta: Math.round(pageDelta) };
}
