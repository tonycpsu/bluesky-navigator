// Polls watched threads for new replies, one thread at a time, politely.
import { THREAD_DEPTH, classifyThread, collectReplies, isNotFoundError } from './replyTree.js';

export const DEFAULT_INTERVAL_MS = 180000;
export const CHECK_GAP_MS = 2000;
export const MIN_ROUND_SPACING_MS = 60000;

/** A usable poll interval: a finite number of at least 60 s, else the default. */
function validIntervalMs(ms) {
  return Number.isFinite(ms) && ms >= MIN_ROUND_SPACING_MS ? ms : DEFAULT_INTERVAL_MS;
}

const REAL_TIMERS = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  now: () => Date.now(),
};

const REAL_VISIBILITY = {
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  onChange: (cb) => {
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
};

export class WatchPoller {
  constructor({
    api,
    getWatches,
    resolveUri,
    onResult,
    onRoundDone,
    intervalMs = DEFAULT_INTERVAL_MS,
    timers = REAL_TIMERS,
    visibility = REAL_VISIBILITY,
  }) {
    this.api = api;
    this.getWatches = getWatches;
    this.resolveUri = resolveUri;
    this.onResult = onResult;
    this.onRoundDone = onRoundDone;
    this.intervalMs = validIntervalMs(intervalMs);
    this.timers = timers;
    this.visibility = visibility;
    this.started = false;
    this.running = false;
    this.timerId = null;
    this.unsubscribe = null;
    this.stopRequested = false;
    this.sleeper = null;
    this.lastRoundStartedAt = -Infinity;
  }

  start() {
    if (!this.api || this.started) return;
    this.started = true;
    this.stopRequested = false;
    this.unsubscribe = this.visibility.onChange(() => this._onVisibilityChange());
    this._tick();
  }

  stop() {
    this.started = false;
    this.stopRequested = true;
    this._clearTimer();
    if (this.sleeper) {
      this.timers.clearTimeout(this.sleeper.id);
      this.sleeper.resolve();
      this.sleeper = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  setIntervalMs(ms) {
    this.intervalMs = validIntervalMs(ms);
    if (this.started && !this.visibility.isHidden()) this._schedule();
  }

  async runRound() {
    if (this.visibility.isHidden()) return { checked: 0, skipped: 'hidden' };
    if (this.running) return { checked: 0, skipped: 'busy' };
    if (this.api.isRateLimited()) return { checked: 0, skipped: 'rateLimited' };
    this.running = true;
    try {
      if (!(await this._ensureLogin())) return { checked: 0, skipped: 'login' };
      this.lastRoundStartedAt = this.timers.now();
      let checked = 0;
      try {
        const watches = this.getWatches().filter((w) => !w.unavailable);
        for (let i = 0; i < watches.length; i++) {
          if (this.stopRequested || this.visibility.isHidden() || this.api.isRateLimited()) break;
          const outcome = await this._checkOne(watches[i]);
          if (outcome === 'stop') break;
          if (outcome === 'done') checked++;
          if (i < watches.length - 1) await this._sleep(CHECK_GAP_MS);
          if (this.stopRequested) break;
        }
      } catch (error) {
        console.warn('Watch round failed:', error);
      }
      try {
        this.onRoundDone?.();
      } catch (error) {
        console.warn('Watch onRoundDone failed:', error);
      }
      return { checked };
    } finally {
      this.running = false;
    }
  }

  async checkNow(postId) {
    const record = this.getWatches().find((w) => w.postId === postId);
    if (!record) return;
    if (this.api.isRateLimited()) return;
    if (!(await this._ensureLogin())) return;
    await this._checkOne(record);
  }

  async _ensureLogin() {
    if (this.api.agent?.session) return true;
    try {
      await this.api.login();
    } catch (error) {
      console.warn('Watch login failed:', error);
      return false;
    }
    return !!this.api.agent?.session;
  }

  /** @returns {Promise<'done' | 'skip' | 'stop'>} */
  async _checkOne(record) {
    let result;
    try {
      const uri = await this.resolveUri(record);
      if (!uri) return 'skip';
      const thread = await this.api.getThread(uri, { depth: THREAD_DEPTH, parentHeight: 0 });
      const status = classifyThread(thread);
      result = status === 'ok' ? { status, replies: collectReplies(thread) } : { status };
    } catch (error) {
      if (error?.status === 429 || error?.isRateLimitCooldown) return 'stop';
      if (!isNotFoundError(error)) {
        console.warn('Watch check failed:', record.postId, error);
        return 'skip';
      }
      result = { status: 'notFound' };
    }
    // Outside the fetch try, so a throwing callback is never mistaken for a fetch error
    try {
      this.onResult(record.postId, result);
    } catch (error) {
      console.warn('Watch onResult failed:', record.postId, error);
    }
    return 'done';
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const done = () => {
        this.sleeper = null;
        resolve();
      };
      this.sleeper = { id: this.timers.setTimeout(done, ms), resolve: done };
    });
  }

  _clearTimer() {
    if (this.timerId !== null) {
      this.timers.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  _schedule() {
    this._clearTimer();
    this.timerId = this.timers.setTimeout(() => {
      this.timerId = null;
      this._tick();
    }, this.intervalMs);
  }

  async _tick() {
    let skipped;
    try {
      ({ skipped } = await this.runRound());
    } catch (error) {
      console.warn('Watch round failed:', error);
    }
    // Hidden tabs wait for the visibility change instead of polling
    if (this.started && skipped !== 'hidden') this._schedule();
  }

  _onVisibilityChange() {
    if (!this.started) return;
    if (this.visibility.isHidden()) {
      this._clearTimer();
    } else if (this.timers.now() - this.lastRoundStartedAt >= MIN_ROUND_SPACING_MS) {
      this._clearTimer();
      this._tick();
    } else {
      this._schedule();
    }
  }
}
