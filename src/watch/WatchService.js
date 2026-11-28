// The app-wide watch service: ties the store, poller, record logic and toast planning
// together. It never touches `window` or `document`; main.js passes in the browser glue.

import { atUriForWatch } from './replyTree.js';
import {
  createWatch,
  applyCheck,
  markUnavailable,
  markWatchSeen,
  removeWatch,
  canAddWatch,
  isLive,
  liveWatches,
  sortForList,
  unseenTotal,
  unseenCountFor,
  mergeWatchMaps,
} from './watchRecords.js';
import { planRoundToasts } from './watchCopy.js';
import { WatchPoller, DEFAULT_INTERVAL_MS } from './WatchPoller.js';

/** Dispatched on `document` whenever the watch map changes. */
export const WATCH_CHANGED_EVENT = 'bsky-nav-watch-changed';
/** Dispatched on `document` to open the Watched tab. */
export const OPEN_WATCHED_TAB_EVENT = 'bsky-nav-open-watched-tab';

/** Real timers, built only when a poller is created without injected ones. */
function defaultTimers() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now(),
  };
}

/** Page visibility, built only when a poller is created without an injected one. */
function defaultVisibility() {
  return {
    isHidden: () => document.visibilityState === 'hidden',
    onChange: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  };
}

export class WatchService {
  constructor() {
    this.store = null;
    this.api = undefined;
    this.enabled = false;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.showToasts = () => {};
    this.selfDid = () => null;
    this.notify = () => {};
    this.createPoller = (opts) => new WatchPoller(opts);
    this.now = () => Date.now();
    this.timers = undefined;
    this.visibility = undefined;
    this.map = {};
    this.poller = null;
    this.roundResults = [];
    this.checkingNow = new Set();
    this.stopVisibility = null;
  }

  /**
   * Load the watch map and, when enabled with an API, start polling.
   * @param {object} options
   * @param {object} options.store WatchStore
   * @param {object} [options.api] BlueskyAPI, or undefined without the app-password login
   * @param {boolean} options.enabled
   * @param {number} [options.intervalMs]
   * @param {(toasts: object[]) => void} [options.showToasts]
   * @param {() => string|null} [options.selfDid]
   * @param {() => void} [options.notify] dispatches WATCH_CHANGED_EVENT
   * @param {(opts: object) => object} [options.createPoller] defaults to `new WatchPoller`
   * @param {() => number} [options.now]
   * @param {object} [options.timers] for the default poller; real timers when omitted
   * @param {object} [options.visibility] for the default poller; page visibility when omitted
   */
  init({
    store,
    api,
    enabled,
    intervalMs,
    showToasts,
    selfDid,
    notify,
    createPoller,
    now,
    timers,
    visibility,
  }) {
    this.store = store;
    this.api = api;
    this.enabled = Boolean(enabled);
    if (intervalMs) this.intervalMs = intervalMs;
    if (showToasts) this.showToasts = showToasts;
    if (selfDid) this.selfDid = selfDid;
    if (notify) this.notify = notify;
    if (createPoller) this.createPoller = createPoller;
    if (now) this.now = now;
    this.timers = timers;
    this.visibility = visibility;
    this.map = store.load();
    this._watchVisibility();
    if (this.enabled) this._ensurePoller()?.start();
  }

  // Queries

  isEnabled() {
    return this.enabled;
  }

  hasApi() {
    return Boolean(this.api);
  }

  isWatched(postId) {
    return isLive(this.map[postId]);
  }

  getWatch(postId) {
    return this.map[postId];
  }

  getWatches() {
    return sortForList(this.map);
  }

  unseenTotal() {
    return unseenTotal(this.map);
  }

  unseenCountFor(postId) {
    return unseenCountFor(this.map, postId);
  }

  // Actions

  /**
   * Start watching a post and take its baseline right away.
   * @param {object} info WatchInfo
   * @returns {{ok: true} | {ok: false, reason: 'limit' | 'disabled'}}
   */
  watch(info) {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    // Another tab may have added watches since we loaded, so check the limit against storage
    this.map = mergeWatchMaps(this.store.load(), this.map);
    if (this.isWatched(info.postId)) return { ok: true };
    if (!canAddWatch(this.map)) return { ok: false, reason: 'limit' };
    // A tombstone wins a merge when removedAt >= watchedAt, so a re-watch in the same
    // millisecond as the unwatch starts strictly after the removal
    const removedMs = Date.parse(this.map[info.postId]?.removedAt ?? '');
    const watchedMs = isNaN(removedMs) ? this.now() : Math.max(this.now(), removedMs + 1);
    this.map = {
      ...this.map,
      [info.postId]: createWatch(info, new Date(watchedMs).toISOString()),
    };
    this._commit();
    // Defensive: if the merged save still dropped it (e.g. pruned past the limit), say so
    if (!this.isWatched(info.postId)) return { ok: false, reason: 'limit' };
    this._checkNow(info.postId);
    return { ok: true };
  }

  /** Stop watching a post (leaves a tombstone so the removal syncs). */
  unwatch(postId) {
    this._refresh();
    const record = this.map[postId];
    if (!isLive(record)) return;
    this.map = { ...this.map, [postId]: removeWatch(record, this._nowIso()) };
    this._commit();
  }

  /**
   * Watch the post if it isn't watched, else stop watching it.
   * @param {object} info WatchInfo
   * @returns {{ok: boolean, watched: boolean, reason?: string}}
   */
  toggle(info) {
    if (this.isWatched(info.postId)) {
      this.unwatch(info.postId);
      return { ok: true, watched: false };
    }
    const { ok, reason } = this.watch(info);
    return { ok, watched: ok, reason };
  }

