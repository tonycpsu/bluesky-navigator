// viewFullThread.js - Keep Bluesky's "View full thread" rows with the thread they belong to
//
// For a reply deep in a thread, Bluesky's feed shows a slice of three posts: the thread
// root, the reply's parent and the reply. Between the root and the parent it renders a
// "View full thread" link (with a dotted connector) as its own list row, a sibling of the
// post rows:
//
//   row  .thread.thread-first   (root post)
//   row  > a[href="/profile/<did>/post/<root rkey>"]   ("View full thread")
//   row  .thread                (parent post)
//   row  .thread.thread-last    (reply)
//
// The link is not a post (it never gets .item or .thread), so sortItems() and
// filterItems() have to carry it along with its thread explicitly. The helpers here
// work on plain row descriptors so the grouping and visibility rules can be unit tested;
// the handler builds the descriptors from the DOM.
//
// Row descriptors (in DOM order unless stated otherwise):
//   { kind: 'post', sortIndex, itemIndex, first, last, postId, hidden }
//     first / last: the row has thread-first / thread-last; postId: the post's rkey
//     (null if unknown); hidden: the row is filtered out.
//   { kind: 'vft', postId, stampedSortIndex, owner }
//     postId: the rkey the link points to (the thread root, Bluesky renders the link
//     with the uri of the slice's first post); stampedSortIndex: the sort index of the
//     owner recorded on an earlier pass (null if none); owner: the owning post row
//     descriptor, filled in from resolveViewFullThreadOwners().
//   { kind: 'other' }  any other list child (Bluesky's header, end marker, loader).

/** Class added to every "View full thread" list row. */
export const VFT_ROW_CLASS = 'bsky-navigator-vft-row';

/** Class that hides a "View full thread" row whose thread does not visibly continue. */
export const VFT_HIDDEN_CLASS = 'bsky-navigator-vft-hidden';

/** Attribute recording the sort index of the thread a "View full thread" row belongs to. */
export const VFT_SORT_INDEX_ATTR = 'data-bsky-navigator-vft-sort-index';

const POST_HREF = /\/profile\/[^/]+\/post\/([^/?#]+)/;

/** Post rkey a "View full thread" link points to, or null. */
export function postIdFromViewFullThreadHref(href) {
  const match = typeof href === 'string' ? href.match(POST_HREF) : null;
  return match ? match[1] : null;
}

/**
 * The link of a "View full thread" list row, or null if `row` is not one.
 *
 * The test is structural, because the "View full thread" label (and its aria-label) is
 * translated: a list row that is not a post row, contains no feed post, and whose only
 * element child is a link to a post.
 */
export function viewFullThreadLink(row) {
  if (!row || row.nodeType !== 1 || row.classList.contains('thread')) return null;
  if (row.childElementCount !== 1) return null;
  const link = row.firstElementChild;
  if (link.tagName !== 'A' || !POST_HREF.test(link.getAttribute('href') || '')) return null;
  if (link.querySelector('[data-testid^="feedItem-"], [data-testid^="postThreadItem-"]')) {
    return null;
  }
  return link;
}

/**
 * Find the post row each "View full thread" row belongs to.
 *
 * The owner is the thread-first row of the post the link points to (the thread root),
 * found by post id so it survives re-sorts and React re-creating either row. If several
 * rows show that root, prefer the group recorded on an earlier pass, then the row right
 * before the link (Bluesky inserts the link right after its root). If the post id of the
 * link or of the adjacent row is unknown, fall back to that adjacent row, provided it
 * starts a multi-post thread.
 *
 * @param {object[]} rows - all list rows, in DOM order
 * @returns {Map<object, object|null>} vft descriptor -> owning post descriptor or null
 */
export function resolveViewFullThreadOwners(rows) {
  const roots = new Map();
  for (const row of rows) {
    if (row.kind === 'post' && row.first && row.postId) {
      if (!roots.has(row.postId)) roots.set(row.postId, []);
      roots.get(row.postId).push(row);
    }
  }
  const owners = new Map();
  rows.forEach((row, i) => {
    if (row.kind !== 'vft') return;
    const prev = i > 0 ? rows[i - 1] : null;
    const candidates = (row.postId && roots.get(row.postId)) || [];
    let owner = null;
    if (candidates.length) {
      owner =
        (row.stampedSortIndex != null &&
          candidates.find((c) => c.sortIndex === row.stampedSortIndex)) ||
        (candidates.includes(prev) && prev) ||
        candidates[0];
    } else if (
      prev &&
      prev.kind === 'post' &&
      prev.first &&
      !prev.last &&
      (!row.postId || !prev.postId)
    ) {
      owner = prev;
    }
    owners.set(row, owner);
  });
  return owners;
}

/**
 * Target order of the feed rows: post rows by sort index (descending when reversed),
 * posts of one thread by item index, and each "View full thread" row right after its
 * owner (the thread root), so it stays between the root and the rest of the thread.
 *
 * @param {object[]} posts - post row descriptors, any order
 * @param {object[]} vfts - vft descriptors with `owner` set
 * @param {boolean} reversed
 * @returns {{order: object[], orphans: object[]}} orphans: links whose owner is not
 *   among `posts`; they are left out of the order (and should be hidden)
 */
export function orderFeedRows(posts, vfts, reversed) {
  const order = [...posts].sort((a, b) => {
    if (a.sortIndex !== b.sortIndex) {
      return reversed ? b.sortIndex - a.sortIndex : a.sortIndex - b.sortIndex;
    }
    return a.itemIndex - b.itemIndex;
  });
  const byOwner = new Map();
  const orphans = [];
  for (const v of vfts) {
    if (v.owner && posts.includes(v.owner)) {
      if (!byOwner.has(v.owner)) byOwner.set(v.owner, []);
      byOwner.get(v.owner).push(v);
    } else {
      orphans.push(v);
    }
  }
  if (!byOwner.size) return { order, orphans };
  const out = [];
  for (const row of order) {
    out.push(row);
    if (byOwner.has(row)) out.push(...byOwner.get(row));
  }
  return { order: out, orphans };
}

/**
 * "View full thread" rows to hide: a link is shown only where it connects two visible
 * posts of its thread, i.e. it sits right after its visible owner (the root) and right
 * before the next, visible, post of the same thread (same sort index). Links without an
 * owner, out of place, or next to a filtered (rule, search, hide-read) post are hidden.
 *
 * @param {object[]} rows - all list rows, in DOM order, vfts with `owner` set
 * @returns {Set<object>} vft descriptors to hide
 */
export function viewFullThreadRowsToHide(rows) {
  const hide = new Set();
  rows.forEach((row, i) => {
    if (row.kind !== 'vft') return;
    const { owner } = row;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const connects =
      owner &&
      prev === owner &&
      !owner.hidden &&
      next &&
      next.kind === 'post' &&
      next.sortIndex === owner.sortIndex &&
      !next.hidden;
    if (!connects) hide.add(row);
  });
  return hide;
}
