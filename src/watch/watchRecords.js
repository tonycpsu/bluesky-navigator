// Pure helpers for watch records: checking for new replies, marking seen, tombstones,
// merging copies from other tabs and devices, and enforcing the caps.

import { atUriForWatch, findNewReplies } from './replyTree.js';

/** Most posts that can be watched at once. */
export const MAX_WATCHES = 50;
/** Most reply URIs a watch keeps in `known` after a check (a merge may exceed it). */
export const MAX_KNOWN_REPLIES = 2000;
/** Most replies a watch keeps in `unseen`. */
export const MAX_UNSEEN_REPLIES = 200;
/** A watch with no new replies for this long expires. */
export const WATCH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a tombstone is kept so removals propagate before it is deleted. */
export const WATCH_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function timeOf(timestamp) {
  const t = timestamp ? Date.parse(timestamp) : NaN;
  return isNaN(t) ? 0 : t;
}

/** The later of two ISO timestamps (either may be null). */
function laterOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return timeOf(b) > timeOf(a) ? b : a;
}

/** Whether a reply counts as known to a record (by URI or by `knownBefore`). */
function knows(record, reply) {
  if ((record.known || []).includes(reply.uri)) return true;
  return Boolean(record.knownBefore && reply.indexedAt <= record.knownBefore);
}

/** Whether two URI lists hold the same members (each list is duplicate-free). */
function sameMembers(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((uri) => set.has(uri));
}

function byIndexedAt(a, b) {
  return a.indexedAt < b.indexedAt ? -1 : a.indexedAt > b.indexedAt ? 1 : 0;
}

function tombstone(record, removedAt, watchedAt = record.watchedAt) {
  return {
    postId: record.postId,
    url: record.url,
    uri: record.uri ?? null,
    authorDid: record.authorDid ?? null,
    authorHandle: record.authorHandle ?? null,
    snippet: record.snippet ?? '',
    watchedAt,
    updatedAt: removedAt,
    lastActivityAt: record.lastActivityAt,
    removedAt,
    baselined: false,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
  };
}

