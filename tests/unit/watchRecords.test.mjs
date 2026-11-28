import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_WATCHES,
  MAX_KNOWN_REPLIES,
  MAX_UNSEEN_REPLIES,
  WATCH_EXPIRY_MS,
  WATCH_TOMBSTONE_TTL_MS,
  createWatch,
  isLive,
  liveWatches,
  canAddWatch,
  applyCheck,
  markUnavailable,
  markWatchSeen,
  removeWatch,
  mergeWatch,
  mergeWatchMaps,
  changedIds,
  pruneWatches,
  unseenTotal,
  unseenCountFor,
  sortForList,
} from '../../src/watch/watchRecords.js';

const NOW = '2026-11-27T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function before(days) {
  return iso(NOW_MS - days * DAY);
}

function reply(n, indexedAt, authorDid = 'did:other') {
  return {
    uri: `at://${authorDid}/app.bsky.feed.post/r${n}`,
    rkey: `r${n}`,
    authorDid,
    authorHandle: 'someone.test',
    authorName: 'Someone',
    authorAvatar: null,
    text: `reply ${n}`,
    indexedAt,
  };
}

const info = {
  postId: 'post1',
  url: '/profile/alice.test/post/post1',
  authorDid: 'did:alice',
  authorHandle: 'alice.test',
  snippet: 'hello',
};

const r1 = reply(1, '2026-11-20T00:00:00.000Z');
const r2 = reply(2, '2026-11-21T00:00:00.000Z');
const r3 = reply(3, '2026-11-22T00:00:00.000Z');
const r4 = reply(4, '2026-11-23T00:00:00.000Z');

function live(postId, overrides = {}) {
  return {
    ...createWatch({ ...info, postId }, before(1)),
    baselined: true,
    ...overrides,
  };
}

function mapOf(records) {
  return Object.fromEntries(records.map((r) => [r.postId, r]));
}

test('constants have the owner-approved values', () => {
  assert.equal(MAX_WATCHES, 50);
  assert.equal(MAX_KNOWN_REPLIES, 2000);
  assert.equal(MAX_UNSEEN_REPLIES, 200);
  assert.equal(WATCH_EXPIRY_MS, 30 * DAY);
  assert.equal(WATCH_TOMBSTONE_TTL_MS, 30 * DAY);
});

test('createWatch starts unbaselined with empty sets', () => {
  const w = createWatch(info, NOW);
  assert.deepEqual(w, {
    postId: 'post1',
    url: '/profile/alice.test/post/post1',
    uri: 'at://did:alice/app.bsky.feed.post/post1',
    authorDid: 'did:alice',
    authorHandle: 'alice.test',
    snippet: 'hello',
    watchedAt: NOW,
    updatedAt: NOW,
    lastActivityAt: NOW,
    removedAt: null,
    baselined: false,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
  });
  assert.equal(isLive(w), true);
  assert.equal(createWatch({ ...info, authorDid: null }, NOW).uri, null);
});

test('first applyCheck baselines: all current replies known, none new', () => {
  const { record, newReplies } = applyCheck(createWatch(info, before(1)), [r1, r2], {
    nowIso: NOW,
  });
  assert.deepEqual(newReplies, []);
  assert.deepEqual(record.known, [r1.uri, r2.uri]);
  assert.equal(record.baselined, true);
  assert.deepEqual(record.unseen, []);
  assert.equal(record.updatedAt, NOW);
  assert.equal(record.lastActivityAt, before(1));
});

test('later applyCheck reports only unknown replies and records them unseen', () => {
  const start = createWatch(info, before(2));
  const first = applyCheck(start, [r1, r2], { nowIso: before(1) }).record;
  const frozen = JSON.stringify(first);
  const { record, newReplies } = applyCheck(first, [r1, r2, r3, r4], {
    nowIso: NOW,
    selfDid: 'did:me',
  });
  assert.deepEqual(newReplies, [r3, r4]);
  assert.deepEqual(record.known, [r1.uri, r2.uri, r3.uri, r4.uri]);
  assert.deepEqual(record.unseen, [r3, r4]);
  assert.equal(record.lastActivityAt, NOW);
  assert.equal(record.updatedAt, NOW);
  assert.equal(JSON.stringify(first), frozen, 'input is not mutated');
});

