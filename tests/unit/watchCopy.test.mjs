import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ROUND_TOASTS,
  WATCHED_TAB_URL,
  WATCH_LIMIT_MESSAGE,
  NEEDS_LOGIN_MESSAGE,
  relativeTime,
  replyUrl,
  postIdFromPath,
  buildWatchToast,
  planRoundToasts,
  watchButtonLabel,
  navBadgeContent,
} from '../../src/watch/watchCopy.js';

const NOW_MS = Date.parse('2026-11-27T12:00:00.000Z');
const ago = (ms) => new Date(NOW_MS - ms).toISOString();
const MIN = 60000;

function reply(name, handle, minsAgo, text) {
  return {
    uri: `at://did:plc:${handle}/app.bsky.feed.post/3k${handle}`,
    rkey: `3k${handle}`,
    authorDid: `did:plc:${handle}`,
    authorHandle: `${handle}.test`,
    authorName: name,
    authorAvatar: `https://cdn.test/${handle}.jpg`,
    text,
    indexedAt: ago(minsAgo * MIN),
  };
}

const alice = reply('Alice', 'alice', 30, 'first');
const bob = reply('Bob', 'bob', 20, 'second');
const carol = reply('Carol', 'carol', 10, 'third');
alice.rkey = '3kreply';

const rec = { postId: '3kroot', url: '/profile/me.test/post/3kroot', lastActivityAt: ago(MIN) };

test('constants', () => {
  assert.equal(MAX_ROUND_TOASTS, 5);
  assert.equal(WATCHED_TAB_URL, '/notifications#watched');
  assert.equal(WATCH_LIMIT_MESSAGE, 'You can watch up to 50 threads. Stop watching one first.');
  assert.equal(
    NEEDS_LOGIN_MESSAGE,
    'Checking for new replies needs the app-password login in settings.'
  );
});

test('relativeTime buckets', () => {
  assert.equal(relativeTime(ago(30 * 1000), NOW_MS), 'now');
  assert.equal(relativeTime(ago(5 * MIN), NOW_MS), '5m');
  assert.equal(relativeTime(ago(59 * MIN), NOW_MS), '59m');
  assert.equal(relativeTime(ago(60 * MIN), NOW_MS), '1h');
  assert.equal(relativeTime(ago(3 * 60 * MIN), NOW_MS), '3h');
  assert.equal(relativeTime(ago(24 * 60 * MIN), NOW_MS), '1d');
  assert.equal(relativeTime(ago(2 * 24 * 60 * MIN), NOW_MS), '2d');
  assert.equal(relativeTime(new Date(NOW_MS + MIN).toISOString(), NOW_MS), 'now');
});

test('replyUrl prefers the handle, falls back to the DID', () => {
  assert.equal(replyUrl(alice), '/profile/alice.test/post/3kreply');
  assert.equal(
    replyUrl({ ...alice, authorHandle: undefined }),
    '/profile/did:plc:alice/post/3kreply'
  );
});

test('postIdFromPath', () => {
  assert.equal(postIdFromPath('/profile/a.b/post/3k'), '3k');
  assert.equal(postIdFromPath('/profile/a.b'), null);
  assert.equal(postIdFromPath('/profile/a/post/3k/liked-by'), '3k');
  assert.equal(postIdFromPath('/notifications'), null);
  assert.equal(postIdFromPath(''), null);
});

test('one new reply: "@alice replied" copy and the reply URL', () => {
  const t = buildWatchToast(rec, [alice], NOW_MS);
  assert.equal(t.handle, 'alice.test');
  assert.equal(t.author, 'Alice');
  assert.equal(t.avatar, alice.authorAvatar);
  assert.equal(t.action, "replied in a thread you're watching");
  assert.equal(t.url, '/profile/alice.test/post/3kreply');
  assert.equal(t.type, 'watch');
  assert.equal(t.kind, 'watch');
  assert.equal(t.postId, '3kroot');
  assert.deepEqual(t.replyUris, [alice.uri]);
  assert.equal(t.preview, 'first');
  assert.equal(t.time, '30m');
  assert.equal(t.indexedAt, alice.indexedAt);
});

test('one new reply without a display name uses the handle', () => {
  const t = buildWatchToast(rec, [{ ...alice, authorName: '' }], NOW_MS);
  assert.equal(t.author, 'alice.test');
});

test('several new replies: count copy, newest snippet, the watched post URL', () => {
  const t = buildWatchToast(rec, [alice, carol, bob], NOW_MS);
  assert.equal(t.author, '3 new replies');
  assert.equal(t.handle, null);
  assert.equal(t.avatar, '');
  assert.equal(t.action, "in a thread you're watching");
  assert.equal(t.preview, carol.text);
  assert.equal(t.url, rec.url);
  assert.equal(t.time, '10m');
  assert.equal(t.indexedAt, carol.indexedAt);
  assert.deepEqual(t.replyUris, [alice.uri, carol.uri, bob.uri]);
});

