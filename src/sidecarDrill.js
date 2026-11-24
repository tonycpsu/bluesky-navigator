// Pure helpers for drilling into reply levels in the reply sidecar.
// No DOM, jQuery, or config access, so these run in Node.

/**
 * Return a sorted copy of posts for the given sidecar reply sort order.
 * @param {object[]} posts
 * @param {string} sortOrder
 * @returns {object[]}
 */
export function sortReplyPosts(posts, sortOrder) {
  return [...posts].sort((a, b) => {
    switch (sortOrder) {
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
        console.error(`unknown sort order: ${sortOrder}`);
    }
  });
}

/**
 * Direct replies of a thread node that have a post, minus excluded post ids
 * (rkeys), sorted by sortOrder.
 * @param {object} node
 * @param {{ sortOrder: string, excludePostIds?: Set<string> }} options
 * @returns {object[]}
 */
export function getLevelReplies(node, { sortOrder, excludePostIds }) {
  const visible = (node?.replies ?? [])
    .filter((reply) => reply.post)
    .filter((reply) => {
      const replyPostId = reply.post.uri?.split('/').slice(-1)[0];
      return !replyPostId || !excludePostIds?.has(replyPostId);
    });
  const sortedPosts = sortReplyPosts(
    visible.map((reply) => reply.post),
    sortOrder
  );
  // Map sorted posts back to their nodes
  const nodeByPost = new Map(visible.map((reply) => [reply.post, reply]));
  return sortedPosts.map((post) => nodeByPost.get(post));
}

// Marks a node whose replies came from its own fetch, so an empty result isn't refetched
const REPLIES_FETCHED = Symbol('repliesFetched');

/** Record that the node's replies were fetched (they may legitimately be empty). */
export function markRepliesFetched(node) {
  if (node) node[REPLIES_FETCHED] = true;
}

/** True when the node has replies on the server that are not loaded or fetched yet. */
export function needsFetch(node) {
  return node?.post?.replyCount > 0 && !node.replies?.length && !node[REPLIES_FETCHED];
}

/** True when the node's post has any replies. */
export function hasChildReplies(node) {
  return node?.post?.replyCount > 0;
}
