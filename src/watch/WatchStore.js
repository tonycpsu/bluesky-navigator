// Local (GM storage) and remote (SurrealDB `watch` table) storage for watch records.
// Several tabs and devices write the same records, so every write re-reads and merges
// instead of overwriting.

import { mergeWatch, mergeWatchMaps, changedIds, pruneWatches } from './watchRecords.js';
import {
  buildWatchUpsertStatements,
  buildWatchSelectQuery,
  parseWatchRows,
  buildWatchCleanupQuery,
} from './watchRemote.js';

/** GM storage key for the watch map. */
export const WATCHES_GM_KEY = 'bluesky_navigator_watches';
/** Debounce before pushing saved watches to the remote server. */
export const REMOTE_PUSH_DELAY_MS = 5000;
/** Most records upserted in one remote request. */
export const UPSERT_CHUNK_SIZE = 10;

const STORAGE_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class WatchStore {
  /**
   * @param {object} options
   * @param {(key: string, fallback: any) => any} options.getValue GM_getValue
   * @param {(key: string, value: string) => void} options.setValue GM_setValue
   * @param {{enabled: boolean, queryAll: (q: string) => Promise<object[]>,
   *   exec: (q: string) => Promise<any>}|null} options.remote
   * @param {{setTimeout: Function, clearTimeout: Function, now: () => number}} options.timers
   */
  constructor({ getValue, setValue, remote, timers }) {
    this.getValue = getValue;
    this.setValue = setValue;
    this.remote = remote;
    this.timers = timers;
    this.pending = new Set();
    this.pushTimer = null;
    this.remoteFailed = false;
    this.syncing = false;
  }

  get remoteActive() {
    return Boolean(this.remote?.enabled) && !this.remoteFailed;
  }

  /**
   * Read the watch map from GM storage. Unreadable or wrong-shaped values load as {}.
   * @returns {object} WatchMap
   */
  load() {
    let parsed;
    try {
      parsed = JSON.parse(this.getValue(WATCHES_GM_KEY, '{}'));
    } catch {
      return {};
    }
    if (!isPlainObject(parsed) || parsed.version !== STORAGE_VERSION) return {};
    if (!isPlainObject(parsed.watches)) return {};
    const watches = {};
    for (const [id, record] of Object.entries(parsed.watches)) {
      if (isPlainObject(record)) watches[id] = record;
    }
    return watches;
  }

  /** Re-read GM storage, merge `map` into it, prune and write it back. */
  writeMerged(map) {
    const stored = this.load();
    const merged = pruneWatches(mergeWatchMaps(stored, map), this.timers.now());
    this.setValue(WATCHES_GM_KEY, JSON.stringify({ version: STORAGE_VERSION, watches: merged }));
    return { stored, merged };
  }

  /**
   * Merge a watch map into what is stored (another tab may have written since we read),
   * write it and queue the changed records for a debounced remote push.
   * @param {object} map WatchMap
   * @returns {object} the merged WatchMap
   */
  save(map) {
    const { stored, merged } = this.writeMerged(map);
    if (this.remoteActive) {
      for (const id of changedIds(stored, merged)) {
        // An id pruned away locally has nothing to push; the remote cleanup handles it
        if (merged[id]) this.pending.add(id);
      }
      if (this.pending.size > 0) this.schedulePush();
    }
    return merged;
  }

  schedulePush() {
    if (this.pushTimer != null) this.timers.clearTimeout(this.pushTimer);
    this.pushTimer = this.timers.setTimeout(() => {
      this.pushTimer = null;
      return this.pushPending();
    }, REMOTE_PUSH_DELAY_MS);
  }

  /**
   * Upsert records in chunks of UPSERT_CHUNK_SIZE, one exec each, so one bad record can only
   * fail its own chunk.
   * @returns {Promise<string[]>} the ids of the chunks that failed
   */
  async upsertInChunks(records) {
    const { statements, skipped } = buildWatchUpsertStatements(records);
    if (skipped.length > 0) console.warn('[WatchStore] Skipped invalid watch records:', skipped);
    const skippedSet = new Set(skipped);
    const ids = records.map((r) => r.postId).filter((id) => !skippedSet.has(id));
    const failed = [];
    for (let i = 0; i < statements.length; i += UPSERT_CHUNK_SIZE) {
      const chunkIds = ids.slice(i, i + UPSERT_CHUNK_SIZE);
      try {
        await this.remote.exec(statements.slice(i, i + UPSERT_CHUNK_SIZE).join(' '));
      } catch (error) {
        console.error('[WatchStore] Failed to push watches to remote:', chunkIds, error);
        failed.push(...chunkIds);
      }
    }
    return failed;
  }

  /**
   * Merge the remote table into local storage, push the records the remote copy lacks and
   * delete old remote tombstones. If the remote table can't be loaded, remote pushes stop for
   * the session; a failed push or cleanup only re-queues the ids. Pushes wait until this
   * settles.
   * @returns {Promise<object|null>} the merged WatchMap, or null if remote is off or failed
   */
  async syncRemote() {
    if (!this.remoteActive) return null;
    this.syncing = true;
    let remoteMap;
    try {
      remoteMap = parseWatchRows(await this.remote.queryAll(buildWatchSelectQuery()));
    } catch (error) {
      console.error('[WatchStore] Failed to load watches from remote:', error);
      this.remoteFailed = true;
      this.syncing = false;
      this.pending.clear();
      if (this.pushTimer != null) this.timers.clearTimeout(this.pushTimer);
      this.pushTimer = null;
      return null;
    }
    try {
      const { merged } = this.writeMerged(remoteMap);
      const toPush = [...changedIds(remoteMap, merged)].filter((id) => merged[id]);
      const failed = await this.upsertInChunks(toPush.map((id) => merged[id]));
      for (const id of failed) this.pending.add(id);
      try {
        await this.remote.exec(buildWatchCleanupQuery(this.timers.now()));
      } catch (error) {
        console.error('[WatchStore] Failed to clean up remote watch tombstones:', error);
      }
      return merged;
    } catch (error) {
      console.error('[WatchStore] Failed to merge remote watches into local storage:', error);
      return null;
    } finally {
      this.syncing = false;
      // Saves made while loading (and failed pushes) go out now
      if (this.pending.size > 0) this.schedulePush();
    }
  }

  /**
   * Push the queued records: read their remote rows, merge, upsert the merged records and
   * write them back locally. Ids whose push fails stay queued for the next push. Does nothing
   * while syncRemote is in flight.
   * @returns {Promise<void>}
   */
  async pushPending() {
    if (!this.remoteActive || this.syncing || this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    let merged;
    try {
      const query = buildWatchSelectQuery(ids);
      if (!query) return;
      const remoteMap = parseWatchRows(await this.remote.queryAll(query));
      const local = this.load();
      merged = {};
      for (const id of ids) {
        if (local[id]) merged[id] = mergeWatch(local[id], remoteMap[id]);
      }
      const toPush = [...changedIds(remoteMap, merged)].filter((id) => merged[id]);
      const failed = await this.upsertInChunks(toPush.map((id) => merged[id]));
      for (const id of failed) this.pending.add(id);
    } catch (error) {
      console.error('[WatchStore] Failed to read watches from remote:', error);
      for (const id of ids) this.pending.add(id);
      return;
    }
    this.writeMerged(merged);
  }
}
