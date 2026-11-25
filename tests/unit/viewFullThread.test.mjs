import test from 'node:test';
import assert from 'node:assert/strict';
import {
  postIdFromViewFullThreadHref,
  resolveViewFullThreadOwners,
  orderFeedRows,
  viewFullThreadRowsToHide,
} from '../../src/handlers/viewFullThread.js';

// Row descriptors in the shape the handler builds from the DOM
const post = (name, sortIndex, itemIndex, opts = {}) => ({
  kind: 'post',
  name,
  sortIndex,
  itemIndex,
  first: opts.first ?? false,
  last: opts.last ?? false,
  postId: opts.postId ?? null,
  hidden: opts.hidden ?? false,
});
const root = (name, sortIndex, itemIndex, opts = {}) =>
  post(name, sortIndex, itemIndex, { first: true, postId: name, ...opts });
const reply = (name, sortIndex, itemIndex, opts = {}) =>
  post(name, sortIndex, itemIndex, { last: true, postId: name, ...opts });
const single = (name, sortIndex, itemIndex, opts = {}) =>
  post(name, sortIndex, itemIndex, { first: true, last: true, postId: name, ...opts });
const vft = (name, postId, opts = {}) => ({
  kind: 'vft',
  name,
  postId,
  stampedSortIndex: opts.stampedSortIndex ?? null,
  owner: opts.owner ?? null,
});
const other = (name) => ({ kind: 'other', name });
const names = (rows) => rows.map((r) => r.name);

test('postIdFromViewFullThreadHref takes the rkey of a post link', () => {
  assert.equal(postIdFromViewFullThreadHref('/profile/did:plc:abc/post/3kxyz'), '3kxyz');
  assert.equal(
    postIdFromViewFullThreadHref('https://bsky.app/profile/a.b/post/3kxyz?ref=x#y'),
    '3kxyz'
  );
  assert.equal(postIdFromViewFullThreadHref('/profile/did:plc:abc'), null);
  assert.equal(postIdFromViewFullThreadHref(null), null);
});

test('owner is the thread-first row whose post the link points to', () => {
  const A = root('A', 1, 0);
  const C = post('C', 1, 1, { postId: 'C' });
  const D = reply('D', 1, 2);
  const V = vft('V', 'A');
  const owners = resolveViewFullThreadOwners([other('header'), A, V, C, D]);
  assert.equal(owners.get(V), A);
});

test('owner is found by post id even after a sort separated the link from its root', () => {
  const A = root('A', 1, 0);
  const C = post('C', 1, 1, { postId: 'C' });
  const D = reply('D', 1, 2);
  const E = single('E', 2, 3);
  const V = vft('V', 'A');
  const owners = resolveViewFullThreadOwners([A, C, D, E, V, other('loader')]);
  assert.equal(owners.get(V), A);
});

test('a duplicated root prefers the stamped group, then the adjacent row', () => {
  const A1 = root('A', 1, 0);
  const A1r = reply('x', 1, 1);
  const A2 = root('A', 5, 2);
  const A2r = reply('y', 5, 3);
  const adjacent = vft('V1', 'A');
  const stamped = vft('V2', 'A', { stampedSortIndex: 1 });
  const owners = resolveViewFullThreadOwners([A1, A1r, A2, adjacent, A2r, stamped]);
  assert.equal(owners.get(adjacent), A2);
  assert.equal(owners.get(stamped), A1);
});

test('without post ids the adjacent thread-first row owns the link; otherwise it is an orphan', () => {
  const A = post('A', 1, 0, { first: true });
  const C = post('C', 1, 1, { last: true });
  const S = post('S', 2, 2, { first: true, last: true });
  const V = vft('V', null);
  const W = vft('W', null);
  const X = vft('X', 'gone');
  const owners = resolveViewFullThreadOwners([A, V, C, S, W, X]);
  assert.equal(owners.get(V), A);
  assert.equal(owners.get(W), null, 'a standalone post does not own a link');
  assert.equal(owners.get(X), null, 'no row for the linked post');
});

test('orderFeedRows keeps each link right after its root, forward and reversed', () => {
  const A = root('A', 1, 0);
  const C = post('C', 1, 2, { postId: 'C' });
  const D = reply('D', 1, 3);
  const E = single('E', 2, 4);
  const F = root('F', 3, 5);
  const G = reply('G', 3, 7);
  const VA = vft('VA', 'A', { owner: A });
  const VF = vft('VF', 'F', { owner: F });

  const forward = orderFeedRows([G, E, D, C, A, F], [VF, VA], false);
  assert.deepEqual(names(forward.order), ['A', 'VA', 'C', 'D', 'E', 'F', 'VF', 'G']);
  assert.deepEqual(forward.orphans, []);

  const reversed = orderFeedRows([A, C, D, E, F, G], [VA, VF], true);
  assert.deepEqual(names(reversed.order), ['F', 'VF', 'G', 'E', 'A', 'VA', 'C', 'D']);
});

test('orderFeedRows returns links whose root is not a row as orphans, unplaced', () => {
  const A = root('A', 1, 0);
  const D = reply('D', 1, 1);
  const lost = vft('lost', 'Z', { owner: null });
  const stale = vft('stale', 'Q', { owner: root('Q', 9, 9) });
  const { order, orphans } = orderFeedRows([A, D], [lost, stale], false);
  assert.deepEqual(names(order), ['A', 'D']);
  assert.deepEqual(names(orphans), ['lost', 'stale']);
});

test('orderFeedRows orders posts exactly like before (sort index, then item index)', () => {
  const rows = [single('b', 2, 1), single('a', 1, 5), single('c', 2, 0), single('d', 1.5, 3)];
  assert.deepEqual(names(orderFeedRows(rows, [], false).order), ['a', 'd', 'c', 'b']);
  assert.deepEqual(names(orderFeedRows(rows, [], true).order), ['c', 'b', 'd', 'a']);
});

test('a link shows only when its root and the next post of its thread both show', () => {
  const build = (hide = {}) => {
    const A = root('A', 1, 0, { hidden: !!hide.A });
    const C = post('C', 1, 1, { postId: 'C', hidden: !!hide.C });
    const D = reply('D', 1, 2, { hidden: !!hide.D });
    const V = vft('V', 'A', { owner: A });
    return { V, rows: [other('header'), A, V, C, D, other('loader')] };
  };
  let { V, rows } = build();
  assert.deepEqual([...viewFullThreadRowsToHide(rows)], []);
  ({ V, rows } = build({ D: true }));
  assert.deepEqual(
    [...viewFullThreadRowsToHide(rows)],
    [],
    'reply hidden: root -> parent still connect'
  );
  ({ V, rows } = build({ A: true }));
  assert.deepEqual([...viewFullThreadRowsToHide(rows)], [V], 'root hidden');
  ({ V, rows } = build({ C: true }));
  assert.deepEqual([...viewFullThreadRowsToHide(rows)], [V], 'parent hidden');
  ({ V, rows } = build({ A: true, C: true, D: true }));
  assert.deepEqual([...viewFullThreadRowsToHide(rows)], [V], 'everything filtered');
});

test('a link is hidden when it is out of place or has no owner', () => {
  const A = root('A', 1, 0);
  const D = reply('D', 1, 1);
  const E = single('E', 2, 2);
  const misplaced = vft('m', 'A', { owner: A });
  const orphan = vft('o', 'Z', { owner: null });
  const endOfThread = vft('e', 'E', { owner: E });
  const hidden = viewFullThreadRowsToHide([A, D, misplaced, E, endOfThread, orphan]);
  assert.deepEqual(names([...hidden]), ['m', 'e', 'o']);
});
