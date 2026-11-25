import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeatLevelFn, HEAT_LEVELS, HEAT_CLASSES } from '../../src/handlers/feedMapUtils.js';

const levelsOf = (scores) => scores.map(createHeatLevelFn(scores));

test('HEAT_LEVELS is 5 and HEAT_CLASSES lists heat-1 through heat-5', () => {
  assert.equal(HEAT_LEVELS, 5);
  assert.equal(
    HEAT_CLASSES,
    'feed-map-segment-heat-1 feed-map-segment-heat-2 feed-map-segment-heat-3 ' +
      'feed-map-segment-heat-4 feed-map-segment-heat-5'
  );
});

test('zero, negative and NaN scores get level 0 and are left out of the ranking', () => {
  assert.deepEqual(levelsOf([0, -3, NaN, 1, 2, 3, 4, 5]), [0, 0, 0, 1, 2, 3, 4, 5]);
  const levelOf = createHeatLevelFn([10, 20]);
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(-1), 0);
  assert.equal(levelOf(NaN), 0);
  assert.equal(levelOf(undefined), 0);
});

test('no positive scores means no heat', () => {
  assert.equal(createHeatLevelFn([])(5), 0);
  assert.deepEqual(levelsOf([0, 0, NaN]), [0, 0, 0]);
});

test('levels split the posts into equal quantiles', () => {
  const scores = Array.from({ length: 150 }, (_, i) => (i + 1) ** 3); // heavy-tailed
  const counts = new Array(HEAT_LEVELS + 1).fill(0);
  for (const level of levelsOf(scores)) counts[level]++;
  assert.deepEqual(counts, [0, 30, 30, 30, 30, 30]);
  assert.deepEqual(levelsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('ranking ignores the input order and the scale of the scores', () => {
  assert.deepEqual(levelsOf([5, 1, 4, 2, 3]), [5, 1, 4, 2, 3]);
  assert.deepEqual(levelsOf([0.01, 0.02, 0.03, 0.04, 0.05]), levelsOf([10, 2000, 3e4, 4e5, 5e6]));
});

test('tied scores get the same level (mid-rank)', () => {
  // Six tied posts span ranks 0-6 of 10; their mid-rank (30%) is level 2
  assert.deepEqual(levelsOf([1, 1, 1, 1, 1, 1, 2, 3, 4, 5]), [2, 2, 2, 2, 2, 2, 4, 4, 5, 5]);
});

test('the highest score, tied or not, always gets the top level', () => {
  assert.deepEqual(levelsOf([1, 2, 3, 9, 9]), [1, 2, 3, 5, 5]);
  assert.deepEqual(levelsOf([4, 4, 4, 4, 4, 4, 4, 4]), [5, 5, 5, 5, 5, 5, 5, 5]);
});

test('fewer posts than levels fill the top levels without gaps', () => {
  assert.deepEqual(levelsOf([7]), [5]);
  assert.deepEqual(levelsOf([1, 9]), [4, 5]);
  assert.deepEqual(levelsOf([1, 2, 3]), [3, 4, 5]);
  assert.deepEqual(levelsOf([1, 2, 3, 4]), [2, 3, 4, 5]);
  assert.deepEqual(levelsOf([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
});

test('scores outside the ranked population are placed where they would fall', () => {
  const levelOf = createHeatLevelFn([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(levelOf(1), 1);
  assert.equal(levelOf(1000), HEAT_LEVELS);
  assert.equal(levelOf(Infinity), HEAT_LEVELS);
  assert.equal(levelOf(55), 3);
});

test('levels are monotonic in score', () => {
  const scores = Array.from({ length: 97 }, (_, i) => Math.floor(Math.sqrt(i * 13)));
  const levelOf = createHeatLevelFn(scores);
  let prev = 0;
  for (let s = 0; s <= 40; s += 0.5) {
    const level = levelOf(s);
    assert.ok(level >= prev, `level dropped at score ${s}`);
    assert.ok(level >= 0 && level <= HEAT_LEVELS);
    prev = level;
  }
});
