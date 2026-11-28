import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WatchService,
  watchService,
  WATCH_CHANGED_EVENT,
  OPEN_WATCHED_TAB_EVENT,
} from '../../src/watch/WatchService.js';
import { createWatch, liveWatches } from '../../src/watch/watchRecords.js';
import { WatchStore } from '../../src/watch/WatchStore.js';

const NOW_MS = Date.parse('2026-11-27T12:00:00.000Z');
const DID = 'did:plc:alice';

function makeStore(initial = {}) {
  let stored = initial;
  return {
    saves: 0,
    load() {
      return stored;
    },
    save(map) {
      this.saves++;
      stored = map;
      return map;
    },
    async syncRemote() {
      return null;
    },
  };
}

function makePollerFactory() {
  const created = [];
  const factory = (opts) => {
    const poller = {
      opts,
      starts: 0,
      stops: 0,
      intervals: [],
      checks: [],
      start() {
        this.starts++;
      },
      stop() {
        this.stops++;
      },
      setIntervalMs(ms) {
        this.intervals.push(ms);
      },
      checkNow(postId) {
        this.checks.push(postId);
        return Promise.resolve();
      },
    };
    created.push(poller);
    return poller;
  };
  factory.created = created;
  return factory;
}

function info(postId, authorDid = DID) {
  return {
    postId,
    url: `/profile/alice.test/post/${postId}`,
    authorDid,
    authorHandle: 'alice.test',
    snippet: `post ${postId}`,
  };
}

function reply(n, authorDid = 'did:plc:bob') {
  return {
    uri: `at://${authorDid}/app.bsky.feed.post/r${n}`,
    rkey: `r${n}`,
    authorDid,
    authorHandle: 'bob.test',
    authorName: 'Bob',
    authorAvatar: '',
    text: `reply ${n}`,
    indexedAt: new Date(NOW_MS - 60000 + n * 1000).toISOString(),
  };
}

function setup(options = {}) {
  const { initial = {}, enabled = true, selfDid = 'did:plc:me' } = options;
  const api = 'api' in options ? options.api : {};
  const store = makeStore(initial);
  const createPoller = makePollerFactory();
  const toasts = [];
  let notified = 0;
  const service = new WatchService();
  service.init({
    store,
    api,
    enabled,
    intervalMs: 180000,
    showToasts: (t) => toasts.push(t),
    selfDid: () => selfDid,
    notify: () => notified++,
    createPoller,
    now: () => NOW_MS,
  });
  return {
    service,
    store,
    createPoller,
    toasts,
    notifyCount: () => notified,
    poller: () => createPoller.created[0],
  };
}

function baselined(postId) {
  const record = createWatch(info(postId), new Date(NOW_MS - 3600000).toISOString());
  return { ...record, baselined: true };
}

test('exports the event names and the singleton', () => {
  assert.equal(WATCH_CHANGED_EVENT, 'bsky-nav-watch-changed');
  assert.equal(OPEN_WATCHED_TAB_EVENT, 'bsky-nav-open-watched-tab');
  assert.ok(watchService instanceof WatchService);
});

test('watch adds a record, saves, notifies and requests a baseline check', () => {
  const t = setup();
  assert.equal(t.poller().starts, 1);
  const result = t.service.watch(info('p1'));
  assert.deepEqual(result, { ok: true });
  assert.equal(t.service.isWatched('p1'), true);
  assert.equal(t.service.getWatch('p1').uri, `at://${DID}/app.bsky.feed.post/p1`);
  assert.equal(t.store.saves, 1);
  assert.equal(t.notifyCount(), 1);
  assert.deepEqual(t.poller().checks, ['p1']);
  assert.deepEqual(
    t.service.getWatches().map((w) => w.postId),
    ['p1']
  );
});

test('watch on an already-watched post changes nothing', () => {
  const t = setup();
  t.service.watch(info('p1'));
  assert.deepEqual(t.service.watch(info('p1')), { ok: true });
  assert.equal(t.store.saves, 1);
  assert.equal(t.notifyCount(), 1);
});

