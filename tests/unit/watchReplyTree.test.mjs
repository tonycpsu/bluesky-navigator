import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THREAD_DEPTH,
  classifyThread,
  isNotFoundError,
  collectReplies,
  findNewReplies,
  atUriForWatch,
} from '../../src/watch/replyTree.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T01:00:00.000Z';
const T2 = '2026-01-01T02:00:00.000Z';
const T3 = '2026-01-01T03:00:00.000Z';

function node(uri, did, indexedAt, replies = []) {
  return {
    post: {
      uri,
      author: { did, handle: did + '.test', displayName: 'N' },
      record: { text: 'x'.repeat(150) },
      indexedAt,
    },
    replies,
  };
}

test('THREAD_DEPTH is 50', () => {
  assert.equal(THREAD_DEPTH, 50);
});

test('collectReplies walks every depth, skips nodes without a post, sorts by indexedAt', () => {
  const t = node('at://r/p/root', 'r', T0, [
    node('at://a/p/1', 'a', T2, [node('at://b/p/2', 'b', T1, [node('at://c/p/3', 'c', T3)])]),
    { $type: 'app.bsky.feed.defs#blockedPost', uri: 'at://x/p/9', blocked: true },
  ]);
  assert.deepEqual(
    collectReplies(t).map((r) => r.rkey),
    ['2', '1', '3']
  );
  assert.equal(collectReplies(t)[0].text.length, 100);
  assert.equal(collectReplies(t)[0].authorHandle, 'b.test');
});

test('collectReplies cuts text by code points so an emoji is never split', () => {
  const t = node('at://r/p/root', 'r', T0, [node('at://a/p/1', 'a', T1)]);
  t.replies[0].post.record.text = 'x'.repeat(99) + '\u{1F600}' + 'yy';
  const text = collectReplies(t)[0].text;
  assert.equal(text, 'x'.repeat(99) + '\u{1F600}');
  assert.equal(Array.from(text).length, 100);
  assert.equal(text.isWellFormed(), true);
});

test('collectReplies dedupes a URI that appears twice', () => {
  const t = node('at://r/p/root', 'r', T0, [
    node('at://a/p/1', 'a', T1),
    node('at://a/p/1', 'a', T1),
  ]);
  assert.equal(collectReplies(t).length, 1);
});

test('collectReplies of a thread with no replies is []', () => {
  assert.deepEqual(collectReplies(node('at://r/p/root', 'r', T0)), []);
});

test('classifyThread recognizes ok, notFound and blocked', () => {
  assert.equal(classifyThread(node('at://r/p/1', 'r', T0)), 'ok');
  assert.equal(classifyThread({ notFound: true }), 'notFound');
  assert.equal(classifyThread({ $type: 'app.bsky.feed.defs#notFoundPost' }), 'notFound');
  assert.equal(classifyThread({ blocked: true }), 'blocked');
  assert.equal(classifyThread({ $type: 'app.bsky.feed.defs#blockedPost' }), 'blocked');
  assert.equal(classifyThread({}), 'notFound');
  assert.equal(classifyThread(undefined), 'notFound');
});

test('isNotFoundError matches NotFound errors only', () => {
  assert.equal(isNotFoundError({ error: 'NotFound' }), true);
  assert.equal(isNotFoundError({ message: 'Post not found' }), true);
  assert.equal(isNotFoundError({ status: 429 }), false);
  assert.equal(isNotFoundError(undefined), false);
});

test('findNewReplies: URIs in known and replies at or before knownBefore are not new', () => {
  const t = node('at://r/p/root', 'r', T0, [
    node('at://a/p/1', 'a', T1),
    node('at://b/p/2', 'b', T2),
    node('at://c/p/3', 'c', T3),
  ]);
  const replies = collectReplies(t);
  const { newReplies } = findNewReplies(
    replies,
    { known: ['at://b/p/2'], knownBefore: T1 },
    'did:me'
  );
  assert.deepEqual(
    newReplies.map((r) => r.rkey),
    ['3']
  );
  const none = findNewReplies(replies, { known: [], knownBefore: null }, 'did:me');
  assert.equal(none.newReplies.length, 3);
});

test('own replies are known but not new', () => {
  const replies = collectReplies(
    node('at://r/p/root', 'r', T0, [node('at://me/p/1', 'did:me', T1), node('at://a/p/2', 'a', T2)])
  );
  const { newReplies, ownNew } = findNewReplies(
    replies,
    { known: [], knownBefore: null },
    'did:me'
  );
  assert.deepEqual(
    ownNew.map((r) => r.authorDid),
    ['did:me']
  );
  assert.ok(!newReplies.some((r) => r.authorDid === 'did:me'));
  assert.equal(newReplies.length, 1);
});

test('atUriForWatch prefers uri, then builds from DID, else null', () => {
  assert.equal(atUriForWatch({ uri: 'at://x/y/z', authorDid: 'did:a', postId: '1' }), 'at://x/y/z');
  assert.equal(
    atUriForWatch({ uri: null, authorDid: 'did:a', postId: '1' }),
    'at://did:a/app.bsky.feed.post/1'
  );
  assert.equal(atUriForWatch({ uri: null, authorDid: null, postId: '1' }), null);
});
