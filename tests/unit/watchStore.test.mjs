import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchStore, WATCHES_GM_KEY, REMOTE_PUSH_DELAY_MS } from '../../src/watch/WatchStore.js';
import { watchRecordId } from '../../src/watch/watchRemote.js';

const NOW = '2026-11-27T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const MIN = 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function reply(n, indexedAt) {
  return {
    uri: `at://did:other/app.bsky.feed.post/r${n}`,
    rkey: `r${n}`,
    authorDid: 'did:other',
    authorHandle: 'bob.test',
    authorName: 'Bob',
    authorAvatar: null,
    text: `reply ${n}`,
    indexedAt,
  };
}

function record(postId, overrides = {}) {
  return {
    postId,
    url: `/profile/alice.test/post/${postId}`,
    uri: null,
    authorDid: null,
    authorHandle: 'alice.test',
    snippet: '',
    watchedAt: iso(NOW_MS - 60 * MIN),
    updatedAt: iso(NOW_MS - 60 * MIN),
    lastActivityAt: iso(NOW_MS - 60 * MIN),
    removedAt: null,
    baselined: true,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
    ...overrides,
  };
}

function fakeGm(initial = {}) {
  const values = { ...initial };
  return {
    values,
    getValue: (key, fallback) => (key in values ? values[key] : fallback),
    setValue: (key, value) => {
      values[key] = value;
    },
  };
}

function stored(watches) {
  return { [WATCHES_GM_KEY]: JSON.stringify({ version: 1, watches }) };
}

function storedWatches(gm) {
  return JSON.parse(gm.values[WATCHES_GM_KEY]).watches;
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    now: () => NOW_MS,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    runAll() {
      const due = [...pending.values()];
      pending.clear();
      return Promise.all(due.map((t) => t.fn()));
    },
  };
}

/** Fake remote holding rows keyed by record id, answering the select/upsert queries. */
function fakeRemote(rows = {}, { enabled = true, failSelect = false } = {}) {
  const table = {};
  for (const r of Object.values(rows)) table[watchRecordId(r.postId)] = r;
  const remote = {
    enabled,
    table,
    queries: [],
    execs: [],
    async queryAll(q) {
      remote.queries.push(q);
      if (failSelect) throw new Error('remote down');
      if (q === 'SELECT * FROM watch;') {
        return Object.entries(table).map(([id, r]) => ({ id, ...r }));
      }
      const ids = q
        .replace(/^SELECT \* FROM /, '')
        .replace(/;$/, '')
        .split(', ');
      return ids.filter((id) => table[id]).map((id) => ({ id, ...table[id] }));
    },
    async exec(q) {
      remote.execs.push(q);
      for (const m of q.matchAll(/UPSERT (watch:\S+) CONTENT (.*?);(?= UPSERT | DELETE |$)/g)) {
        table[m[1]] = JSON.parse(m[2]);
      }
    },
  };
  return remote;
}

function upsertedIds(remote) {
  return remote.execs.flatMap((q) =>
    [...q.matchAll(/UPSERT watch:(\S+) CONTENT/g)].map((m) => m[1])
  );
}

test('load returns {} for a missing or corrupt GM value', () => {
  const timers = fakeTimers();
  for (const values of [
    {},
    { [WATCHES_GM_KEY]: 'not json{' },
    { [WATCHES_GM_KEY]: JSON.stringify([1, 2]) },
    { [WATCHES_GM_KEY]: JSON.stringify({ version: 1, watches: [] }) },
    { [WATCHES_GM_KEY]: JSON.stringify({ version: 2, watches: {} }) },
    { [WATCHES_GM_KEY]: 'null' },
  ]) {
    const gm = fakeGm(values);
    const store = new WatchStore({ ...gm, remote: null, timers });
    assert.deepEqual(store.load(), {});
  }
  const gm = fakeGm(stored({ a1: record('a1') }));
  const store = new WatchStore({ ...gm, remote: null, timers });
  assert.deepEqual(store.load(), { a1: record('a1') });
});

test('save merges with what another tab stored instead of overwriting', () => {
  // Another tab already wrote watch b1
  const gm = fakeGm(stored({ b1: record('b1') }));
  const store = new WatchStore({ ...gm, remote: null, timers: fakeTimers() });
  const result = store.save({ a1: record('a1') });
  assert.deepEqual(Object.keys(result).sort(), ['a1', 'b1']);
  assert.deepEqual(Object.keys(storedWatches(gm)).sort(), ['a1', 'b1']);
  assert.equal(JSON.parse(gm.values[WATCHES_GM_KEY]).version, 1);
});

test('save does not resurrect a watch another tab removed', () => {
  const removedAt = iso(NOW_MS - 5 * MIN);
  const ours = record('a1');
  const tomb = record('a1', { removedAt, updatedAt: removedAt, baselined: false });
  const gm = fakeGm(stored({ a1: tomb }));
  const store = new WatchStore({ ...gm, remote: null, timers: fakeTimers() });
  const result = store.save({ a1: ours });
  assert.equal(result.a1.removedAt, removedAt);
  assert.equal(storedWatches(gm).a1.removedAt, removedAt);
});