test('refuses past the limit', () => {
  const initial = {};
  for (let i = 0; i < 50; i++) initial[`p${i}`] = baselined(`p${i}`);
  const t = setup({ initial });
  const result = t.service.watch(info('p51'));
  assert.deepEqual(result, { ok: false, reason: 'limit' });
  assert.equal(t.service.isWatched('p51'), false);
  assert.equal(t.notifyCount(), 0);
  assert.equal(t.store.saves, 0);
});

test('toggle watches, then unwatches (tombstone, isWatched false)', () => {
  const t = setup();
  assert.deepEqual(t.service.toggle(info('p1')), { ok: true, watched: true, reason: undefined });
  assert.equal(t.service.isWatched('p1'), true);
  assert.deepEqual(t.service.toggle(info('p1')), { ok: true, watched: false });
  assert.equal(t.service.isWatched('p1'), false);
  assert.ok(t.service.getWatch('p1').removedAt, 'a tombstone is kept');
  assert.deepEqual(t.service.getWatches(), []);
  assert.equal(t.notifyCount(), 2);
});

test('toggle past the limit reports the refusal', () => {
  const initial = {};
  for (let i = 0; i < 50; i++) initial[`p${i}`] = baselined(`p${i}`);
  const t = setup({ initial });
  assert.deepEqual(t.service.toggle(info('p51')), { ok: false, watched: false, reason: 'limit' });
});

test('disabled service refuses to watch', () => {
  const t = setup({ enabled: false });
  assert.equal(t.service.isEnabled(), false);
  assert.equal(t.createPoller.created.length, 0);
  assert.deepEqual(t.service.watch(info('p1')), { ok: false, reason: 'disabled' });
  assert.equal(t.service.isWatched('p1'), false);
  assert.equal(t.notifyCount(), 0);
});

test('applyConfig stops, then restarts with the new interval (creating the poller lazily)', () => {
  const t = setup({ enabled: false });
  t.service.applyConfig({ enabled: true, intervalMs: 60000 });
  assert.equal(t.service.isEnabled(), true);
  const poller = t.poller();
  assert.deepEqual(poller.intervals, [60000]);
  assert.equal(poller.starts, 1);
  t.service.applyConfig({ enabled: false, intervalMs: 60000 });
  assert.equal(poller.stops, 1);
  assert.equal(t.createPoller.created.length, 1);
});

test('baseline result shows no toast', () => {
  const t = setup();
  t.service.watch(info('p1'));
  t.service.handleResult('p1', { status: 'ok', replies: [reply(1), reply(2)] });
  const record = t.service.getWatch('p1');
  assert.equal(record.baselined, true);
  assert.equal(record.known.length, 2);
  assert.equal(t.service.unseenCountFor('p1'), 0);
  t.poller().opts.onRoundDone();
  assert.deepEqual(t.toasts, []);
});

test('one round with new replies in two threads shows two toasts once', () => {
  const t = setup({ initial: { a: baselined('a'), b: baselined('b'), c: baselined('c') } });
  const { onResult, onRoundDone } = t.poller().opts;
  onResult('a', { status: 'ok', replies: [reply(1)] });
  onResult('b', { status: 'ok', replies: [reply(2), reply(3)] });
  onResult('c', { status: 'ok', replies: [] });
  assert.equal(t.store.saves, 2, 'each changed result is saved as it arrives; c had none');
  assert.equal(t.toasts.length, 0, 'no toasts until the round is done');
  onRoundDone();
  assert.equal(t.toasts.length, 1, 'showToasts is called once');
  assert.equal(t.toasts[0].length, 2);
  assert.deepEqual(t.toasts[0].map((x) => x.postId).sort(), ['a', 'b']);
  onRoundDone();
  assert.equal(t.toasts.length, 1, 'the collection is cleared after the round');
  assert.equal(t.service.unseenTotal(), 3);
});

test('own replies never toast or count as unseen', () => {
  const t = setup({ initial: { a: baselined('a') }, selfDid: 'did:plc:me' });
  t.service.handleResult('a', { status: 'ok', replies: [reply(1, 'did:plc:me')] });
  t.poller().opts.onRoundDone();
  assert.deepEqual(t.toasts, []);
  assert.equal(t.service.unseenCountFor('a'), 0);
  assert.equal(t.service.getWatch('a').known.length, 1);
});

