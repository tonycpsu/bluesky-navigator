import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHED_EMPTY_MESSAGE,
  safeAppPath,
  buildWatchedEntries,
  watchedPanelHtml,
} from '../../src/watch/watchedList.js';
import { NEEDS_LOGIN_MESSAGE } from '../../src/watch/watchCopy.js';

const NOW_MS = Date.parse('2026-11-27T12:00:00.000Z');
const MIN = 60000;
const ago = (ms) => new Date(NOW_MS - ms).toISOString();

function reply(rkey, handle, minsAgo, text, name = '') {
  return {
    uri: `at://did:plc:${handle}/app.bsky.feed.post/${rkey}`,
    rkey,
    authorDid: `did:plc:${handle}`,
    authorHandle: `${handle}.test`,
    authorName: name,
    authorAvatar: '',
    text,
    indexedAt: ago(minsAgo * MIN),
  };
}

function record(postId, overrides = {}) {
  return {
    postId,
    url: `/profile/owner.test/post/${postId}`,
    uri: null,
    authorDid: 'did:plc:owner',
    authorHandle: 'owner.test',
    snippet: `post ${postId}`,
    watchedAt: ago(3 * 60 * MIN),
    updatedAt: ago(0),
    lastActivityAt: ago(0),
    removedAt: null,
    baselined: true,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
    ...overrides,
  };
}

test('empty-state copy is the spec text', () => {
  assert.equal(
    WATCHED_EMPTY_MESSAGE,
    'No watched threads. Press w on a post, or click its bell, to watch it for new replies.'
  );
});

test('safeAppPath keeps app paths and refuses anything else', () => {
  assert.equal(safeAppPath('/profile/a.test/post/1'), '/profile/a.test/post/1');
  assert.equal(safeAppPath('/profile/a/post/b'), '/profile/a/post/b');
  // Both resolve to https://evil.example/x: a backslash reads as / and tabs/newlines are dropped
  assert.equal(safeAppPath('/\\evil.example/x'), '#');
  assert.equal(safeAppPath('/\t/evil.example/x'), '#');
  assert.equal(safeAppPath('/\n/evil.example/x'), '#');
  assert.equal(safeAppPath('//evil'), '#');
  assert.equal(safeAppPath('javascript:alert(1)'), '#');
  assert.equal(safeAppPath('//evil.example/x'), '#');
  assert.equal(safeAppPath('https://evil.example/'), '#');
  assert.equal(safeAppPath(null), '#');
});

test('buildWatchedEntries keeps the given order and builds the view model', () => {
  const a = record('a', { unseen: [reply('r1', 'alice', 10, 'first', 'Alice')] });
  const b = record('b', { authorHandle: null, unavailable: true });
  const entries = buildWatchedEntries([a, b], NOW_MS);
  assert.deepEqual(
    entries.map((e) => e.postId),
    ['a', 'b']
  );
  assert.deepEqual(entries[0], {
    postId: 'a',
    href: '/profile/owner.test/post/a',
    author: '@owner.test',
    snippet: 'post a',
    watchedLabel: 'Watched 3h',
    unavailable: false,
    replies: [
      {
        href: '/profile/alice.test/post/r1',
        name: 'Alice',
        handle: '@alice.test',
        text: 'first',
        time: '10m',
      },
    ],
  });
  // No handle: fall back to the DID; unavailable is carried through
  assert.equal(entries[1].author, 'did:plc:owner');
  assert.equal(entries[1].unavailable, true);
  assert.deepEqual(entries[1].replies, []);
});

test('a reply without a display name shows its handle as the name', () => {
  const [entry] = buildWatchedEntries(
    [record('a', { unseen: [reply('r1', 'bob', 1, 'x')] })],
    NOW_MS
  );
  assert.equal(entry.replies[0].name, 'bob.test');
});

test('panel: empty state, with the login notice when there is no API', () => {
  const withApi = watchedPanelHtml({ entries: [], hasApi: true });
  assert.ok(withApi.includes(WATCHED_EMPTY_MESSAGE));
  assert.ok(!withApi.includes(NEEDS_LOGIN_MESSAGE));

  const noApi = watchedPanelHtml({ entries: [], hasApi: false });
  assert.ok(noApi.includes(WATCHED_EMPTY_MESSAGE));
  assert.ok(noApi.includes(NEEDS_LOGIN_MESSAGE));
});

test('panel: login notice also shows above a non-empty list', () => {
  const entries = buildWatchedEntries([record('a')], NOW_MS);
  const html = watchedPanelHtml({ entries, hasApi: false });
  assert.ok(html.includes(NEEDS_LOGIN_MESSAGE));
  assert.ok(!html.includes(WATCHED_EMPTY_MESSAGE));
  assert.ok(html.indexOf(NEEDS_LOGIN_MESSAGE) < html.indexOf('data-post-id="a"'));
});

test('panel: entries in order, with copy, reply links and the right buttons', () => {
  const entries = buildWatchedEntries(
    [
      record('a', { unseen: [reply('r1', 'alice', 5, 'hello there', 'Alice')] }),
      record('b'),
      record('c', { unavailable: true }),
    ],
    NOW_MS
  );
  const html = watchedPanelHtml({ entries, hasApi: true });
  const order = [...html.matchAll(/data-post-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['a', 'b', 'c']);

  const parts = html.split('data-post-id=');
  const [, a, b, c] = parts;
  assert.ok(a.includes('href="/profile/owner.test/post/a"'));
  assert.ok(a.includes('@owner.test'));
  assert.ok(a.includes('Watched 3h'));
  assert.ok(a.includes('href="/profile/alice.test/post/r1"'));
  assert.ok(a.includes('hello there'));
  assert.ok(a.includes('5m'));
  assert.ok(a.includes('>Mark seen<'));
  assert.ok(a.includes('>Stop watching<'));

  assert.ok(!b.includes('Mark seen'));
  assert.ok(b.includes('>Stop watching<'));
  assert.ok(!b.includes('Post unavailable'));

  assert.ok(c.includes('Post unavailable'));
});

test('panel: escapes every piece of user text', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const entries = buildWatchedEntries(
    [
      record('p"1', {
        authorHandle: evil,
        snippet: evil,
        url: '/profile/x/post/"><script>',
        unseen: [{ ...reply('r"1', 'alice', 1, evil, evil), authorHandle: evil }],
      }),
    ],
    NOW_MS
  );
  const html = watchedPanelHtml({ entries, hasApi: true });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('p"1'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
});