test('save queues a remote push that runs after 5000 ms', async () => {
  assert.equal(REMOTE_PUSH_DELAY_MS, 5000);
  const gm = fakeGm();
  const timers = fakeTimers();
  const remote = fakeRemote();
  const store = new WatchStore({ ...gm, remote, timers });

  store.save({ a1: record('a1') });
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, 5000);
  // A later save restarts the timer and the pending ids accumulate
  store.save({ b1: record('b1') });
  assert.equal(timers.pending.size, 1);
  assert.equal(remote.queries.length, 0);

  await timers.runAll();
  assert.deepEqual(remote.queries, ['SELECT * FROM watch:a1, watch:b1;']);
  assert.equal(remote.execs.length, 1);
  assert.deepEqual(upsertedIds(remote).sort(), ['a1', 'b1']);
  assert.deepEqual(remote.table['watch:a1'], record('a1'));
});

test('syncRemote merges remote rows into local and pushes only records that differ', async () => {
  const same = record('s1');
  const localOnly = record('l1');
  const remoteOnly = record('r1');
  // Local saw a reply that remote doesn't know yet
  const localNewer = record('n1', {
    known: [reply(1, NOW).uri],
    updatedAt: iso(NOW_MS - MIN),
  });
  const remoteOlder = record('n1');
  const gm = fakeGm(stored({ s1: same, l1: localOnly, n1: localNewer }));
  const remote = fakeRemote({ s1: same, r1: remoteOnly, n1: remoteOlder });
  const store = new WatchStore({ ...gm, remote, timers: fakeTimers() });

  const result = await store.syncRemote();
  assert.deepEqual(Object.keys(result).sort(), ['l1', 'n1', 'r1', 's1']);
  assert.deepEqual(Object.keys(storedWatches(gm)).sort(), ['l1', 'n1', 'r1', 's1']);
  assert.deepEqual(remote.queries, ['SELECT * FROM watch;']);
  assert.deepEqual(upsertedIds(remote).sort(), ['l1', 'n1']);
  assert.ok(remote.execs.join(' ').includes('DELETE watch WHERE removedAt != NONE'));
  assert.deepEqual(remote.table['watch:n1'].known, [reply(1, NOW).uri]);
});

test('pushPending reads, merges and upserts, so a newer remote seen mark survives', async () => {
  const r1 = reply(1, iso(NOW_MS - 30 * MIN));
  const r2 = reply(2, iso(NOW_MS - 20 * MIN));
  // Local: both replies unseen, last updated a while ago
  const local = record('a1', {
    known: [r1.uri],
    unseen: [r1],
    updatedAt: iso(NOW_MS - 25 * MIN),
  });
  // Remote: another device marked r1 seen more recently
  const remoteRow = record('a1', {
    known: [r1.uri],
    unseen: [],
    updatedAt: iso(NOW_MS - 10 * MIN),
  });
  const gm = fakeGm();
  const timers = fakeTimers();
  const remote = fakeRemote({ a1: remoteRow });
  const store = new WatchStore({ ...gm, remote, timers });

  // This device finds r2 after the remote mark
  store.save({ a1: { ...local, known: [r1.uri, r2.uri], unseen: [r1, r2] } });
  await store.pushPending();

  assert.deepEqual(remote.queries, ['SELECT * FROM watch:a1;']);
  const pushed = remote.table['watch:a1'];
  assert.deepEqual(
    pushed.unseen.map((r) => r.uri),
    [r2.uri]
  );
  assert.deepEqual(new Set(pushed.known), new Set([r1.uri, r2.uri]));
  assert.deepEqual(
    storedWatches(gm).a1.unseen.map((r) => r.uri),
    [r2.uri]
  );
});

test('pushPending puts the ids back when the push fails', async () => {
  const gm = fakeGm();
  const timers = fakeTimers();
  const remote = fakeRemote();
  remote.exec = async () => {
    throw new Error('write failed');
  };
  const store = new WatchStore({ ...gm, remote, timers });
  store.save({ a1: record('a1') });
  await store.pushPending();
  remote.queries.length = 0;
  remote.exec = async (q) => {
    remote.execs.push(q);
  };
  await store.pushPending();
  assert.deepEqual(remote.queries, ['SELECT * FROM watch:a1;']);
  assert.equal(remote.execs.length, 1);
});