function stableJson(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

/** Stable JSON for a record, with `known` and `unseen` compared as sets. */
function comparable(record) {
  if (!record || typeof record !== 'object') return stableJson(record);
  const byUri = (x, y) => (x.uri < y.uri ? -1 : x.uri > y.uri ? 1 : 0);
  return stableJson({
    ...record,
    known: record.known ? [...new Set(record.known)].sort() : record.known,
    unseen: record.unseen ? [...record.unseen].sort(byUri) : record.unseen,
  });
}

/**
 * Start watching a post.
 * @param {object} info WatchInfo
 * @param {string} nowIso
 * @returns {object} WatchRecord
 */
export function createWatch(info, nowIso) {
  return {
    postId: info.postId,
    url: info.url,
    uri: atUriForWatch(info),
    authorDid: info.authorDid ?? null,
    authorHandle: info.authorHandle ?? null,
    snippet: info.snippet ?? '',
    watchedAt: nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
    removedAt: null,
    baselined: false,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
  };
}

/**
 * Whether a record is a live watch (not a tombstone).
 * @param {object} record
 * @returns {boolean}
 */
export function isLive(record) {
  return Boolean(record) && !record.removedAt;
}

/**
 * The live watches in a map.
 * @param {object} map WatchMap
 * @returns {object[]} WatchRecord[]
 */
export function liveWatches(map) {
  return Object.values(map || {}).filter(isLive);
}

/**
 * Whether another post can be watched.
 * @param {object} map WatchMap
 * @returns {boolean}
 */
export function canAddWatch(map) {
  return liveWatches(map).length < MAX_WATCHES;
}

/**
 * Apply the replies found by a check to a watch.
 * @param {object} record WatchRecord (live)
 * @param {object[]} replies ReplyInfo[] currently in the thread
 * @param {{nowIso: string, selfDid?: string}} options
 * @returns {{record: object, newReplies: object[]}}
 */
export function applyCheck(record, replies, { nowIso, selfDid }) {
  let known;
  let unseen = record.unseen || [];
  let lastActivityAt = record.lastActivityAt;
  let newReplies = [];
  let changed = false;

  if (!record.baselined) {
    known = [...new Set(replies.map((r) => r.uri))];
    changed = true;
  } else {
    const found = findNewReplies(replies, record, selfDid);
    newReplies = found.newReplies;
    const added = [...newReplies, ...found.ownNew].map((r) => r.uri);
    known = [...(record.known || []), ...added];
    if (added.length > 0) changed = true;
    if (newReplies.length > 0) {
      unseen = [...unseen, ...newReplies].slice(-MAX_UNSEEN_REPLIES);
      lastActivityAt = nowIso;
    }
  }

  let knownBefore = record.knownBefore ?? null;
  if (known.length > MAX_KNOWN_REPLIES && replies.length > 0) {
    // Collapse what this fetch can date into knownBefore. Known URIs missing from the fetch
    // have no indexedAt to compare, so they stay known by URI.
    for (const r of replies) knownBefore = laterOf(knownBefore, r.indexedAt);
    const fetched = new Set(replies.map((r) => r.uri));
    known = [
      ...known.filter((uri) => !fetched.has(uri)),
      ...replies.filter((r) => r.indexedAt > knownBefore).map((r) => r.uri),
    ];
    // Over-cap URIs missing from the fetch stay put, so a collapse can leave the record as
    // it was; only a real change moves updatedAt
    if (knownBefore !== (record.knownBefore ?? null) || !sameMembers(known, record.known || [])) {
      changed = true;
    }
  }

  return {
    record: {
      ...record,
      baselined: true,
      known,
      knownBefore,
      unseen,
      lastActivityAt,
      updatedAt: changed ? nowIso : record.updatedAt,
    },
    newReplies,
  };
}

/**
 * Mark a watch's post as not found or blocked; it is never polled again.
 * @param {object} record WatchRecord
 * @param {string} nowIso
 * @returns {object} WatchRecord
 */
export function markUnavailable(record, nowIso) {
  return { ...record, unavailable: true, updatedAt: nowIso };
}

/**
 * Mark every unseen reply of a watch as seen.
 * @param {object} record WatchRecord
 * @param {string} nowIso
 * @returns {object} WatchRecord
 */
export function markWatchSeen(record, nowIso) {
  return { ...record, unseen: [], updatedAt: nowIso };
}

/**
 * Stop watching a post, leaving a tombstone so the removal syncs.
 * @param {object} record WatchRecord
 * @param {string} nowIso
 * @returns {object} tombstone WatchRecord
 */
export function removeWatch(record, nowIso) {
  return tombstone(record, nowIso);
}

/**
 * Merge two copies of the same watch (either may be missing).
 * @param {object|undefined} a WatchRecord
 * @param {object|undefined} b WatchRecord
 * @returns {object} WatchRecord
 */
export function mergeWatch(a, b) {
  if (!a) return b;
  if (!b) return a;

  const epoch = laterOf(a.watchedAt, b.watchedAt);
  const removed = laterOf(a.removedAt, b.removedAt);
  if (removed && timeOf(removed) >= timeOf(epoch)) {
    const source = a.removedAt === removed ? a : b;
    return tombstone(source, removed, epoch);
  }

  const copies = [a, b].filter((c) => !removed || timeOf(c.watchedAt) > timeOf(removed));
  if (copies.length === 1) return copies[0];

  const newer = timeOf(b.updatedAt) > timeOf(a.updatedAt) ? b : a;
  const older = newer === a ? b : a;

  // Not trimmed: the next applyCheck collapses an oversized set into knownBefore using real
  // indexedAt values, so no reply dropped here could be re-reported as new.
  const known = [...new Set([...(a.known || []), ...(b.known || [])])];

  const byUri = new Map();
  for (const r of [...(a.unseen || []), ...(b.unseen || [])]) {
    if (!byUri.has(r.uri)) byUri.set(r.uri, r);
  }
  const unseen = [...byUri.values()]
    .filter(
      (r) => !copies.some((c) => knows(c, r) && !(c.unseen || []).some((u) => u.uri === r.uri))
    )
    .sort(byIndexedAt)
    .slice(-MAX_UNSEEN_REPLIES);

  return {
    postId: newer.postId ?? older.postId,
    url: newer.url ?? older.url,
    uri: a.uri || b.uri || null,
    authorDid: newer.authorDid ?? older.authorDid ?? null,
    authorHandle: newer.authorHandle ?? older.authorHandle ?? null,
    snippet: newer.snippet ?? older.snippet ?? '',
    watchedAt: epoch,
    updatedAt: laterOf(a.updatedAt, b.updatedAt),
    lastActivityAt: laterOf(a.lastActivityAt, b.lastActivityAt),
    removedAt: null,
    baselined: Boolean(a.baselined || b.baselined),
    knownBefore: laterOf(a.knownBefore, b.knownBefore),
    known,
    unseen,
    unavailable: Boolean(a.unavailable || b.unavailable),
  };
}

/**
 * Merge two watch maps record by record.
 * @param {object} a WatchMap
 * @param {object} b WatchMap
 * @returns {object} WatchMap
 */
export function mergeWatchMaps(a, b) {
  const result = {};
  const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const id of ids) result[id] = mergeWatch(a?.[id], b?.[id]);
  return result;
}

