import test from 'node:test';
import assert from 'node:assert/strict';
import { planUnrolledPostScroll } from '../../src/handlers/unrollScroll.js';

// Fit on at 1400x1000, from the aresluna.org thread: item aligned at the toolbar line
// (84) and fitted to the status bar (953), unroll container at 94..944 (850 tall)
const fitted = {
  scrollTop: 0,
  scrollHeight: 4229,
  clientHeight: 850,
  containerTop: 94,
  itemTop: 84,
  itemBottom: 953,
  viewTop: 84,
  viewBottom: 953,
  padding: 16,
};

test('scrolls only the container when the item is fully in view', () => {
  // Sub-post 2 sits 530px down the container's content
  const plan = planUnrolledPostScroll({ ...fitted, postTop: 94 + 546, postHeight: 403 });
  assert.deepEqual(plan, { containerScrollTop: 530, pageDelta: 0 });
});

test('measures from the current container scroll position', () => {
  const plan = planUnrolledPostScroll({
    ...fitted,
    scrollTop: 530,
    postTop: 110 + 419,
    postHeight: 421,
  });
  assert.deepEqual(plan, { containerScrollTop: 949, pageDelta: 0 });
});

test('works upward (post above the container top)', () => {
  const plan = planUnrolledPostScroll({
    ...fitted,
    scrollTop: 949,
    postTop: 110 - 419,
    postHeight: 403,
  });
  assert.deepEqual(plan, { containerScrollTop: 530, pageDelta: 0 });
});

test('clamps the container scroll to its range', () => {
  const nearEnd = planUnrolledPostScroll({
    ...fitted,
    scrollTop: 3000,
    postTop: 900,
    postHeight: 40,
  });
  assert.equal(nearEnd.containerScrollTop, 4229 - 850);
  const nearStart = planUnrolledPostScroll({
    ...fitted,
    scrollTop: 0,
    postTop: 100,
    postHeight: 40,
  });
  assert.equal(nearStart.containerScrollTop, 0);
});

test('realigns the item header at the toolbar line when the page was scrolled away', () => {
  // Page scrolled 300px down: the item's header is under the toolbar
  const down = planUnrolledPostScroll({
    ...fitted,
    containerTop: -206,
    itemTop: -216,
    itemBottom: 653,
    postTop: -206 + 546,
    postHeight: 403,
  });
  assert.deepEqual(down, { containerScrollTop: 530, pageDelta: -300 });
  // Page scrolled 300px up: the item's bottom is below the status bar
  const up = planUnrolledPostScroll({
    ...fitted,
    containerTop: 394,
    itemTop: 384,
    itemBottom: 1253,
    postTop: 394 + 546,
    postHeight: 403,
  });
  assert.deepEqual(up, { containerScrollTop: 530, pageDelta: 300 });
});

test('leaves the page alone when a too-tall item is already aligned', () => {
  // Fit off in a short window: the item is taller than the view but its header is at the toolbar
  const plan = planUnrolledPostScroll({
    ...fitted,
    clientHeight: 360,
    scrollHeight: 2395,
    itemBottom: 463,
    viewBottom: 403,
    postTop: 94 + 546,
    postHeight: 403,
  });
  assert.deepEqual(plan, { containerScrollTop: 530, pageDelta: 0 });
});

test('ignores sub-pixel misalignment', () => {
  const plan = planUnrolledPostScroll({
    ...fitted,
    itemTop: 85.5,
    itemBottom: 2000,
    postTop: 640,
    postHeight: 100,
  });
  assert.equal(plan.pageDelta, 0);
});

test('scrolls the page to the post when the container cannot bring it on screen', () => {
  // Container doesn't overflow and the item is far taller than the view: aligning the
  // header would leave the post below the status bar, so the post goes to the toolbar line
  const plan = planUnrolledPostScroll({
    scrollTop: 0,
    scrollHeight: 3000,
    clientHeight: 3000,
    containerTop: 94,
    itemTop: 84,
    itemBottom: 3200,
    postTop: 2000,
    postHeight: 300,
    viewTop: 84,
    viewBottom: 953,
    padding: 16,
  });
  assert.deepEqual(plan, { containerScrollTop: 0, pageDelta: 1916 });
});