test('notFound marks the watch unavailable and it is not polled again', () => {
  const t = setup({ initial: { a: baselined('a') } });
  t.service.handleResult('a', { status: 'notFound' });
  assert.equal(t.service.getWatch('a').unavailable, true);
  assert.equal(t.service.isWatched('a'), true);
  // WatchPoller skips unavailable watches; getWatches hands it the flag
  const polled = t
    .poller()
    .opts.getWatches()
    .filter((w) => !w.unavailable);
  assert.deepEqual(polled, []);
  t.service.handleResult('b', { status: 'blocked' });
  assert.equal(t.service.getWatch('b'), undefined, 'results for unknown posts are ignored');
});

test('markSeen clears unseen counts; markSeen with nothing unseen does not save', () => {
  const record = { ...baselined('a'), unseen: [reply(1), reply(2)] };
  const t = setup({ initial: { a: record } });
  assert.equal(t.service.unseenCountFor('a'), 2);
  t.service.markSeen('a');
  assert.equal(t.service.unseenCountFor('a'), 0);
  assert.equal(t.store.saves, 1);
  assert.equal(t.notifyCount(), 1);
  t.service.markSeen('a');
  assert.equal(t.store.saves, 1);
  assert.equal(t.notifyCount(), 1);
});

test('unseenTotal sums unseen replies of live watches', () => {
  const initial = {
    a: { ...baselined('a'), unseen: [reply(1)] },
    b: { ...baselined('b'), unseen: [reply(2), reply(3)] },
    c: { ...baselined('c'), unseen: [reply(4)], removedAt: new Date(NOW_MS).toISOString() },
  };
  const t = setup({ initial });
  assert.equal(t.service.unseenTotal(), 3);
});

test('resolveUri uses the record DID or resolves the handle and saves the URI', async () => {
  const resolved = [];
  const api = {
    async resolveHandleToDid(handle) {
      resolved.push(handle);
      return 'did:plc:resolved';
    },
  };
  const noDid = { ...baselined('a'), authorDid: null, uri: null };
  const t = setup({ initial: { a: noDid, b: baselined('b') }, api });
  const { resolveUri } = t.poller().opts;
  assert.equal(await resolveUri(t.service.getWatch('b')), `at://${DID}/app.bsky.feed.post/b`);
  assert.deepEqual(resolved, []);
  const uri = await resolveUri(t.service.getWatch('a'));
  assert.equal(uri, 'at://did:plc:resolved/app.bsky.feed.post/a');
  assert.deepEqual(resolved, ['alice.test']);
  assert.equal(t.service.getWatch('a').uri, uri);
  assert.equal(t.store.saves, 1);
});

test('without api, watch still works and nothing polls', () => {
  const t = setup({ api: undefined });
  assert.equal(t.service.hasApi(), false);
  assert.equal(t.createPoller.created.length, 0);
  assert.deepEqual(t.service.watch(info('p1')), { ok: true });
  assert.equal(t.service.isWatched('p1'), true);
  t.service.applyConfig({ enabled: true, intervalMs: 60000 });
  assert.equal(t.createPoller.created.length, 0);
});

test('startSync adopts the remote map and notifies', async () => {
  const t = setup();
  const remote = { r: baselined('r') };
  t.store.syncRemote = async () => remote;
  await t.service.startSync();
  assert.equal(t.service.isWatched('r'), true);
  assert.equal(t.notifyCount(), 1);
  t.store.syncRemote = async () => null;
  await t.service.startSync();
  assert.equal(t.service.isWatched('r'), true);
  assert.equal(t.notifyCount(), 1);
});

