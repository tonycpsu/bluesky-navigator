import test from 'node:test';
import assert from 'node:assert/strict';
import {
  watchRecordId,
  buildWatchUpsertStatements,
  buildWatchSelectQuery,
  parseWatchRows,
  buildWatchCleanupQuery,
} from '../../src/watch/watchRemote.js';

const NOW = '2026-11-27T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY = 24 * 60 * 60 * 1000;

function record(postId, overrides = {}) {
  return {
    postId,
    url: `/profile/alice.test/post/${postId}`,
    uri: null,
    authorDid: null,
    authorHandle: 'alice.test',
    snippet: 'Hello "world"',
    watchedAt: NOW,
    updatedAt: NOW,
    lastActivityAt: NOW,
    removedAt: null,
    baselined: false,
    knownBefore: null,
    known: [],
    unseen: [],
    unavailable: false,
    ...overrides,
  };
}

test('watchRecordId maps "-" and other characters to "_"', () => {
  assert.equal(watchRecordId('3k-a.b'), 'watch:3k_a_b');
  assert.equal(watchRecordId('3kabc'), 'watch:3kabc');
});

test('buildWatchUpsertStatements upserts valid records and skips invalid ids or timestamps', () => {
  const good = record('3kgood');
  const tomb = record('3ktomb', { removedAt: NOW });
  const { statements, skipped } = buildWatchUpsertStatements([
    good,
    tomb,
    record('bad id;'),
    record('3knowatch', { watchedAt: 'yesterday' }),
    record('3knoupdate', { updatedAt: undefined }),
    record('3kbadremoved', { removedAt: 'soon' }),
  ]);
  assert.deepEqual(statements, [
    `UPSERT watch:3kgood CONTENT ${JSON.stringify(good)};`,
    `UPSERT watch:3ktomb CONTENT ${JSON.stringify(tomb)};`,
  ]);
  assert.deepEqual(skipped, ['bad id;', '3knowatch', '3knoupdate', '3kbadremoved']);
});

test('buildWatchUpsertStatements writes no lone surrogates', () => {
  const broken = record('3kemoji', {
    snippet: 'cut \ud83d',
    unseen: [{ uri: 'u', text: '\ude00x' }],
  });
  const { statements } = buildWatchUpsertStatements([broken]);
  assert.equal(statements.length, 1);
  assert.doesNotMatch(statements[0], /\\ud[89a-f][0-9a-f]{2}/i);
  assert.equal(statements[0].isWellFormed(), true);
  const content = JSON.parse(statements[0].replace(/^UPSERT \S+ CONTENT /, '').replace(/;$/, ''));
  assert.equal(content.snippet, 'cut \ufffd');
  assert.equal(content.unseen[0].text, '\ufffdx');
  // A whole emoji is kept as is
  const ok = buildWatchUpsertStatements([record('3kok', { snippet: 'hi \u{1F600}' })]);
  assert.ok(ok.statements[0].includes('hi \u{1F600}'));
});

test('buildWatchUpsertStatements replaces lone surrogates without toWellFormed', () => {
  const original = String.prototype.toWellFormed;
  delete String.prototype.toWellFormed;
  try {
    const { statements } = buildWatchUpsertStatements([
      record('3kold', { snippet: 'a\ud83d b\ude00 c\u{1F600}' }),
    ]);
    const content = JSON.parse(statements[0].replace(/^UPSERT \S+ CONTENT /, '').replace(/;$/, ''));
    assert.equal(content.snippet, 'a\ufffd b\ufffd c\u{1F600}');
  } finally {
    String.prototype.toWellFormed = original;
  }
});

test('buildWatchSelectQuery selects all or only valid ids', () => {
  assert.equal(buildWatchSelectQuery(), 'SELECT * FROM watch;');
  assert.equal(
    buildWatchSelectQuery(['3k-a', 'bad id;', '3kb']),
    'SELECT * FROM watch:3k_a, watch:3kb;'
  );
  assert.equal(buildWatchSelectQuery(['bad id;']), null);
  assert.equal(buildWatchSelectQuery([]), null);
});

test('parseWatchRows drops id, invalid rows and fills missing arrays', () => {
  const full = record('3ka', { known: ['at://x/app.bsky.feed.post/r1'] });
  const rows = [
    { id: 'watch:3ka', ...full },
    { id: 'watch:3kb', ...record('3kb'), known: undefined, unseen: null },
    { id: 'watch:bad', ...record('bad id;') },
    { id: 'watch:none', url: '/x' },
    null,
  ];
  const map = parseWatchRows(rows);
  assert.deepEqual(Object.keys(map).sort(), ['3ka', '3kb']);
  assert.deepEqual(map['3ka'], full);
  assert.equal('id' in map['3kb'], false);
  assert.deepEqual(map['3kb'].known, []);
  assert.deepEqual(map['3kb'].unseen, []);
  assert.deepEqual(parseWatchRows(undefined), {});
});

test('parseWatchRows normalizes timestamps to toISOString form', () => {
  const rows = [
    {
      ...record('3kts'),
      watchedAt: '2026-11-27T12:00:00Z',
      updatedAt: '2026-11-27T12:00:00.5Z',
      lastActivityAt: '2026-11-27T13:00:00+01:00',
      removedAt: '2026-11-27T12:00:00Z',
      knownBefore: '2026-11-27T12:00:00Z',
      unseen: [{ uri: 'u', indexedAt: '2026-11-27T12:00:00Z' }],
    },
    { ...record('3knull'), removedAt: null, knownBefore: null },
  ];
  const map = parseWatchRows(rows);
  assert.equal(map['3kts'].watchedAt, NOW);
  assert.equal(map['3kts'].updatedAt, '2026-11-27T12:00:00.500Z');
  assert.equal(map['3kts'].lastActivityAt, NOW);
  assert.equal(map['3kts'].removedAt, NOW);
  assert.equal(map['3kts'].knownBefore, NOW);
  assert.equal(map['3kts'].unseen[0].indexedAt, NOW);
  assert.equal(map['3knull'].removedAt, null);
  assert.equal(map['3knull'].knownBefore, null);
});

test('buildWatchCleanupQuery uses a 30-day cutoff', () => {
  const cutoff = new Date(NOW_MS - 30 * DAY).toISOString();
  assert.equal(
    buildWatchCleanupQuery(NOW_MS),
    `DELETE watch WHERE removedAt != NONE AND removedAt != NULL AND removedAt < "${cutoff}";`
  );
});