test('applyCheck with nothing new leaves updatedAt and lastActivityAt unchanged', () => {
  const first = applyCheck(createWatch(info, before(2)), [r1, r2], { nowIso: before(1) }).record;
  const { record, newReplies } = applyCheck(first, [r1, r2], { nowIso: NOW, selfDid: 'did:me' });
  assert.deepEqual(newReplies, []);
  assert.equal(record.updatedAt, before(1));
  assert.equal(record.lastActivityAt, before(2));
  assert.deepEqual(record, first);
});

test('unseen keeps the newest 200', () => {
  const base = applyCheck(createWatch(info, before(2)), [], { nowIso: before(1) }).record;
  const replies = Array.from({ length: 250 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const { record, newReplies } = applyCheck(base, replies, { nowIso: NOW });
  assert.equal(newReplies.length, 250);
  assert.equal(record.unseen.length, 200);
  assert.deepEqual(record.unseen, replies.slice(50));
  assert.equal(record.known.length, 250);
});

test('overflow collapses known into knownBefore and nothing old reappears', () => {
  const replies = Array.from({ length: 2001 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const newest = replies[2000].indexedAt;
  const first = applyCheck(createWatch(info, before(2)), replies, { nowIso: before(1) }).record;
  assert.ok(first.known.length <= 2000);
  assert.equal(first.knownBefore, newest);
  assert.equal(first.baselined, true);

  const newer = reply('new', iso(NOW_MS - 1000));
  const { record, newReplies } = applyCheck(first, [...replies, newer], { nowIso: NOW });
  assert.deepEqual(newReplies, [newer]);
  assert.deepEqual(record.unseen, [newer]);
  assert.equal(record.knownBefore, newest);
  assert.deepEqual(record.known, [newer.uri]);
});

test('overflow on a baselined watch leaves unseen entries untouched', () => {
  const old = Array.from({ length: 1999 }, (_, i) => reply(i, iso(NOW_MS - 2 * DAY + i * 1000)));
  const first = applyCheck(createWatch(info, before(3)), old, { nowIso: before(2) }).record;
  const a = reply('a', iso(NOW_MS - DAY));
  const b = reply('b', iso(NOW_MS - DAY + 1000));
  const { record, newReplies } = applyCheck(first, [...old, a, b], { nowIso: NOW });
  assert.deepEqual(newReplies, [a, b]);
  assert.deepEqual(record.unseen, [a, b]);
  assert.equal(record.knownBefore, b.indexedAt);
  assert.deepEqual(record.known, []);
  const again = applyCheck(record, [...old, a, b], { nowIso: NOW });
  assert.deepEqual(again.newReplies, []);
});

test('overflow keeps known URIs missing from a partial fetch', () => {
  const replies = Array.from({ length: 2100 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const big = live('p', { known: replies.map((r) => r.uri), updatedAt: before(1) });
  const partial = applyCheck(big, replies.slice(0, 2050), { nowIso: NOW });
  assert.deepEqual(partial.newReplies, []);
  assert.equal(partial.record.knownBefore, replies[2049].indexedAt);
  assert.deepEqual(
    partial.record.known,
    replies.slice(2050).map((r) => r.uri)
  );
  const full = applyCheck(partial.record, replies, { nowIso: NOW });
  assert.deepEqual(full.newReplies, []);
});

test('overflow never collapses on an empty fetch', () => {
  const replies = Array.from({ length: 2100 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const big = live('p', { known: replies.map((r) => r.uri), updatedAt: before(1) });
  const empty = applyCheck(big, [], { nowIso: NOW });
  assert.deepEqual(empty.newReplies, []);
  assert.deepEqual(empty.record.known, big.known);
  assert.equal(empty.record.knownBefore, null);
  const full = applyCheck(empty.record, replies, { nowIso: NOW });
  assert.deepEqual(full.newReplies, []);
});

test('own replies are added to known without becoming unseen', () => {
  const first = applyCheck(createWatch(info, before(2)), [r1], { nowIso: before(1) }).record;
  const mine = reply('mine', r2.indexedAt, 'did:me');
  const { record, newReplies } = applyCheck(first, [r1, mine], { nowIso: NOW, selfDid: 'did:me' });
  assert.deepEqual(newReplies, []);
  assert.deepEqual(record.unseen, []);
  assert.deepEqual(record.known, [r1.uri, mine.uri]);
  assert.equal(record.lastActivityAt, before(2));
  assert.equal(record.updatedAt, NOW);
});

test('markWatchSeen empties unseen; removeWatch makes a tombstone', () => {
  const w = live('p', { known: [r1.uri], unseen: [r1] });
  const seen = markWatchSeen(w, NOW);
  assert.deepEqual(seen.unseen, []);
  assert.deepEqual(seen.known, [r1.uri]);
  assert.equal(seen.updatedAt, NOW);
  assert.deepEqual(w.unseen, [r1], 'input is not mutated');

  const gone = removeWatch(w, NOW);
  assert.equal(gone.removedAt, NOW);
  assert.equal(gone.postId, 'p');
  assert.equal(isLive(gone), false);
  assert.deepEqual(gone.known, []);
  assert.deepEqual(gone.unseen, []);

  const unavailable = markUnavailable(w, NOW);
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.updatedAt, NOW);
  assert.equal(isLive(unavailable), true);
});

test('merge: tombstone newer than watchedAt wins over a stale live copy', () => {
  const a = live('p', { watchedAt: before(5), known: [r1.uri], unseen: [r1] });
  const t = removeWatch(a, before(2));
  const stale = { ...a, updatedAt: before(1), known: [r1.uri, r2.uri] };
  for (const merged of [mergeWatch(t, stale), mergeWatch(stale, t)]) {
    assert.equal(merged.removedAt, before(2));
    assert.equal(isLive(merged), false);
    assert.deepEqual(merged.unseen, []);
  }
  assert.equal(mergeWatch(undefined, a), a);
  assert.equal(mergeWatch(a, undefined), a);
});

test('merge: re-watch after the tombstone wins and ignores the pre-tombstone copy', () => {
  const old = live('p', { watchedAt: before(5), known: [r1.uri], unseen: [r1] });
  const t = removeWatch(old, before(4));
  const rewatch = live('p', { watchedAt: before(3), updatedAt: before(3), known: [r2.uri] });
  const merged = mergeWatch(mergeWatch(t, old), rewatch);
  assert.equal(isLive(merged), true);
  assert.equal(merged.watchedAt, before(3));
  assert.deepEqual(merged.known, [r2.uri]);
  assert.deepEqual(merged.unseen, []);

  // A three-way: tombstone + stale old copy + re-watch in any order.
  const other = mergeWatch(rewatch, mergeWatch(old, t));
  assert.deepEqual(other.known, [r2.uri]);
  assert.equal(other.removedAt, null);
});

test('merge: known sets are unioned', () => {
  const a = live('p', {
    known: [r1.uri, r2.uri],
    knownBefore: '2026-11-01T00:00:00.000Z',
    updatedAt: before(1),
    lastActivityAt: before(3),
    snippet: 'old',
    uri: null,
  });
  const b = live('p', {
    known: [r2.uri, r3.uri],
    knownBefore: '2026-11-05T00:00:00.000Z',
    updatedAt: NOW,
    lastActivityAt: before(4),
    snippet: 'new',
    baselined: false,
    unavailable: true,
    uri: 'at://did:alice/app.bsky.feed.post/p',
  });
  const m = mergeWatch(a, b);
  assert.deepEqual(m.known, [r1.uri, r2.uri, r3.uri]);
  assert.equal(m.knownBefore, '2026-11-05T00:00:00.000Z');
  assert.equal(m.baselined, true);
  assert.equal(m.unavailable, true);
  assert.equal(m.updatedAt, NOW);
  assert.equal(m.lastActivityAt, before(3));
  assert.equal(m.snippet, 'new');
  assert.equal(m.uri, 'at://did:alice/app.bsky.feed.post/p');
  assert.equal(m.removedAt, null);
});

test('merge: known union is not trimmed; the next check collapses it', () => {
  const replies = Array.from({ length: 3000 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const ua = replies.slice(0, 1500).map((r) => r.uri);
  const ub = replies.slice(1500).map((r) => r.uri);
  const m = mergeWatch(live('p', { known: ua }), live('p', { known: ub }));
  assert.equal(m.known.length, 3000);
  assert.deepEqual(m.known, [...ua, ...ub]);

  const newer = reply('new', iso(NOW_MS - 1000));
  const { record, newReplies } = applyCheck(m, [...replies, newer], { nowIso: NOW });
  assert.deepEqual(newReplies, [newer]);
  assert.ok(record.known.length <= 2000);
  assert.equal(record.knownBefore, newer.indexedAt);
  const again = applyCheck(record, [...replies, newer], { nowIso: NOW });
  assert.deepEqual(again.newReplies, []);
});

test('applyCheck collapses a record already over 2,000 known even with nothing new', () => {
  const replies = Array.from({ length: 2001 }, (_, i) => reply(i, iso(NOW_MS - DAY + i * 1000)));
  const big = live('p', { known: replies.map((r) => r.uri), updatedAt: before(1) });
  const { record, newReplies } = applyCheck(big, replies, { nowIso: NOW });
  assert.deepEqual(newReplies, []);
  assert.ok(record.known.length <= 2000);
  assert.equal(record.knownBefore, replies[2000].indexedAt);
  assert.equal(record.updatedAt, NOW);
});

test('merge: a reply seen on either copy stays seen', () => {
  const a = live('p', { known: [r1.uri], unseen: [] });
  const b = live('p', { known: [r1.uri], unseen: [r1] });
  assert.deepEqual(mergeWatch(a, b).unseen, []);
  assert.deepEqual(mergeWatch(b, a).unseen, []);
  // Known through knownBefore counts as known too.
  const c = live('p', { known: [], knownBefore: r1.indexedAt, unseen: [] });
  assert.deepEqual(mergeWatch(b, c).unseen, []);
});

test('merge: a reply only one copy has discovered stays unseen', () => {
  const a = live('p', { known: [r1.uri], unseen: [] });
  const b = live('p', { known: [r1.uri, r2.uri], unseen: [r2] });
  assert.deepEqual(mergeWatch(a, b).unseen, [r2]);
  // Unseen on both copies stays unseen once.
  const c = live('p', { known: [r1.uri, r2.uri, r3.uri], unseen: [r2, r3] });
  assert.deepEqual(mergeWatch(b, c).unseen, [r2, r3]);
  // An overflowed copy still lists its unseen entry: it stays unseen.
  const d = live('p', { known: [], knownBefore: r2.indexedAt, unseen: [r2] });
  assert.deepEqual(mergeWatch(b, d).unseen, [r2]);
});

test('mergeWatchMaps keeps ids from both maps; changedIds lists only differing records', () => {
  const a1 = live('a', { known: [r1.uri] });
  const b1 = live('b');
  const c1 = live('c');
  const left = mapOf([a1, b1]);
  const right = mapOf([{ ...a1, known: [r2.uri] }, c1]);
  const merged = mergeWatchMaps(left, right);
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b', 'c']);
  assert.equal(merged.b, b1);
  assert.equal(merged.c, c1);
  assert.deepEqual(merged.a.known, [r1.uri, r2.uri]);

  assert.deepEqual(changedIds(left, merged), new Set(['a', 'c']));
  assert.deepEqual(changedIds(merged, merged), new Set());
  // Key order does not matter.
  const reordered = { b: { ...b1 }, a: Object.fromEntries(Object.entries(a1).reverse()) };
  assert.deepEqual(changedIds(left, reordered), new Set());
  assert.deepEqual(changedIds(left, { a: a1 }), new Set(['b']));
});

test('changedIds treats known and unseen as sets', () => {
  const x = live('x', { known: [r1.uri, r2.uri, r3.uri], unseen: [r2, r3] });
  const y = { ...x, known: [r3.uri, r1.uri, r2.uri], unseen: [r3, r2] };
  assert.deepEqual(changedIds({ x }, { x: y }), new Set());
  const z = { ...x, unseen: [r3] };
  assert.deepEqual(changedIds({ x }, { x: z }), new Set(['x']));
});

test('pruneWatches expires watches idle for 30 days and drops old tombstones', () => {
  const idle = live('idle', { lastActivityAt: before(31) });
  const active = live('active', { lastActivityAt: before(29) });
  const oldTomb = removeWatch(live('oldTomb'), before(31));
  const newTomb = removeWatch(live('newTomb'), before(29));
  const pruned = pruneWatches(mapOf([idle, active, oldTomb, newTomb]), NOW_MS);
  assert.deepEqual(Object.keys(pruned).sort(), ['active', 'idle', 'newTomb']);
  assert.equal(pruned.idle.removedAt, NOW);
  assert.equal(isLive(pruned.idle), false);
  assert.equal(pruned.active, active);
  assert.equal(pruned.newTomb, newTomb);
});

test('pruneWatches keeps at most 50 live watches', () => {
  const records = Array.from({ length: 53 }, (_, i) =>
    live(`p${i}`, { lastActivityAt: iso(NOW_MS - (i + 1) * 60 * 1000) })
  );
  const pruned = pruneWatches(mapOf(records), NOW_MS);
  assert.equal(liveWatches(pruned).length, 50);
  for (const id of ['p50', 'p51', 'p52']) {
    assert.equal(pruned[id].removedAt, NOW);
  }
  assert.equal(isLive(pruned.p49), true);
});

test('canAddWatch is false at 50 live watches, tombstones do not count', () => {
  const records = Array.from({ length: 49 }, (_, i) => live(`p${i}`));
  const tombs = Array.from({ length: 5 }, (_, i) => removeWatch(live(`t${i}`), NOW));
  const map = mapOf([...records, ...tombs]);
  assert.equal(canAddWatch(map), true);
  assert.equal(liveWatches(map).length, 49);
  map.p49 = live('p49');
  assert.equal(canAddWatch(map), false);
  assert.equal(canAddWatch({}), true);
});

test('sortForList puts unseen first, newest activity first, and omits tombstones', () => {
  const quietOld = live('quietOld', { lastActivityAt: before(5) });
  const quietNew = live('quietNew', { lastActivityAt: before(1) });
  const unseenOld = live('unseenOld', { lastActivityAt: before(3), unseen: [r1, r2] });
  const unseenNew = live('unseenNew', { lastActivityAt: before(4), unseen: [r3] });
  const tomb = removeWatch(live('tomb', { unseen: [r4] }), NOW);
  const list = sortForList(mapOf([quietOld, tomb, unseenOld, quietNew, unseenNew]));
  assert.deepEqual(
    list.map((r) => r.postId),
    ['unseenNew', 'unseenOld', 'quietNew', 'quietOld']
  );
});

test('unseenTotal and unseenCountFor count live watches only', () => {
  const a = live('a', { unseen: [r1, r2] });
  const b = live('b', { unseen: [r3] });
  const t = { ...live('t', { unseen: [r4] }), removedAt: NOW };
  const map = mapOf([a, b, t]);
  assert.equal(unseenTotal(map), 3);
  assert.equal(unseenCountFor(map, 'a'), 2);
  assert.equal(unseenCountFor(map, 't'), 0);
  assert.equal(unseenCountFor(map, 'missing'), 0);
  assert.equal(unseenTotal({}), 0);
});

test('hiddenAsRead: read hides unless watch is on with unseen replies', async () => {
  const { hiddenAsRead } = await import('../../src/watch/watchRecords.js');
  assert.equal(hiddenAsRead(true, true, 0), true);
  assert.equal(hiddenAsRead(true, true, 2), false);
  assert.equal(hiddenAsRead(true, false, 2), true);
  assert.equal(hiddenAsRead(false, true, 2), false);
  assert.equal(hiddenAsRead(undefined, true, 0), false);
});

test('applyCheck leaves updatedAt alone when an over-cap record has nothing to collapse', () => {
  // 2,100 known URIs the fetch no longer returns stay known by URI; the fetched replies are
  // already covered by knownBefore, so nothing changes
  const missing = Array.from({ length: 2100 }, (_, i) => `at://did:gone/app.bsky.feed.post/g${i}`);
  const fetched = [r1, r2, r3];
  const big = live('p', { known: missing, knownBefore: r3.indexedAt, updatedAt: before(1) });
  const { record, newReplies } = applyCheck(big, fetched, { nowIso: NOW });
  assert.deepEqual(newReplies, []);
  assert.equal(record.updatedAt, before(1));
  assert.equal(record.knownBefore, r3.indexedAt);
  assert.deepEqual(record.known, missing);
});