test('the 51st watch is refused when another tab added watches', () => {
  const gm = {};
  const timers = { setTimeout: () => 0, clearTimeout: () => {}, now: () => NOW_MS };
  const makeRealStore = () =>
    new WatchStore({
      getValue: (key, fallback) => (key in gm ? gm[key] : fallback),
      setValue: (key, value) => {
        gm[key] = value;
      },
      remote: null,
      timers,
    });
  const make = () => {
    const service = new WatchService();
    service.init({
      store: makeRealStore(),
      api: undefined,
      enabled: true,
      now: () => NOW_MS,
    });
    return service;
  };
  const tabA = make();
  for (let i = 0; i < 49; i++) assert.equal(tabA.watch(info(`p${i}`)).ok, true);
  const tabB = make();
  assert.deepEqual(tabB.watch(info('other')), { ok: true });
  assert.deepEqual(tabA.watch(info('p51')), { ok: false, reason: 'limit' });
  assert.equal(tabA.isWatched('p51'), false);
  const stored = makeRealStore().load();
  assert.equal(liveWatches(stored).length, 50);
  assert.equal(Object.values(stored).filter((r) => r.removedAt).length, 0, 'nothing is tombstoned');
});

test('no toasts after polling is disabled mid-round', () => {
  const t = setup({ initial: { a: baselined('a') } });
  const { onResult, onRoundDone } = t.poller().opts;
  onResult('a', { status: 'ok', replies: [reply(1)] });
  t.service.applyConfig({ enabled: false, intervalMs: 180000 });
  onRoundDone();
  assert.deepEqual(t.toasts, []);
  t.service.applyConfig({ enabled: true, intervalMs: 180000 });
  onRoundDone();
  assert.deepEqual(t.toasts, [], 'results collected before disabling are dropped');
});

test('handleRoundDone while disabled shows nothing and clears results', () => {
  const t = setup({ initial: { a: baselined('a') } });
  const { onResult, onRoundDone } = t.poller().opts;
  onResult('a', { status: 'ok', replies: [reply(1)] });
  t.service.enabled = false;
  onRoundDone();
  t.service.enabled = true;
  onRoundDone();
  assert.deepEqual(t.toasts, []);
});

test('unwatch then watch at the same instant leaves the post watched', () => {
  const t = setup();
  t.service.watch(info('p1'));
  t.service.unwatch('p1');
  assert.deepEqual(t.service.watch(info('p1')), { ok: true });
  assert.equal(t.service.isWatched('p1'), true);
  const record = t.service.getWatch('p1');
  assert.ok(Date.parse(record.watchedAt) > NOW_MS);
});

test('blocked marks a live watch unavailable', () => {
  const t = setup({ initial: { a: baselined('a') } });
  t.service.handleResult('a', { status: 'blocked' });
  assert.equal(t.service.getWatch('a').unavailable, true);
  assert.equal(t.service.isWatched('a'), true);
  assert.equal(t.store.saves, 1);
});

// Two tabs over one shared GM store

function sharedGm() {
  const gm = {};
  const timers = { setTimeout: () => 0, clearTimeout: () => {}, now: () => NOW_MS };
  const makeStore = (remote = null) =>
    new WatchStore({
      getValue: (key, fallback) => (key in gm ? gm[key] : fallback),
      setValue: (key, value) => {
        gm[key] = value;
      },
      remote,
      timers,
    });
  return { gm, makeStore };
}

function makeTab(store, extra = {}) {
  const toasts = [];
  const createPoller = makePollerFactory();
  let notified = 0;
  const service = new WatchService();
  service.init({
    store,
    api: {},
    enabled: true,
    selfDid: () => 'did:plc:me',
    showToasts: (t) => toasts.push(t),
    notify: () => notified++,
    createPoller,
    now: () => NOW_MS,
    ...extra,
  });
  const round = (postId, replies) => {
    service.handleResult(postId, { status: 'ok', replies });
    service.handleRoundDone();
  };
  return {
    service,
    toasts,
    round,
    notifyCount: () => notified,
    poller: () => createPoller.created[0],
  };
}

function seedBaselined(makeStore, postId) {
  makeStore().save({ [postId]: baselined(postId) });
}

test('a reply found and seen in tab A is not toasted when tab B checks', () => {
  const { makeStore } = sharedGm();
  seedBaselined(makeStore, 'p1');
  const tabA = makeTab(makeStore());
  const tabB = makeTab(makeStore());
  tabA.round('p1', [reply(1)]);
  assert.equal(tabA.toasts.length, 1);
  tabA.service.markSeen('p1');
  tabB.round('p1', [reply(1)]);
  assert.deepEqual(tabB.toasts, []);
  assert.equal(tabB.service.unseenCountFor('p1'), 0);
  assert.equal(makeStore().load().p1.unseen.length, 0);
});

