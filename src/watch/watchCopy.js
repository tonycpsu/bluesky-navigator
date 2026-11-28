// Pure copy, grouping and small helpers for watched-thread toasts and the watch button.

/** Most toasts shown for one check round, including the summary toast. */
export const MAX_ROUND_TOASTS = 5;

/** Where the summary toast points. */
export const WATCHED_TAB_URL = '/notifications#watched';

export const WATCH_LIMIT_MESSAGE = 'You can watch up to 50 threads. Stop watching one first.';
export const NEEDS_LOGIN_MESSAGE =
  'Checking for new replies needs the app-password login in settings.';

/**
 * Format a timestamp like the notification toasts do.
 * @param {string} iso
 * @param {number} nowMs
 * @returns {string} 'now' | '<n>m' | '<n>h' | '<n>d', or '' for an invalid timestamp
 */
export function relativeTime(iso, nowMs) {
  const diffMs = nowMs - Date.parse(iso);
  if (isNaN(diffMs)) return '';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

/** The handle Bluesky gives accounts whose handle no longer verifies. */
export const INVALID_HANDLE = 'handle.invalid';

/**
 * The profile segment for an author: the handle, or the DID when the handle is missing or
 * invalid (a /profile/handle.invalid link doesn't resolve).
 * @param {string|null|undefined} handle
 * @param {string|null|undefined} did
 * @returns {string}
 */
export function profileSegment(handle, did) {
  return handle && handle !== INVALID_HANDLE ? handle : did || handle || '';
}

/**
 * App path of a reply.
 * @param {object} reply ReplyInfo
 * @returns {string}
 */
export function replyUrl(reply) {
  return `/profile/${profileSegment(reply.authorHandle, reply.authorDid)}/post/${reply.rkey}`;
}

/**
 * The post id (rkey) in a post page path, ignoring trailing segments.
 * @param {string} pathname
 * @returns {string | null}
 */
export function postIdFromPath(pathname) {
  const match = /^\/profile\/[^/]+\/post\/([^/?#]+)/.exec(pathname || '');
  return match ? match[1] : null;
}

function newestOf(replies) {
  return replies.reduce((best, r) => (r.indexedAt > best.indexedAt ? r : best), replies[0]);
}

/**
 * Build the toast for one watched post's new replies.
 * @param {object} record WatchRecord
 * @param {object[]} newReplies ReplyInfo[] (non-empty)
 * @param {number} nowMs
 * @returns {object} ToastNotification
 */
export function buildWatchToast(record, newReplies, nowMs) {
  const newest = newestOf(newReplies);
  const base = {
    type: 'watch',
    kind: 'watch',
    postId: record.postId,
    replyUris: newReplies.map((r) => r.uri),
    preview: newest.text,
    time: relativeTime(newest.indexedAt, nowMs),
    indexedAt: newest.indexedAt,
  };
  if (newReplies.length === 1) {
    return {
      ...base,
      url: replyUrl(newest),
      author: newest.authorName || newest.authorHandle,
      handle: newest.authorHandle,
      avatar: newest.authorAvatar,
      action: "replied in a thread you're watching",
    };
  }
  return {
    ...base,
    url: record.url,
    author: `${newReplies.length} new replies`,
    handle: null,
    avatar: '',
    action: "in a thread you're watching",
  };
}

/**
 * Turn one round's results into at most MAX_ROUND_TOASTS toasts, newest activity first.
 * @param {Array<{record: object, newReplies: object[]}>} results
 * @param {number} nowMs
 * @returns {object[]} ToastNotification[]
 */
export function planRoundToasts(results, nowMs) {
  const withReplies = results
    .filter((r) => r.newReplies.length > 0)
    .map((r) => ({ ...r, newestAt: newestOf(r.newReplies).indexedAt }))
    .sort((a, b) => (a.newestAt < b.newestAt ? 1 : a.newestAt > b.newestAt ? -1 : 0));

  if (withReplies.length <= MAX_ROUND_TOASTS) {
    return withReplies.map((r) => buildWatchToast(r.record, r.newReplies, nowMs));
  }

  const shown = withReplies.slice(0, MAX_ROUND_TOASTS - 1);
  const rest = withReplies.slice(MAX_ROUND_TOASTS - 1);
  const restNewest = rest[0].newestAt;
  const summary = {
    type: 'watch',
    kind: 'watch',
    postId: null,
    url: WATCHED_TAB_URL,
    replyUris: [],
    author: `${rest.length} more watched threads`,
    handle: null,
    avatar: '',
    action: 'have new replies',
    preview: '',
    time: relativeTime(restNewest, nowMs),
    indexedAt: restNewest,
  };
  return [...shown.map((r) => buildWatchToast(r.record, r.newReplies, nowMs)), summary];
}

/**
 * Label and tooltip for the watch button.
 * @param {{watched: boolean, unseen: number, hasApi: boolean}} state
 * @returns {{label: string, title: string}}
 */
export function watchButtonLabel({ watched, unseen, hasApi }) {
  const label = watched ? 'Stop watching' : 'Watch for new replies';
  let title = label;
  if (unseen > 0) title += ` · ${unseen} new ${unseen === 1 ? 'reply' : 'replies'}`;
  if (!hasApi) title += ` (${NEEDS_LOGIN_MESSAGE})`;
  return { label, title };
}

/**
 * Content for the unseen-replies badge on Bluesky's Notifications nav link.
 * @param {number} count unseen watched replies
 * @returns {{hidden: boolean, text: string, label: string}}
 */
export function navBadgeContent(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return {
    hidden: n === 0,
    text: n === 0 ? '' : n > 99 ? '99+' : String(n),
    label: `${n} unseen watched replies`,
  };
}
