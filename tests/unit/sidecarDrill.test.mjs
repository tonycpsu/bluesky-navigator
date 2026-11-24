import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLevelReplies,
  needsFetch,
  hasChildReplies,
  markRepliesFetched,
} from '../../src/sidecarDrill.js';

const mk = (id, likeCount = 0) => ({
  post: {
    uri: `at://did:plc:x/app.bsky.feed.post/${id}`,
    likeCount,
    repostCount: 0,
    replyCount: 0,
    record: { createdAt: '2026-01-01T00:00:00Z' },
  },
});
const notFound = { $type: 'app.bsky.feed.defs#notFoundPost' };
const blocked = { $type: 'app.bsky.feed.defs#blockedPost' };

test('getLevelReplies skips not-found and blocked nodes', () => {
  const a = mk('a');
  const b = mk('b');
  const result = getLevelReplies({ replies: [a, notFound, blocked, b] }, { sortOrder: 'Default' });
  assert.deepEqual(result, [a, b]);
});

test('getLevelReplies excludes unrolled post ids', () => {
  const a = mk('a');
  const b = mk('b');
  const result = getLevelReplies(
    { replies: [a, b] },
    { sortOrder: 'Default', excludePostIds: new Set(['a']) }
  );
  assert.deepEqual(result, [b]);
});

test('getLevelReplies sorts by Most Liked First', () => {
  const a = mk('a', 1);
  const b = mk('b', 5);
  const c = mk('c', 3);
  const node = { replies: [a, b, c] };
  assert.deepEqual(getLevelReplies(node, { sortOrder: 'Most Liked First' }), [b, c, a]);
  assert.deepEqual(getLevelReplies(node, { sortOrder: 'Default' }), [a, b, c]);
});

test('getLevelReplies returns [] when replies missing', () => {
  assert.deepEqual(getLevelReplies({ post: mk('a').post }, { sortOrder: 'Default' }), []);
});

test('needsFetch', () => {
  assert.equal(needsFetch({ post: { replyCount: 2 } }), true);
  assert.equal(needsFetch({ post: { replyCount: 2 }, replies: [mk('a')] }), false);
  assert.equal(needsFetch({ post: { replyCount: 0 } }), false);
});

test('needsFetch with empty replies refetches until a fetch is recorded', () => {
  const node = { post: { replyCount: 2 }, replies: [] };
  assert.equal(needsFetch(node), true);
  markRepliesFetched(node);
  assert.equal(needsFetch(node), false);
  // The marker doesn't show up as data on the node
  assert.deepEqual(Object.keys(node), ['post', 'replies']);
});

test('hasChildReplies', () => {
  assert.equal(hasChildReplies({ post: { replyCount: 1 } }), true);
  assert.equal(hasChildReplies({ post: { replyCount: 0 } }), false);
});
