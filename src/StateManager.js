// StateManager.js
import constants from './constants.js';

const DEFAULT_HISTORY_MAX = 5000;
// Debounce before pushing state to the remote server (config: stateSyncTimeout)
const DEFAULT_SYNC_DELAY = 5000;
// Continuous activity (e.g. j/k navigation) keeps resetting the debounce; never defer
// a pending remote sync longer than this
const MAX_SYNC_WAIT = 30000;
// Per-request timeout for remote queries, so a hung server can't block script init
const REMOTE_REQUEST_TIMEOUT = 10000;
// How long "marked unread" tombstones are kept (locally and remotely)
const SEEN_TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;

// AT Proto record keys; anything else is rejected before it reaches a SurrealQL string
const POST_ID_RE = /^[A-Za-z0-9._:~-]{1,512}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isValidPostId(postId) {
  return typeof postId === 'string' && POST_ID_RE.test(postId);
}

export function isValidTimestamp(timestamp) {
  return (
    typeof timestamp === 'string' &&
    ISO_TIMESTAMP_RE.test(timestamp) &&
    !isNaN(Date.parse(timestamp))
  );
}

function timeOf(timestamp) {
  const t = timestamp ? Date.parse(timestamp) : NaN;
  return isNaN(t) ? 0 : t;
}

/**
 * Record id for a post's remote seen entry. Same as earlier versions except `-` is also
 * mapped to `_`: SurrealQL parses `seen:a-b` as subtraction (a parse error that failed the
 * whole batch), so no record with `-` in its id can exist from earlier versions.
 */