test('after a failed syncRemote no pushes are sent', async () => {
  const gm = fakeGm(stored({ a1: record('a1') }));
  const timers = fakeTimers();
  const remote = fakeRemote({}, { failSelect: true });
  const store = new WatchStore({ ...gm, remote, timers });

  assert.equal(await store.syncRemote(), null);
  assert.equal(store.remoteFailed, true);
  const queriesAfterSync = remote.queries.length;

  store.save({ b1: record('b1') });
  assert.equal(timers.pending.size, 0);
  await store.pushPending();
  assert.equal(remote.queries.length, queriesAfterSync);
  assert.equal(remote.execs.length, 0);
  // Local storage still works
  assert.deepEqual(Object.keys(storedWatches(gm)).sort(), ['a1', 'b1']);
});

test('with remote disabled nothing is queried', async () => {
  for (const remote of [null, fakeRemote({}, { enabled: false })]) {
    const gm = fakeGm();
    const timers = fakeTimers();
    const store = new WatchStore({ ...gm, remote, timers });
    store.save({ a1: record('a1') });
    assert.equal(timers.pending.size, 0);
    assert.equal(await store.syncRemote(), null);
    await store.pushPending();
    if (remote) {
      assert.equal(remote.queries.length, 0);
      assert.equal(remote.execs.length, 0);
    }
    assert.deepEqual(Object.keys(storedWatches(gm)), ['a1']);
  }
});

test('a failed upsert in syncRemote keeps remote on and the ids pending', async () => {
  const gm = fakeGm(stored({ a1: record('a1') }));
  const timers = fakeTimers();
  const remote = fakeRemote();
  remote.exec = async (q) => {
    remote.execs.push(q);
    if (q.includes('UPSERT')) throw new Error('parse error');
  };
  const store = new WatchStore({ ...gm, remote, timers });
  const result = await store.syncRemote();
  assert.deepEqual(Object.keys(result), ['a1']);
  assert.equal(store.remoteFailed, false);
  assert.deepEqual([...store.pending], ['a1']);
});

test('syncRemote pushes nothing when the server returns the same times in another format', async () => {
  const local = record('a1', { watchedAt: NOW, updatedAt: NOW, lastActivityAt: NOW });
  const serverRow = {
    ...local,
    watchedAt: '2026-11-27T12:00:00Z',
    updatedAt: '2026-11-27T12:00:00Z',
    lastActivityAt: '2026-11-27T12:00:00Z',
  };
  const gm = fakeGm(stored({ a1: local }));
  const remote = fakeRemote({ a1: serverRow });
  const store = new WatchStore({ ...gm, remote, timers: fakeTimers() });
  await store.syncRemote();
  assert.deepEqual(upsertedIds(remote), []);
});

test('no push runs while syncRemote is in flight, and none after a failed load', async () => {
  for (const loadFails of [false, true]) {
    const gm = fakeGm();
    const timers = fakeTimers();
    const remote = fakeRemote();
    let releaseLoad;
    const select = remote.queryAll;
    remote.queryAll = async (q) => {
      if (q === 'SELECT * FROM watch;') {
        await new Promise((resolve) => {
          releaseLoad = resolve;
        });
        remote.queries.push(q);
        if (loadFails) throw new Error('remote down');
        return [];
      }
      return select(q);
    };
    const store = new WatchStore({ ...gm, remote, timers });
    const syncing = store.syncRemote();
    store.save({ a1: record('a1') });
    await timers.runAll();
    await store.pushPending();
    assert.deepEqual(remote.queries, []);

    releaseLoad();
    await syncing;
    await timers.runAll();
    if (loadFails) {
      assert.deepEqual(remote.queries, ['SELECT * FROM watch;']);
      assert.equal(remote.execs.length, 0);
    } else {
      assert.deepEqual(remote.queries, ['SELECT * FROM watch;', 'SELECT * FROM watch:a1;']);
      assert.deepEqual(upsertedIds(remote), ['a1']);
    }
  }
});

test('upserts go out in chunks of 10 and a failed chunk re-queues only its ids', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `p${String(i).padStart(2, '0')}`);
  const watches = Object.fromEntries(ids.map((id) => [id, record(id)]));

  const gm = fakeGm(stored(watches));
  const remote = fakeRemote();
  const store = new WatchStore({ ...gm, remote, timers: fakeTimers() });
  await store.syncRemote();
  const upsertExecs = remote.execs.filter((q) => q.includes('UPSERT'));
  assert.deepEqual(
    upsertExecs.map((q) => q.match(/UPSERT /g).length),
    [10, 10, 5]
  );
  assert.equal(upsertedIds(remote).length, 25);

  // pushPending: the chunk holding p12 fails, the others succeed
  const gm2 = fakeGm();
  const timers2 = fakeTimers();
  const remote2 = fakeRemote();
  const exec = remote2.exec;
  remote2.exec = async (q) => {
    if (q.includes('UPSERT watch:p12 ')) throw new Error('bad chunk');
    return exec(q);
  };
  const store2 = new WatchStore({ ...gm2, remote: remote2, timers: timers2 });
  store2.save(watches);
  await store2.pushPending();
  assert.equal(remote2.execs.length, 2);
  assert.deepEqual([...store2.pending].sort(), ids.slice(10, 20));
});