test('markSeen in a stale tab clears the unseen replies in storage', () => {
  const { makeStore } = sharedGm();
  seedBaselined(makeStore, 'p1');
  const tabB = makeTab(makeStore());
  const tabA = makeTab(makeStore());
  tabA.round('p1', [reply(1)]);
  assert.equal(makeStore().load().p1.unseen.length, 1);
  tabB.service.markSeen('p1');
  assert.equal(makeStore().load().p1.unseen.length, 0);
  assert.equal(tabB.service.unseenCountFor('p1'), 0);
});

test('a thread unwatched in tab A is not toasted by tab B', () => {
  const { makeStore } = sharedGm();
  seedBaselined(makeStore, 'p1');
  const tabB = makeTab(makeStore());
  const tabA = makeTab(makeStore());
  tabA.service.unwatch('p1');
  tabB.round('p1', [reply(1)]);
  assert.deepEqual(tabB.toasts, []);
  assert.equal(tabB.service.isWatched('p1'), false);
  assert.ok(makeStore().load().p1.removedAt);
});

test('unwatch in a stale tab still removes a watch another tab added', () => {
  const { makeStore } = sharedGm();
  const tabB = makeTab(makeStore());
  const tabA = makeTab(makeStore());
  tabA.service.watch(info('p1'));
  tabB.service.unwatch('p1');
  assert.ok(makeStore().load().p1.removedAt);
});

test('startSync keeps a commit made while the sync was in flight', async () => {
  const { makeStore } = sharedGm();
  seedBaselined(makeStore, 'p1');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const remote = { enabled: true, queryAll: async () => [], exec: () => gate };
  const tab = makeTab(makeStore(remote));
  const syncing = tab.service.startSync();
  // Let syncRemote load the remote table and write the merge; it now waits on the push
  await new Promise((resolve) => setTimeout(resolve, 0));
  tab.round('p1', [reply(1)]);
  assert.equal(tab.toasts.length, 1);
  release();
  await syncing;
  assert.equal(tab.service.unseenCountFor('p1'), 1, 'the in-flight commit is kept');
  tab.round('p1', [reply(1)]);
  assert.equal(tab.toasts.length, 1, 'the reply is not reported again');
});

test('becoming visible reloads the map from storage and notifies', () => {
  const { makeStore } = sharedGm();
  seedBaselined(makeStore, 'p1');
  let hidden = true;
  let onChange = null;
  const visibility = {
    isHidden: () => hidden,
    onChange: (cb) => {
      onChange = cb;
      return () => {};
    },
  };
  const tabB = makeTab(makeStore(), { visibility });
  const tabA = makeTab(makeStore());
  tabA.round('p1', [reply(1)]);
  assert.equal(tabB.service.unseenCountFor('p1'), 0, 'tab B is stale while hidden');
  const before = tabB.notifyCount();
  onChange();
  assert.equal(tabB.notifyCount(), before, 'nothing happens while still hidden');
  hidden = false;
  onChange();
  assert.equal(tabB.service.unseenCountFor('p1'), 1);
  assert.equal(tabB.notifyCount(), before + 1);
});

test('an unchanged check result saves nothing and does not notify', () => {
  const known = { ...baselined('a'), known: [reply(1).uri] };
  const t = setup({ initial: { a: known, b: { ...baselined('b'), unavailable: true } } });
  t.service.handleResult('a', { status: 'ok', replies: [reply(1)] });
  t.service.handleResult('a', { status: 'ok', replies: [] });
  t.service.handleResult('b', { status: 'notFound' });
  assert.equal(t.store.saves, 0);
  assert.equal(t.notifyCount(), 0);
  t.service.handleResult('a', { status: 'ok', replies: [reply(1), reply(2)] });
  assert.equal(t.store.saves, 1, 'a real change is still saved');
  assert.equal(t.notifyCount(), 1);
});