  /** Mark every unseen reply of a watch as seen. */
  markSeen(postId) {
    // A stale copy may show nothing unseen while storage has replies another tab found
    this._refresh();
    const record = this.map[postId];
    if (!isLive(record) || !(record.unseen || []).length) return;
    this.map = { ...this.map, [postId]: markWatchSeen(record, this._nowIso()) };
    this._commit();
  }

  /** Apply settings: stop polling when disabled, else (re)start with the new interval. */
  applyConfig({ enabled, intervalMs }) {
    this.enabled = Boolean(enabled);
    if (intervalMs) this.intervalMs = intervalMs;
    if (!this.enabled) {
      this.poller?.stop();
      this.roundResults = [];
      return;
    }
    const poller = this._ensurePoller();
    if (!poller) return;
    poller.setIntervalMs(this.intervalMs);
    poller.start();
  }

  /**
   * The poller's onResult: apply one check result and save it. New replies of an already
   * baselined watch are toasted when the round ends. A result that changes nothing is not
   * saved, so a quiet round doesn't rewrite storage or redraw the UI.
   * @param {string} postId
   * @param {{status: string, replies?: object[]}} result
   */
  handleResult(postId, result) {
    // Judge against storage, not this tab's copy: another tab may have found (and the
    // owner seen) these replies already, or stopped watching the thread
    this._refresh();
    const record = this.map[postId];
    if (!isLive(record)) return;
    const nowIso = this._nowIso();
    if (result.status === 'notFound' || result.status === 'blocked') {
      if (record.unavailable) return;
      this.map = { ...this.map, [postId]: markUnavailable(record, nowIso) };
      this._commit();
      return;
    }
    if (result.status !== 'ok') return;
    const wasBaselined = record.baselined;
    const checked = applyCheck(record, result.replies || [], {
      nowIso,
      selfDid: this.selfDid(),
    });
    const unchanged =
      wasBaselined &&
      checked.newReplies.length === 0 &&
      checked.record.updatedAt === record.updatedAt;
    if (unchanged) return;
    this.map = { ...this.map, [postId]: checked.record };
    this._commit();
    if (wasBaselined && checked.newReplies.length > 0 && !this.checkingNow.has(postId)) {
      this.roundResults.push(checked);
    }
  }

  /** The poller's onRoundDone: show this round's toasts once, then clear them. */
  handleRoundDone() {
    let results = this.roundResults;
    this.roundResults = [];
    // A round cut short by disabling still calls onRoundDone; show nothing then
    if (!this.enabled || results.length === 0) return;
    // Another tab may have stopped watching one of these threads during the round
    this._refresh();
    results = results.filter((r) => isLive(this.map[r.record.postId]));
    const toasts = planRoundToasts(results, this.now());
    if (toasts.length > 0) this.showToasts(toasts);
  }

  /** Merge the remote watch table into local storage and adopt the result. */
  async startSync() {
    const merged = await this.store.syncRemote();
    if (merged) {
      // `merged` was taken before the remote push; keep anything committed since
      this.map = mergeWatchMaps(merged, this.store.load());
      this.notify();
    }
  }

  /**
   * The at:// URI to poll for a watch, resolving the author's handle when the DID is unknown.
   * @param {object} record WatchRecord
   * @returns {Promise<string|null>}
   */
  async resolveUri(record) {
    const known = atUriForWatch(record);
    if (known) return known;
    if (!record.authorHandle || !this.api) return null;
    const did = await this.api.resolveHandleToDid(record.authorHandle);
    if (!did) return null;
    const uri = atUriForWatch({ ...record, authorDid: did });
    const current = this.map[record.postId];
    if (isLive(current)) {
      this.map = {
        ...this.map,
        [record.postId]: {
          ...current,
          uri,
          authorDid: current.authorDid ?? did,
          updatedAt: this._nowIso(),
        },
      };
      this._commit();
    }
    return uri;
  }

  // Internals

  _nowIso() {
    return new Date(this.now()).toISOString();
  }

  _commit() {
    this.map = this.store.save(this.map);
    this.notify();
  }

  /** Pick up what other tabs saved since this tab last read storage. */
  _refresh() {
    this.map = mergeWatchMaps(this.store.load(), this.map);
  }

  /**
   * Reload from storage when the page becomes visible, so the badge, the Watched tab and
   * the feed are current before the poller's catch-up round. Subscribes once.
   */
  _watchVisibility() {
    if (this.stopVisibility) return;
    const visibility =
      this.visibility ?? (typeof document === 'undefined' ? null : defaultVisibility());
    if (!visibility) return;
    this.stopVisibility = visibility.onChange(() => {
      if (visibility.isHidden() || !this.store) return;
      this._refresh();
      this.notify();
    });
  }

  /** Create the poller if there is an API to poll with; returns it or null. */
  _ensurePoller() {
    if (this.poller || !this.api) return this.poller;
    this.poller = this.createPoller({
      api: this.api,
      getWatches: () => liveWatches(this.map),
      resolveUri: (record) => this.resolveUri(record),
      onResult: (postId, result) => this.handleResult(postId, result),
      onRoundDone: () => this.handleRoundDone(),
      intervalMs: this.intervalMs,
      timers: this.timers ?? defaultTimers(),
      visibility: this.visibility ?? defaultVisibility(),
    });
    return this.poller;
  }

  /** Check one watch outside a round; its result never toasts. */
  _checkNow(postId) {
    if (!this.poller || !this.api) return;
    this.checkingNow.add(postId);
    Promise.resolve(this.poller.checkNow(postId))
      .catch((error) => console.warn('Watch check failed:', postId, error))
      .finally(() => this.checkingNow.delete(postId));
  }
}

/** The app singleton; handlers and components import it. */
export const watchService = new WatchService();
