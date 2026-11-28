// SurrealQL for the remote `watch` table: one record per watched post, keyed like `seen`.

import { isValidPostId, isValidTimestamp } from '../StateManager.js';
import { WATCH_TOMBSTONE_TTL_MS } from './watchRecords.js';

/**
 * Record id for a post's remote watch entry, with the same character mapping as
 * `seenRecordId` (`-` and anything else outside [a-zA-Z0-9_] becomes `_`).
 * @param {string} postId
 * @returns {string}
 */
export function watchRecordId(postId) {
  return `watch:${postId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/** Replace lone surrogates (e.g. half an emoji) with U+FFFD; SurrealQL rejects them. */
function wellFormed(text) {
  if (typeof text.toWellFormed === 'function') return text.toWellFormed();
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  );
}

function recordJson(record) {
  return JSON.stringify(record, (key, value) =>
    typeof value === 'string' ? wellFormed(value) : value
  );
}

const TIMESTAMP_FIELDS = ['watchedAt', 'updatedAt', 'lastActivityAt', 'removedAt', 'knownBefore'];

/** The server may return datetimes in another format; store them as toISOString does. */
function normalizeTime(value) {
  if (typeof value !== 'string') return value;
  const t = Date.parse(value);
  return isNaN(t) ? value : new Date(t).toISOString();
}

function isValidRecord(record) {
  return (
    Boolean(record) &&
    isValidPostId(record.postId) &&
    isValidTimestamp(record.watchedAt) &&
    isValidTimestamp(record.updatedAt) &&
    (record.removedAt == null || isValidTimestamp(record.removedAt))
  );
}

/**
 * One UPSERT per record, with lone surrogates in strings replaced by U+FFFD. Records with an invalid postId or timestamp are skipped.
 * @param {object[]} records WatchRecord[]
 * @returns {{statements: string[], skipped: string[]}} statements and the skipped postIds
 */
export function buildWatchUpsertStatements(records) {
  const statements = [];
  const skipped = [];
  for (const record of records) {
    if (!isValidRecord(record)) {
      skipped.push(record?.postId);
      continue;
    }
    statements.push(`UPSERT ${watchRecordId(record.postId)} CONTENT ${recordJson(record)};`);
  }
  return { statements, skipped };
}

/**
 * Select every watch row, or only the rows for the given post ids (invalid ids are dropped).
 * @param {string[]} [postIds]
 * @returns {string|null} the query, or null if `postIds` holds no valid id
 */
export function buildWatchSelectQuery(postIds) {
  if (postIds === undefined) return 'SELECT * FROM watch;';
  const ids = postIds.filter(isValidPostId).map(watchRecordId);
  return ids.length > 0 ? `SELECT * FROM ${ids.join(', ')};` : null;
}

/**
 * Turn remote rows into a WatchMap. Drops the record `id`, skips rows without a valid
 * postId, fills missing `known`/`unseen` arrays and normalizes timestamps (so an unchanged
 * record compares equal to the local copy).
 * @param {object[]} rows
 * @returns {object} WatchMap
 */
export function parseWatchRows(rows) {
  const map = {};
  for (const row of rows || []) {
    if (!row || !isValidPostId(row.postId)) continue;
    // eslint-disable-next-line no-unused-vars
    const { id, ...record } = row;
    const parsed = {
      ...record,
      known: Array.isArray(record.known) ? record.known : [],
      unseen: Array.isArray(record.unseen)
        ? record.unseen.map((r) =>
            r && typeof r === 'object' ? { ...r, indexedAt: normalizeTime(r.indexedAt) } : r
          )
        : [],
    };
    for (const field of TIMESTAMP_FIELDS) {
      if (field in parsed) parsed[field] = normalizeTime(parsed[field]);
    }
    map[record.postId] = parsed;
  }
  return map;
}

/**
 * Delete tombstones older than the tombstone TTL (30 days).
 * @param {number} nowMs
 * @returns {string}
 */
export function buildWatchCleanupQuery(nowMs) {
  const cutoff = new Date(nowMs - WATCH_TOMBSTONE_TTL_MS).toISOString();
  return `DELETE watch WHERE removedAt != NONE AND removedAt != NULL AND removedAt < "${cutoff}";`;
}