export function seenRecordId(postId) {
  return `seen:${postId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/**
 * Returns a Map of postId -> timestamp (new/changed) or null (removed) between two seen maps.
 */
export function diffSeen(oldSeen, newSeen) {
  const changes = new Map();
  for (const [postId, timestamp] of Object.entries(newSeen)) {
    if (oldSeen[postId] !== timestamp) {
      changes.set(postId, timestamp);
    }
  }
  for (const postId of Object.keys(oldSeen)) {
    if (!(postId in newSeen)) {
      changes.set(postId, null);
    }
  }
  return changes;
}

/**
 * Merges local and remote seen state. For each post the newest event wins: a read mark
 * (seen) or an unread mark (seenRemoved tombstone). Ties go to the read mark.
 * Returns the merged maps plus `dirty`: entries where local wins and remote must be updated
 * (postId -> timestamp, or null to push a tombstone).
 */
export function mergeSeen(localSeen, localRemoved, remoteSeen, remoteRemoved) {
  localSeen = localSeen || {};
  localRemoved = localRemoved || {};
  remoteSeen = remoteSeen || {};
  remoteRemoved = remoteRemoved || {};
  const seen = {};
  const seenRemoved = {};
  const dirty = new Map();
  const postIds = new Set([
    ...Object.keys(localSeen),
    ...Object.keys(localRemoved),
    ...Object.keys(remoteSeen),
    ...Object.keys(remoteRemoved),
  ]);

  for (const postId of postIds) {
    const candidates = [
      { local: true, read: true, ts: localSeen[postId] },
      { local: false, read: true, ts: remoteSeen[postId] },
      { local: true, read: false, ts: localRemoved[postId] },
      { local: false, read: false, ts: remoteRemoved[postId] },
    ].filter((c) => c.ts);
    // Stable sort: newest first; among equal times the read marks (listed first) win
    candidates.sort((a, b) => timeOf(b.ts) - timeOf(a.ts));
    const winner = candidates[0];

    if (winner.read) {
      seen[postId] = winner.ts;
      if (winner.local && remoteSeen[postId] !== winner.ts) {
        dirty.set(postId, winner.ts);
      }
    } else {
      seenRemoved[postId] = winner.ts;
      // Only push a tombstone if remote still has this post marked read
      if (winner.local && remoteSeen[postId]) {
        dirty.set(postId, null);
      }
    }
  }
  return { seen, seenRemoved, dirty };
}

/**
 * Builds SurrealQL statements for dirty seen entries. Read marks are upserted with their
 * timestamp; unread marks become tombstones (timestamp removed, `removed` set) so other
 * devices don't resurrect them. Older clients ignore records without a timestamp.
 * Entries with an invalid postId/timestamp are skipped.
 */
export function buildSeenStatements(entries, seenRemoved = {}) {
  const statements = [];
  let upserts = 0;
  let tombstones = 0;
  const skipped = [];
  for (const [postId, timestamp] of entries) {
    if (!isValidPostId(postId)) {
      skipped.push(postId);
      continue;
    }
    const recordId = seenRecordId(postId);
    if (timestamp != null) {
      if (!isValidTimestamp(timestamp)) {
        skipped.push(postId);
        continue;
      }
      statements.push(
        `UPSERT ${recordId} SET postId = "${postId}", timestamp = "${timestamp}", removed = NONE, updated_at = time::now();`
      );
      upserts++;
    } else {
      const removedAt = seenRemoved[postId];
      if (isValidTimestamp(removedAt)) {
        statements.push(
          `UPSERT ${recordId} SET postId = "${postId}", timestamp = NONE, removed = "${removedAt}", updated_at = time::now();`
        );
      } else {
        statements.push(`DELETE ${recordId};`);
      }
      tombstones++;
    }
  }
  return { statements, upserts, tombstones, skipped };
}

/**
 * Builds the state:current upsert. The WHERE makes the write a no-op if the remote copy
 * is newer than ours (a missing record is created regardless).
 * Returns null if `since` isn't a valid timestamp.
 */
export function buildStateUpsertQuery(stateJson, since) {
  if (!isValidTimestamp(since)) {
    return null;
  }
  return `UPSERT state:current CONTENT ${stateJson} WHERE lastUpdated == NONE OR lastUpdated == NULL OR lastUpdated <= "${since}";`;
}

/**
 * Fields uploaded to state:current: excludes the device/session-only filter, seen data
 * (synced per-record in the seen table) and non-serializable objects.
 */
export function remoteStateFields(state) {
  // eslint-disable-next-line no-unused-vars
  const { filter, seen, seenRemoved, listCache, rules, ...stateToSync } = state;
  return stateToSync;
}

export class StateManager {
  constructor(key, _defaultState = {}, config = {}) {
    this.key = key;
    this.config = config;
    if (!this.config) {
      console.warn('StateManager: config is undefined');
    }
    this.listeners = [];
    this.debounceTimeout = null;
    this.maxEntries = this.config.maxEntries || DEFAULT_HISTORY_MAX;
    const syncDelay = Number(this.config.stateSyncTimeout);
    this.syncDelay =
      this.config.stateSyncTimeout != null && syncDelay >= 0 ? syncDelay : DEFAULT_SYNC_DELAY;
    this.remoteSyncFirstScheduledAt = null; // When the currently pending remote sync was first requested
    this.remoteStateLoadFailed = false; // Remote state couldn't be loaded at init; don't overwrite it
    this.state = {};
    this.isLocalStateDirty = false; // Tracks whether local state has changed
    this.isRemoteSyncPending = false; // Tracks whether remote sync is needed
    this.localSaveTimeout = null; // Timer for local state save
    this.remoteSyncTimeout = null; // Timer for remote state sync
    this.dirtySeenEntries = new Map(); // Tracks seen entries that need to be synced to remote
    this.lastSeenSnapshot = null; // Snapshot of seen object to detect changes
    this.seenSyncCount = 0; // Counter for periodic cleanup
    this.handleBlockListResponse = this.handleBlockListResponse.bind(this);
    this.saveStateImmediately = this.saveStateImmediately.bind(this);
    this.saveRemoteStateSync = this.saveRemoteStateSync.bind(this);

    // Save state on beforeunload - local is synchronous, remote uses keepalive fetch
    window.addEventListener('beforeunload', () => {
      this.saveStateImmediately();
      // Also save remote if there's pending sync (must happen after local save)
      if (this.config.stateSyncEnabled && this.isRemoteSyncPending) {
        this.saveRemoteStateSync();
      }
    });

    // Save remote state when page becomes hidden (more reliable for async)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.config.stateSyncEnabled && this.isRemoteSyncPending) {
        this.saveRemoteStateSync();
      }
    });

    // Fallback: attempt keepalive fetch on pagehide
    window.addEventListener('pagehide', () => {
      if (this.config.stateSyncEnabled && this.isRemoteSyncPending) {
        this.saveRemoteStateSync();
      }
    });
  }

  static async create(key, defaultState = {}, config = {}) {
    const instance = new StateManager(key, defaultState, config);
    await instance.initializeState(defaultState);
    return instance;
  }

  async initializeState(defaultState) {
    this.state = await this.loadState(defaultState);
    // Baseline for diffing seen changes, so only real changes are synced to remote
    this.lastSeenSnapshot = { ...(this.state.seen || {}) };
    this.ensureBlockState();
    this.updateBlockList();
    // Push local entries that won the merge (e.g. marks not synced last session)
    if (this.dirtySeenEntries.size > 0) {
      this.isRemoteSyncPending = true;
      this.scheduleRemoteSync();
    }
  }

  ensureBlockState() {
    if (!this.state.blocks) {
      this.state.blocks = {
        all: { updated: null, dids: [] },
        recent: { updated: null, dids: [] },
      };
    }
    // Migrate old handles format to dids
    if (this.state.blocks.all && 'handles' in this.state.blocks.all) {
      this.state.blocks.all.dids = [];
      delete this.state.blocks.all.handles;
    }
    if (this.state.blocks.recent && 'handles' in this.state.blocks.recent) {
      this.state.blocks.recent.dids = [];
      delete this.state.blocks.recent.handles;
    }
  }

  setSyncStatus(status, title) {
    const overlay = $('.preferences-icon-overlay');
    if (!overlay) {
      return;
    }
    $(overlay).attr('title', `sync: ${status} ${title || ''}`);
    for (const s of ['ready', 'pending', 'success', 'failure']) {
      $(overlay).removeClass(`preferences-icon-overlay-sync-${s}`);
    }

    $(overlay).addClass(`preferences-icon-overlay-sync-${status}`);
    if (status == 'success') {
      setTimeout(() => this.setSyncStatus('ready'), 3000);
    }
  }

  /**
   * Posts a query to the remote /sql endpoint and resolves with the parsed per-statement
   * results (index 0 is the USE statement). Rejects on HTTP errors, network errors,
   * timeouts, or any statement reporting an error.
   * @param {string} query - The query string to execute.
   * @param {string} successStatus - The status to set on successful execution (e.g., "success").
   * @returns {Promise<Array>}
   */
  postRemoteQuery(query, successStatus = 'success') {
    const {
      url,
      namespace = 'bluesky_navigator',
      database = 'state',
      username,
      password,
    } = JSON.parse(this.config.stateSyncConfig);

    return new Promise((resolve, reject) => {
      const fail = (message) => {
        console.error('Error executing query:', message);
        this.setSyncStatus('failure', message);
        reject(new Error(message));
      };
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${url.replace(/\/$/, '')}/sql`,
        headers: {
          Accept: 'application/json',
          Authorization: 'Basic ' + btoa(`${username}:${password}`),
        },
        data: `USE NS ${namespace} DB ${database}; ${query}`,
        timeout: REMOTE_REQUEST_TIMEOUT,
        onload: (response) => {
          let results;
          try {
            if (response.status !== 200) {
              let detail = '';
              try {
                detail = JSON.parse(response.responseText)?.information || '';
              } catch {
                // non-JSON error body
              }
              throw new Error(
                `${response.statusText || `HTTP ${response.status}`}${detail ? `: ${detail}` : ''}`
              );
            }
            results = JSON.parse(response.responseText);
            const failed = Array.isArray(results) && results.find((r) => r?.status === 'ERR');
            if (failed) {
              throw new Error(String(failed.result));
            }
          } catch (error) {
            fail(error.message);
            return;
          }
          this.setSyncStatus(successStatus);
          resolve(results);
        },
        onerror: (error) => fail(`network error ${error?.error || error?.statusText || ''}`),
        ontimeout: () => fail(`timed out after ${REMOTE_REQUEST_TIMEOUT}ms`),
      });
    });
  }

  /**
   * Executes a query against the remote database.
   * @returns {Promise<Object>} - Resolves with the first row of the first query statement.
   */
  async executeRemoteQuery(query, successStatus = 'success') {
    const results = await this.postRemoteQuery(query, successStatus);
    return results?.[1]?.result?.[0];
  }

  /**
   * Executes a query and returns ALL rows of the first query statement.
   * @returns {Promise<Array>}
   */
  async executeRemoteQueryAll(query, successStatus = 'success') {
    const results = await this.postRemoteQuery(query, successStatus);
    return results?.[1]?.result || [];
  }

  /**
   * Returns the remote state's lastUpdated, or null if state:current doesn't exist yet.
   */
  async getRemoteStateUpdated() {
    const sinceResult = await this.executeRemoteQuery(`SELECT lastUpdated FROM state:current;`);
    return sinceResult?.lastUpdated ?? null;
  }

  /**
   * Loads state from storage or initializes with the default state.
   * Compares local and remote timestamps to use whichever is newer; seen entries are
   * merged per post (see mergeSeen). Falls back to local state if remote can't be loaded.
   */
  async loadState(defaultState) {
    try {
      const savedState = JSON.parse(GM_getValue(this.key, '{}'));
      const localLastUpdated = savedState.lastUpdated;

      if (!this.config.stateSyncEnabled) {
        return { ...defaultState, ...savedState };
      }

      const remoteState = await this.loadRemoteState();
      if (!remoteState) {
        // Remote unreachable: run on local state, and don't let this session's writes
        // overwrite remote state we haven't seen
        this.remoteStateLoadFailed = true;
        return { ...defaultState, ...savedState };
      }

      // Merge seen entries from both local and remote to prevent data loss: local may have
      // entries not yet synced to remote, remote may have entries from other sessions
      const merged = mergeSeen(
        savedState.seen,
        savedState.seenRemoved,
        remoteState.seen,
        remoteState.seenRemoved
      );
      for (const [postId, timestamp] of merged.dirty) {
        this.dirtySeenEntries.set(postId, timestamp);
      }

      // Compare timestamps - use whichever is newer for the rest of the state
      const localTime = localLastUpdated ? new Date(localLastUpdated).getTime() : 0;
      const remoteTime = remoteState.lastUpdated ? new Date(remoteState.lastUpdated).getTime() : 0;

      if (localTime > remoteTime) {
        return {
          ...defaultState,
          ...savedState,
          seen: merged.seen,
          seenRemoved: merged.seenRemoved,
        };
      }

      // Preserve filter from local state - it's session/device-specific. Everything else
      // in state:current (including timeouts) is last-writer-wins, so clearing a timeout
      // on one device isn't undone by another device's stale copy.
      // eslint-disable-next-line no-unused-vars
      const { filter, seen, seenRemoved, ...remoteRest } = remoteState;
      return {
        ...defaultState,
        ...remoteRest,
        filter: savedState.filter || defaultState.filter || '',
        timeouts: remoteRest.timeouts || savedState.timeouts || defaultState.timeouts || {},
        seen: merged.seen,
        seenRemoved: merged.seenRemoved,
      };
    } catch (error) {
      console.error('Error loading state, using defaults:', error);
      return defaultState;
    }
  }

  async loadRemoteState() {
    try {
      this.setSyncStatus('pending');
      const result = await this.executeRemoteQuery('SELECT * FROM state:current;');
      const stateObj = result || {};
      delete stateObj.id;

      // Load seen entries (and unread tombstones) from separate table
      const seenRecords = await this.executeRemoteQueryAll(
        'SELECT postId, timestamp, removed FROM seen;'
      );
      if (seenRecords && seenRecords.length > 0) {
        stateObj.seen = {};
        stateObj.seenRemoved = {};
        for (const record of seenRecords) {
          if (!record.postId) {
            continue;
          }
          if (record.timestamp) {
            stateObj.seen[record.postId] = record.timestamp;
          } else if (record.removed) {
            stateObj.seenRemoved[record.postId] = record.removed;
          }
        }
      }

      const stateSize = (JSON.stringify(stateObj).length / 1024).toFixed(2);
      const seenSize = stateObj.seen
        ? (JSON.stringify(stateObj.seen).length / 1024).toFixed(2)
        : '0';
      console.log(
        `[StateManager] Loaded remote state: ${stateSize} KB total, ${seenSize} KB seen (${seenRecords?.length || 0} entries)`
      );

      return stateObj;
    } catch (error) {
      console.error('Failed to load remote state:', error);
      return null;
    }
  }

  /**
   * Updates the state and schedules a chained local and remote save.
   */
  updateState(newState) {
    // Track dirty seen entries for efficient remote sync
    if (newState.seen && this.config.stateSyncEnabled) {
      const changes = diffSeen(this.lastSeenSnapshot || {}, newState.seen);
      if (changes.size > 0) {
        const now = new Date().toISOString();
        const seenRemoved = { ...(this.state.seenRemoved || {}) };
        for (const [postId, timestamp] of changes) {
          this.dirtySeenEntries.set(postId, timestamp);
          if (timestamp == null) {
            // Marked unread: record a tombstone so the removal wins over older read marks
            seenRemoved[postId] = now;
          } else {
            delete seenRemoved[postId];
          }
        }
        newState = { ...newState, seenRemoved };
      }
      // Update snapshot for next comparison
      this.lastSeenSnapshot = { ...newState.seen };
    }

    this.state = { ...this.state, ...newState };
    this.state.lastUpdated = new Date().toISOString();
    this.isLocalStateDirty = true; // Mark local state as dirty
    this.isRemoteSyncPending = true; // Mark remote sync as pending
    this.scheduleLocalSave(); // Schedule local save
  }

  /**
   * Schedules a local state save after a 1-second delay.
   * Triggers remote sync only if local state is saved.
   */
  scheduleLocalSave() {
    clearTimeout(this.localSaveTimeout);
    this.localSaveTimeout = setTimeout(() => {
      const shouldSyncRemote = this.isLocalStateDirty; // Capture the current state of the flag
      this.saveLocalState().then(() => {
        if (shouldSyncRemote) {
          // Use the captured flag to decide if remote sync is needed
          this.scheduleRemoteSync();
        }
      });
    }, this.config.stateSaveTimeout); // Save local state after 1 second
  }

  /**
   * Saves the local state and resolves a promise.
   * @returns {Promise<void>}
   */
  async saveLocalState() {
    this.cleanupState(); // Ensure state is pruned before saving
    // Exclude non-serializable fields (objects with circular refs or complex instances)
    const { listCache, rules, ...serializableState } = this.state;
    const stateJson = JSON.stringify(serializableState);
    GM_setValue(this.key, stateJson);
    this.isLocalStateDirty = false; // Reset dirty flag
    this.notifyListeners();
  }

  /**
   * Schedules a remote state synchronization, debounced by stateSyncTimeout (default 5s).
   * Navigation updates (focusedPostId) keep pushing the debounce back, so a pending sync
   * is never deferred more than MAX_SYNC_WAIT.
   */
  scheduleRemoteSync() {
    if (!this.config.stateSyncEnabled) {
      return;
    }

    const now = Date.now();
    if (this.remoteSyncFirstScheduledAt == null) {
      this.remoteSyncFirstScheduledAt = now;
    }
    const deadline = this.remoteSyncFirstScheduledAt + Math.max(MAX_SYNC_WAIT, this.syncDelay);
    const delay = Math.max(0, Math.min(this.syncDelay, deadline - now));

    clearTimeout(this.remoteSyncTimeout);
    this.remoteSyncTimeout = setTimeout(() => {
      this.remoteSyncFirstScheduledAt = null;
      this.saveRemoteState(this.state.lastUpdated);
    }, delay);
  }

  /**
   * Saves the remote state if needed.
   */
  async saveRemoteState(since) {
    try {
      // If remote state couldn't be loaded at init, don't overwrite it with ours
      if (!this.remoteStateLoadFailed) {
        const lastUpdated = await this.getRemoteStateUpdated();
        // A missing record (first run) is created; a newer remote copy is left alone
        if (since && (!lastUpdated || new Date(since) >= new Date(lastUpdated))) {
          this.setSyncStatus('pending');
          const stateToSync = remoteStateFields(this.state);
          stateToSync.created_at = new Date().toISOString();
          const stateJson = JSON.stringify(stateToSync);
          const stateSize = (stateJson.length / 1024).toFixed(2);
          console.log(`[StateManager] Saving remote state: ${stateSize} KB (excluding seen)`);
          // CONTENT (not MERGE) so cleared fields are removed; the WHERE guards against
          // another device having written a newer copy since the check above
          const query = buildStateUpsertQuery(stateJson, since);
          if (query) {
            await this.executeRemoteQuery(query, 'success');
          }
        }
        this.isRemoteSyncPending = false; // Clear pending flag on success
      }

      // Sync dirty seen entries separately (per-record, independent of state:current)
      await this.syncSeenToRemote();
    } catch (error) {
      console.error('Failed to save remote state:', error);
    }
  }

  /**
   * Syncs dirty seen entries to remote as individual records.
   * Each entry is stored as seen:<postId> with timestamp value; entries marked unread
   * are stored as tombstones (see buildSeenStatements).
   */
  async syncSeenToRemote() {
    if (this.dirtySeenEntries.size === 0) {
      return;
    }

    const entries = Array.from(this.dirtySeenEntries.entries());
    this.dirtySeenEntries.clear(); // Clear immediately to avoid re-syncing on failure

    const { statements, upserts, tombstones, skipped } = buildSeenStatements(
      entries,
      this.state.seenRemoved
    );
    if (skipped.length > 0) {
      console.warn(`[StateManager] Skipped ${skipped.length} seen entries with invalid post IDs`);
    }

    if (statements.length === 0) {
      return;
    }

    const query = statements.join(' ');
    const querySize = (query.length / 1024).toFixed(2);

    try {
      await this.executeRemoteQuery(query, 'success');
      console.log(
        `[StateManager] Synced ${upserts} seen, ${tombstones} unseen entries (${querySize} KB)`
      );

      // Trigger cleanup every 10 syncs
      this.seenSyncCount++;
      if (this.seenSyncCount >= 10) {
        this.seenSyncCount = 0;
        this.cleanupRemoteSeenEntries();
      }
    } catch (error) {
      // On failure, add entries back to dirty map for retry (unless changed again since)
      entries.forEach(([postId, timestamp]) => {
        if (!this.dirtySeenEntries.has(postId)) {
          this.dirtySeenEntries.set(postId, timestamp);
        }
      });
      console.error('Failed to sync seen entries:', error);
    }
  }

  /**
   * Cleans up old seen entries from remote storage: keeps the newest maxEntries read marks
   * and drops tombstones older than SEEN_TOMBSTONE_TTL.
   * SurrealQL DELETE has no ORDER BY/LIMIT, so find the cutoff timestamp with a SELECT and
   * delete by WHERE.
   */
  async cleanupRemoteSeenEntries() {
    if (!this.config.stateSyncEnabled) {
      return;
    }

    try {
      const tombstoneCutoff = new Date(Date.now() - SEEN_TOMBSTONE_TTL).toISOString();
      await this.executeRemoteQuery(
        `DELETE seen WHERE timestamp == NONE AND removed != NONE AND removed < "${tombstoneCutoff}";`
      );

      // Get count of remote seen entries
      const countResult = await this.executeRemoteQuery(
        'SELECT count() FROM seen WHERE timestamp != NONE GROUP ALL;'
      );
      const count = countResult?.count || 0;

      if (count <= this.maxEntries) {
        console.log(
          `[StateManager] Remote seen entries: ${count}/${this.maxEntries} (no cleanup needed)`
        );
        return;
      }

      // Timestamp of the newest entry beyond maxEntries; it and everything older goes
      const cutoffRow = await this.executeRemoteQuery(
        `SELECT timestamp FROM seen WHERE timestamp != NONE ORDER BY timestamp DESC LIMIT 1 START ${this.maxEntries};`
      );
      const cutoff = cutoffRow?.timestamp;
      if (!isValidTimestamp(cutoff)) {
        return;
      }
      await this.executeRemoteQuery(
        `DELETE seen WHERE timestamp != NONE AND timestamp <= "${cutoff}";`
      );
      console.log(
        `[StateManager] Remote cleanup: deleted entries at or before ${cutoff} (${count} → ≤${this.maxEntries})`
      );
    } catch (error) {
      console.error('Failed to cleanup remote seen entries:', error);
    }
  }

  /**
   * Immediately saves both local and remote states.
   */
  saveStateImmediately(saveLocal = true, saveRemote = false) {
    if (saveLocal) {
      this.saveLocalState();
    }
    if (this.config.stateSyncEnabled && saveRemote) {
      this.saveRemoteState(this.state.lastUpdated);
    }
  }

  /**
   * Saves remote state using fetch with keepalive for page unload scenarios.
   * This method is designed to be called during visibilitychange/pagehide events
   * where GM_xmlhttpRequest may not complete.
   * Uses the same conditional upsert as saveRemoteState, so it never overwrites a newer
   * remote copy (there's no time to read lastUpdated first).
   */
  saveRemoteStateSync() {
    if (!this.config.stateSyncEnabled || !this.config.stateSyncConfig) {
      return;
    }

    // Clear flag immediately to prevent duplicate saves from multiple event handlers
    this.isRemoteSyncPending = false;

    try {
      const {
        url,
        namespace = 'bluesky_navigator',
        database = 'state',
        username,
        password,
      } = JSON.parse(this.config.stateSyncConfig);

      const sqlUrl = `${url.replace(/\/$/, '')}/sql`;
      const headers = {
        Accept: 'application/json',
        Authorization: 'Basic ' + btoa(`${username}:${password}`),
      };

      const stateToSync = remoteStateFields(this.state);
      stateToSync.created_at = new Date().toISOString();
      const stateJson = JSON.stringify(stateToSync);
      const upsertQuery = buildStateUpsertQuery(stateJson, this.state.lastUpdated);

      if (upsertQuery && !this.remoteStateLoadFailed) {
        const stateSize = (stateJson.length / 1024).toFixed(2);
        console.log(
          `[StateManager] Saving remote state on unload: ${stateSize} KB (excluding seen)`
        );

        // Use fetch with keepalive to ensure request completes during page unload
        fetch(sqlUrl, {
          method: 'POST',
          headers,
          body: `USE NS ${namespace} DB ${database}; ${upsertQuery}`,
          keepalive: true,
        }).catch(() => {});
      }

      // Also sync any dirty seen entries
      if (this.dirtySeenEntries.size > 0) {
        const entries = Array.from(this.dirtySeenEntries.entries());
        this.dirtySeenEntries.clear();

        const { statements, upserts, tombstones } = buildSeenStatements(
          entries,
          this.state.seenRemoved
        );

        if (statements.length > 0) {
          const seenQuery = `USE NS ${namespace} DB ${database}; ${statements.join(' ')}`;
          const seenSize = (statements.join(' ').length / 1024).toFixed(2);
          console.log(
            `[StateManager] Syncing ${upserts} seen, ${tombstones} unseen on unload (${seenSize} KB)`
          );

          fetch(sqlUrl, {
            method: 'POST',
            headers,
            body: seenQuery,
            keepalive: true,
          }).catch(() => {});
        }
      }
    } catch (error) {
      console.error('Error preparing remote state save:', error);
    }
  }

  /**
   * Keeps only the most recent N entries in the state, and drops expired unread tombstones.
   */
  cleanupState() {
    if (this.state.seen) {
      const pruned = this.keepMostRecentValues(this.state.seen, this.maxEntries);
      // Pruning isn't an unread mark: drop pruned posts from the diff baseline too, or the
      // next updateState would sync them as removals
      if (this.lastSeenSnapshot) {
        for (const postId of Object.keys(this.state.seen)) {
          if (!(postId in pruned)) {
            delete this.lastSeenSnapshot[postId];
          }
        }
      }
      this.state.seen = pruned;
    }
    if (this.state.seenRemoved) {
      const cutoff = Date.now() - SEEN_TOMBSTONE_TTL;
      const live = Object.entries(this.state.seenRemoved).filter(([, ts]) => timeOf(ts) >= cutoff);
      this.state.seenRemoved = this.keepMostRecentValues(Object.fromEntries(live), this.maxEntries);
    }
  }

  /**
   * Utility to keep only the most recent N entries in an object.
   * Assumes values are ISO date strings for sorting.
   * @param {Object} obj - The object to prune.
   * @param {number} maxEntries - The maximum number of entries to retain.
   */
  keepMostRecentValues(obj, maxEntries) {
    const entries = Object.entries(obj);

    // Sort the entries by value (date) in descending order
    entries.sort(([, dateA], [, dateB]) => new Date(dateB) - new Date(dateA));

    // Keep only the most recent N entries
    return Object.fromEntries(entries.slice(0, maxEntries));
  }

  /**
   * Resets state to the default value.
   * @param {Object} defaultState - The default state object.
   */
  resetState(defaultState = {}) {
    this.state = defaultState;
  }

  /**
   * Registers a listener for state changes.
   * @param {function} callback - The listener function to invoke on state change.
   */
  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  /**
   * Notifies all registered listeners of a state change.
   */
  notifyListeners() {
    this.listeners.forEach((callback) => callback(this.state));
  }

  handleBlockListResponse(response, responseKey, stateKey) {
    const jsonResponse = $.parseJSON(response.response);

    try {
      this.state.blocks[stateKey].dids = jsonResponse.data[responseKey].map(
        (entry) => entry.did
      );
      this.state.blocks[stateKey].updated = Date.now();
    } catch (_error) {
      console.warn("[Clearsky] couldn't fetch block list");
    }
  }

  updateBlockList() {
    // Skip if Clearsky is disabled
    if (this.config.get && !this.config.get('clearskyEnabled')) return;

    const blockConfig = {
      all: {
        url: 'https://api.clearsky.services/api/v1/anon/lists/fun-facts',
        responseKey: 'blocked',
      },
      recent: {
        url: 'https://api.clearsky.services/api/v1/anon/lists/funer-facts',
        responseKey: 'blocked',
      },
    };

    for (const [stateKey, cfg] of Object.entries(blockConfig)) {
      if (
        this.state.blocks[stateKey].updated == null ||
        Date.now() - this.state.blocks[stateKey].updated > constants.CLEARSKY_LIST_REFRESH_INTERVAL * 1000
      ) {
        GM_xmlhttpRequest({
          method: 'GET',
          url: cfg.url,
          headers: {
            Accept: 'application/json',
          },
          onload: (response) => this.handleBlockListResponse(response, cfg.responseKey, stateKey),
        });
      }
    }
  }
}