/**
 * The post ids whose records differ between two maps.
 * @param {object} before WatchMap
 * @param {object} after WatchMap
 * @returns {Set<string>}
 */
export function changedIds(before, after) {
  const changed = new Set();
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const id of ids) {
    if (comparable(before?.[id]) !== comparable(after?.[id])) changed.add(id);
  }
  return changed;
}

/**
 * Expire idle watches, drop old tombstones and enforce the watch limit.
 * @param {object} map WatchMap
 * @param {number} nowMs
 * @returns {object} WatchMap
 */
export function pruneWatches(map, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const result = {};
  for (const [id, record] of Object.entries(map || {})) {
    if (isLive(record)) {
      result[id] =
        nowMs - timeOf(record.lastActivityAt) > WATCH_EXPIRY_MS
          ? tombstone(record, nowIso)
          : record;
    } else if (nowMs - timeOf(record.removedAt) <= WATCH_TOMBSTONE_TTL_MS) {
      result[id] = record;
    }
  }
  const live = liveWatches(result).sort(
    (x, y) => timeOf(y.lastActivityAt) - timeOf(x.lastActivityAt)
  );
  for (const record of live.slice(MAX_WATCHES)) {
    result[record.postId] = tombstone(record, nowIso);
  }
  return result;
}

/**
 * Total unseen replies across live watches.
 * @param {object} map WatchMap
 * @returns {number}
 */
export function unseenTotal(map) {
  return liveWatches(map).reduce((sum, r) => sum + (r.unseen || []).length, 0);
}

/**
 * Unseen replies for one post, or 0 if it is not a live watch.
 * @param {object} map WatchMap
 * @param {string} postId
 * @returns {number}
 */
export function unseenCountFor(map, postId) {
  const record = map?.[postId];
  return isLive(record) ? (record.unseen || []).length : 0;
}

function newestUnseenTime(record) {
  return Math.max(...record.unseen.map((r) => timeOf(r.indexedAt)));
}

/**
 * Live watches in display order: those with unseen replies first (newest unseen first),
 * then the rest by most recent activity.
 * @param {object} map WatchMap
 * @returns {object[]} WatchRecord[]
 */
export function sortForList(map) {
  const live = liveWatches(map);
  const withUnseen = live
    .filter((r) => (r.unseen || []).length > 0)
    .sort((x, y) => newestUnseenTime(y) - newestUnseenTime(x));
  const rest = live
    .filter((r) => !(r.unseen || []).length)
    .sort((x, y) => timeOf(y.lastActivityAt) - timeOf(x.lastActivityAt));
  return [...withUnseen, ...rest];
}

/**
 * Whether hide-read should hide a feed item for being read. A read post in a watched
 * thread with unseen replies stays visible.
 * @param {boolean} isRead The post is in the seen state.
 * @param {boolean} watchEnabled The "Watch threads" setting is on.
 * @param {number} unseenCount Unseen replies for the post (0 if not watched).
 * @returns {boolean}
 */
export function hiddenAsRead(isRead, watchEnabled, unseenCount) {
  return Boolean(isRead) && !(watchEnabled && unseenCount > 0);
}