function result(n, minsAgo, replies = 1) {
  const newReplies = [];
  for (let i = 0; i < replies; i++) {
    newReplies.push(reply(`U${n}`, `u${n}x${i}`, minsAgo + i, `t${n}`));
  }
  return {
    record: {
      postId: `p${n}`,
      url: `/profile/me.test/post/p${n}`,
      lastActivityAt: ago(minsAgo * MIN),
    },
    newReplies,
  };
}

test('planRoundToasts makes one toast per watched post with new replies, newest first', () => {
  const toasts = planRoundToasts(
    [result(1, 50), { record: rec, newReplies: [] }, result(2, 5), result(3, 20)],
    NOW_MS
  );
  assert.deepEqual(
    toasts.map((t) => t.postId),
    ['p2', 'p3', 'p1']
  );
});

test('planRoundToasts with nothing returns an empty list', () => {
  assert.deepEqual(planRoundToasts([], NOW_MS), []);
});

test('exactly 5 results gives 5 toasts and no summary', () => {
  const toasts = planRoundToasts(
    [1, 2, 3, 4, 5].map((n) => result(n, n * 5)),
    NOW_MS
  );
  assert.equal(toasts.length, 5);
  assert.ok(toasts.every((t) => t.postId));
});

test('caps toasts at 5 with a summary', () => {
  const sevenResults = [1, 2, 3, 4, 5, 6, 7].map((n) => result(n, n * 5));
  const toasts = planRoundToasts(sevenResults, NOW_MS);
  assert.equal(toasts.length, 5);
  assert.deepEqual(
    toasts.slice(0, 4).map((t) => t.postId),
    ['p1', 'p2', 'p3', 'p4']
  );
  const summary = toasts[4];
  assert.equal(summary.author, '3 more watched threads');
  assert.equal(summary.url, '/notifications#watched');
  assert.equal(summary.type, 'watch');
  assert.equal(summary.kind, 'watch');
  assert.equal(summary.postId, null);
  assert.equal(summary.handle, null);
  assert.equal(summary.action, 'have new replies');
  assert.equal(summary.preview, '');
  assert.equal(summary.avatar, '');
  assert.deepEqual(summary.replyUris, []);
  assert.equal(summary.indexedAt, sevenResults[4].newReplies[0].indexedAt);
  assert.equal(summary.time, '25m');
});

test('watchButtonLabel covers watched, unseen and missing login', () => {
  assert.deepEqual(watchButtonLabel({ watched: false, unseen: 0, hasApi: true }), {
    label: 'Watch for new replies',
    title: 'Watch for new replies',
  });
  assert.deepEqual(watchButtonLabel({ watched: true, unseen: 0, hasApi: true }), {
    label: 'Stop watching',
    title: 'Stop watching',
  });
  assert.equal(
    watchButtonLabel({ watched: true, unseen: 1, hasApi: true }).title,
    'Stop watching · 1 new reply'
  );
  assert.equal(
    watchButtonLabel({ watched: true, unseen: 3, hasApi: true }).title,
    'Stop watching · 3 new replies'
  );
  assert.equal(
    watchButtonLabel({ watched: false, unseen: 0, hasApi: false }).title,
    `Watch for new replies (${NEEDS_LOGIN_MESSAGE})`
  );
  assert.equal(
    watchButtonLabel({ watched: true, unseen: 2, hasApi: false }).title,
    `Stop watching · 2 new replies (${NEEDS_LOGIN_MESSAGE})`
  );
});

test('navBadgeContent: hidden at zero, capped display, plain aria-label', () => {
  assert.deepEqual(navBadgeContent(0), {
    hidden: true,
    text: '',
    label: '0 unseen watched replies',
  });
  assert.deepEqual(navBadgeContent(-3).hidden, true);
  assert.deepEqual(navBadgeContent(NaN).hidden, true);
  assert.deepEqual(navBadgeContent(7), {
    hidden: false,
    text: '7',
    label: '7 unseen watched replies',
  });
  assert.equal(navBadgeContent(99).text, '99');
  assert.equal(navBadgeContent(100).text, '99+');
  assert.equal(navBadgeContent(100).label, '100 unseen watched replies');
});

test('replyUrl uses the DID when the handle is handle.invalid', () => {
  const broken = { ...reply('Bob', 'bob', 1, 'hi'), authorHandle: 'handle.invalid' };
  assert.equal(replyUrl(broken), '/profile/did:plc:bob/post/3kbob');
  assert.equal(buildWatchToast({ postId: 'p', url: '/x' }, [broken], NOW_MS).url, replyUrl(broken));
});

test('relativeTime is empty for an invalid timestamp', () => {
  assert.equal(relativeTime('not a date', NOW_MS), '');
  assert.equal(relativeTime(undefined, NOW_MS), '');
  assert.equal(relativeTime(null, NOW_MS), '');
});
