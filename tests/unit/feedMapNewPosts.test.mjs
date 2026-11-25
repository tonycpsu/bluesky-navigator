import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeatLevelFn,
  formatRankBand,
  findNewPostsBoundary,
  newestPostId,
} from '../../src/handlers/feedMapUtils.js';

const ids = ['a', 'b', 'c', 'd', 'e'];
const all = [0, 1, 2, 3, 4];

test('newest first: posts above the anchor are new, divider before the anchor', () => {
  assert.deepEqual(findNewPostsBoundary(ids, all, 'c'), { index: 2, newCount: 2 });
});

test('oldest first: posts after the anchor are new, divider after the anchor', () => {
  // display order is oldest first: e d c b a
  const rev = ['e', 'd', 'c', 'b', 'a'];
  assert.deepEqual(findNewPostsBoundary(rev, all, 'c', true), { index: 3, newCount: 2 });
});

test('no divider when nothing is new, everything is new, or the anchor is not loaded', () => {
  assert.equal(findNewPostsBoundary(ids, all, 'a'), null);
  assert.equal(findNewPostsBoundary(['e', 'd', 'c', 'b', 'a'], all, 'a', true), null);
  assert.equal(findNewPostsBoundary(ids, all, 'zzz'), null);
  assert.equal(findNewPostsBoundary(ids, all, null), null);
  assert.equal(findNewPostsBoundary(ids, [0, 1], 'd'), null); // every shown post is new
});

test('a filtered (not displayed) anchor still places the divider among shown posts', () => {
  // c is hidden: displayed a b d e
  assert.deepEqual(findNewPostsBoundary(ids, [0, 1, 3, 4], 'c'), { index: 2, newCount: 2 });
  assert.deepEqual(findNewPostsBoundary(ids, [0, 1, 3, 4], 'c', true), { index: 2, newCount: 2 });
});

test('newestPostId takes the first ID in feed order and skips items without one', () => {
  assert.equal(newestPostId([null, 'x', 'y']), 'x');
  assert.equal(newestPostId(['x', 'y', null], true), 'y');
  assert.equal(newestPostId([]), null);
  assert.equal(newestPostId([null]), null);
});

test('rankOf reports shares at or above / at or below, and null without heat', () => {
  const levelOf = createHeatLevelFn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(levelOf.rankOf(10), { level: 5, atOrAbove: 0.1, atOrBelow: 1, n: 10 });
  assert.deepEqual(levelOf.rankOf(1), { level: 1, atOrAbove: 1, atOrBelow: 0.1, n: 10 });
  assert.equal(levelOf.rankOf(0), null);
  assert.equal(createHeatLevelFn([]).rankOf(5), null);
});

test('formatRankBand labels the side of the feed a post is on', () => {
  const levelOf = createHeatLevelFn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(formatRankBand(levelOf.rankOf(10)), 'top 10%');
  assert.equal(formatRankBand(levelOf.rankOf(6)), 'top 50%');
  assert.equal(formatRankBand(levelOf.rankOf(2)), 'bottom 20%');
  assert.equal(formatRankBand(createHeatLevelFn([4, 4, 4]).rankOf(4)), 'tied with every post');
  assert.equal(formatRankBand(createHeatLevelFn([4]).rankOf(4)), 'only post with engagement');
  assert.equal(formatRankBand(null), '');
});
