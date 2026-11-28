// Pure helpers for diffing a post's reply tree against what a watch already knows.

/** How many levels of replies to request when fetching a thread. */
export const THREAD_DEPTH = 50;

const TEXT_LIMIT = 100;

/**
 * Classify a getPostThread `thread` node.
 * @param {object} thread
 * @returns {'ok' | 'notFound' | 'blocked'}
 */
export function classifyThread(thread) {
  if (!thread) return 'notFound';
  const type = typeof thread.$type === 'string' ? thread.$type : '';
  if (thread.notFound || type.endsWith('#notFoundPost')) return 'notFound';
  if (thread.blocked || type.endsWith('#blockedPost')) return 'blocked';
  return thread.post ? 'ok' : 'notFound';
}

/**
 * Whether an API error means the post does not exist.
 * @param {{error?: string, message?: string}} error
 * @returns {boolean}
 */
export function isNotFoundError(error) {
  if (!error) return false;
  return error.error === 'NotFound' || /not found/i.test(error.message || '');
}

/**
 * Collect every reply below the root of a thread, at any depth.
 * @param {object} thread
 * @returns {object[]} ReplyInfo[], deduplicated by URI, oldest first
 */
export function collectReplies(thread) {
  const found = new Map();
  const stack = [...(thread?.replies || [])];
  while (stack.length > 0) {
    const node = stack.pop();
    const post = node?.post;
    if (!post) continue;
    if (!found.has(post.uri)) {
      found.set(post.uri, {
        uri: post.uri,
        rkey: post.uri.split('/').pop(),
        authorDid: post.author?.did,
        authorHandle: post.author?.handle,
        authorName: post.author?.displayName,
        authorAvatar: post.author?.avatar,
        // Cut by code points so an emoji's surrogate pair is never split
        text: Array.from(post.record?.text || '')
          .slice(0, TEXT_LIMIT)
          .join(''),
        indexedAt: post.indexedAt,
      });
    }
    if (node.replies) stack.push(...node.replies);
  }
  return [...found.values()].sort((a, b) =>
    a.indexedAt < b.indexedAt ? -1 : a.indexedAt > b.indexedAt ? 1 : 0
  );
}

/**
 * Split replies into those a watch has not seen yet.
 * @param {object[]} replies ReplyInfo[]
 * @param {{known?: string[], knownBefore?: string|null}} record
 * @param {string} selfDid
 * @returns {{newReplies: object[], ownNew: object[]}}
 */
export function findNewReplies(replies, record, selfDid) {
  const known = new Set(record.known || []);
  const newReplies = [];
  const ownNew = [];
  for (const reply of replies) {
    if (known.has(reply.uri)) continue;
    if (record.knownBefore && reply.indexedAt <= record.knownBefore) continue;
    (reply.authorDid === selfDid ? ownNew : newReplies).push(reply);
  }
  return { newReplies, ownNew };
}

/**
 * The at:// URI for a watch record, if it can be determined.
 * @param {{uri?: string|null, authorDid?: string|null, postId?: string}} record
 * @returns {string | null}
 */
export function atUriForWatch(record) {
  if (record.uri) return record.uri;
  if (record.authorDid) return `at://${record.authorDid}/app.bsky.feed.post/${record.postId}`;
  return null;
}
