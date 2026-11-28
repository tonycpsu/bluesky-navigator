# Watch Threads for New Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner watch a post (bell button or `w`) and get told about new replies anywhere below it, through toasts, a Watched tab on `/notifications`, a sidebar badge, and a hide-read exemption in the feed.

**Architecture:** Pure logic lives in small modules under `src/watch/` (reply-tree diff, per-record watch merge, toast copy, remote query builders), each unit tested with `node --test`. A `WatchStore` owns the `bluesky_navigator_watches` GM key and a per-record `watch` remote table modeled on `seen`. A `WatchPoller` calls `getThread` one watch at a time. A `WatchService` singleton ties these together and dispatches `bsky-nav-watch-changed`, which the DOM pieces (bell, feed filter, Watched tab, badge) listen for.

**Tech Stack:** Vanilla ES modules + jQuery (userscript), vite build, `@atproto/api` `BskyAgent.getPostThread`, SurrealDB `/sql` via `StateManager.postRemoteQuery`, `node:test`, Playwright e2e (CI only).

**Spec:** [docs/superpowers/specs/2026-11-27-watch-threads-design.md](../specs/2026-11-27-watch-threads-design.md)

## Global Constraints

- Never run `git stash`, in any form.
- Never stage or commit `.claude/settings.local.json`.
- Do not commit. Every task ends with "Leave changes uncommitted"; the owner commits only on explicit request. `dist/` is rebuilt by the pre-commit hook; don't hand-edit it.
- Allowed verification commands: `node --test tests/unit/`, `npm run build`, `npx eslint <files>`, `npx prettier --check <new files>`. Do NOT run `npm test` (Playwright needs the logged-in CI). E2E specs are written here and run by the owner/CI.
- Prettier: new files must pass `npx prettier --check`. Most existing files already fail it (`main.js`, `ItemHandler.js`, `FeedItemHandler.js`, `ConfigModal.js`, `api.js`, `StateManager.js`, `ShortcutOverlay.js`), so never `--write` an existing file; match the surrounding style in edits.
- ESLint: baseline is 31 errors / 62 warnings across `main.js`, `ItemHandler.js`, `FeedItemHandler.js`, `StateManager.js`, `api.js`. Add no new errors (compare counts before and after your task).
- Unit tests: baseline 42 passing. Tests are `tests/unit/<name>.test.mjs`, `import test from 'node:test'` + `import assert from 'node:assert/strict'`, importing from `../../src/...`. Pure modules must not touch `window`, `document`, `$`, `GM_*` at import time.
- Code style: semicolons, single quotes, 2-space indent, 100 columns (`.prettierrc`); JSDoc on exported functions.
- US English in code comments and UI copy (color, behavior, canceled).
- Caps (owner-approved values): **50** watched posts; **2,000** known reply URIs per watch; a watch with no new replies for **30 days** expires; poll **every 3 minutes** by default; thread depth **50**.
- UI copy fixed by the spec: bell tooltips "Watch for new replies" / "Stop watching"; toasts "@alice replied in a thread you're watching" (one reply) and "3 new replies in a thread you're watching" (several); tab name "Watched"; per-entry buttons "Mark seen" and "Stop watching"; settings label "Watch threads".
- Watch toasts never mark Bluesky notifications seen. Dismissing a watch toast without clicking (timeout, `x`, close button) does not mark its replies seen.
- No cross-tab messaging, no `GM_addValueChangeListener`; local saves re-read and merge instead.
- Without the app-password login (`api` undefined in `src/main.js:1026-1041`) watching still works locally but nothing polls.

## Review Focus

1. **The owner's own replies in a watched thread** must never count as new: no toast, no badge, no unseen entry. They are added to the known set silently. Test: Task 1 `findNewReplies` "own replies are known but not new".
2. **Page load after a long absence**, with many watched threads that all got replies, must not bury the screen: at most 5 watch toasts per check round, the 5th being a summary ("4 more watched threads have new replies") that opens the Watched tab. Test: Task 3 `planRoundToasts` "caps toasts at 5 with a summary".
3. **Clicking the bell in a feed item** must not open the post, mark it read or move the selection: the click is consumed in the capture phase. Test: Task 8 e2e "clicking the bell does not navigate".
4. **A busy thread that exceeds the 2,000 known-URI cap** must never re-report old replies as new once the cap trims the set. Test: Task 2 `applyCheck` "overflow collapses known into knownBefore and nothing old reappears".
5. **The 51st watch** must be refused, leave the bell outlined and say why ("You can watch up to 50 threads. Stop watching one first."). Test: Task 6 `watch()` "refuses past the limit".

---

## File Structure

Create (all under `src/watch/`):

| File | Responsibility |
|---|---|
| `replyTree.js` | Pure: classify a `getThread` result, collect all reply nodes below the root, diff against a watch's known set |
| `watchRecords.js` | Pure: watch record shape, caps, check application, seen, tombstones, merge, prune, list order |
| `watchCopy.js` | Pure: toast objects and grouping, bell labels, relative time, URL/path helpers |
| `watchRemote.js` | Pure: SurrealQL builders and row parsing for the `watch` table |
| `WatchStore.js` | GM key read/merge/write, debounced remote push (read-merge-write), remote load at init |
| `WatchPoller.js` | Timed, sequential `getThread` checks with injected timers/visibility |
| `WatchService.js` | Singleton glue: public watch API, toasts, change event |
| `watchButton.js` | DOM: bell in the action row, delegated clicks, refresh |
| `WatchedTab.js` | DOM: Watched tab and list on `/notifications` |
| `watchBadge.js` | DOM: count badge on the Notifications nav link |

Modify: `src/api.js` (`getThread` options), `src/main.js` (init, toasts, settings save, post-page seen), `src/components/ConfigModal.js` (two fields), `src/handlers/Handler.js` (`W`), `src/handlers/ItemHandler.js` (bell pass, `w`, change listener), `src/handlers/FeedItemHandler.js` (hide-read exemption), `src/components/ShortcutOverlay.js`, `src/assets/css/style.css`, `doc/remote_state.md`, `AGENTS.md` (remote sync section).

### Shared data shapes

```js
// ReplyInfo: one reply found in a thread
{ uri, rkey, authorDid, authorHandle, authorName, authorAvatar, text /* ≤100 chars */, indexedAt }

// WatchInfo: what the UI knows about a post when watching it
{ postId /* rkey */, url /* '/profile/<handle|did>/post/<rkey>' */, authorDid /* or null */,
  authorHandle /* or null */, snippet /* ≤100 chars */ }

// WatchRecord: one per watched post, keyed by postId (rkey, like `seen`)
{ postId, url, uri /* at:// or null until resolved */, authorDid, authorHandle, snippet,
  watchedAt, updatedAt, lastActivityAt,      // ISO strings
  removedAt,        // ISO or null; set = tombstone
  baselined,        // false until the first successful check
  knownBefore,      // ISO or null; replies indexed at or before it count as known
  known,            // string[] of reply URIs, oldest first, ≤ 2,000
  unseen,           // ReplyInfo[], oldest first, ≤ 200
  unavailable }     // true once the post is not found / blocked; never polled again

// WatchMap: { [postId]: WatchRecord }   (live records and tombstones)
```

Records are keyed by rkey (`postId`), matching `state.seen` and `postIdForItem()`, because feed URLs usually carry a handle, not a DID. The at:// URI is filled in when known (DID in the DOM) or resolved by the poller.

---

### Task 1: Reply-tree diff

**Files:**
- Create: `src/watch/replyTree.js`
- Test: `tests/unit/watchReplyTree.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `THREAD_DEPTH = 50`
  - `classifyThread(thread) -> 'ok' | 'notFound' | 'blocked'`: `notFound` for `thread.notFound` or `$type` ending `#notFoundPost`, `blocked` for `thread.blocked` or `#blockedPost`, `ok` when `thread.post` exists, else `notFound`.
  - `isNotFoundError(error) -> boolean`: `error.error === 'NotFound'` or `/not found/i` in `error.message`.
  - `collectReplies(thread) -> ReplyInfo[]`: every node with `.post` below the root, at any depth, deduplicated by URI, sorted by `indexedAt` ascending. Nodes without `.post` (blocked/not-found replies) are skipped along with their (absent) children. `rkey` is the last URI segment; `text` is `post.record.text` cut to 100 chars.
  - `findNewReplies(replies, record, selfDid) -> { newReplies: ReplyInfo[], ownNew: ReplyInfo[] }`: a reply is known if its URI is in `record.known` or `record.knownBefore && reply.indexedAt <= record.knownBefore`. Unknown replies whose `authorDid === selfDid` go to `ownNew`, the rest to `newReplies`.
  - `atUriForWatch(record) -> string | null`: `record.uri`, else `at://${authorDid}/app.bsky.feed.post/${postId}` when `authorDid` is set, else null.

- [ ] **Step 1: Write the failing tests** in `tests/unit/watchReplyTree.test.mjs`. Build fixtures with a small helper `node(uri, did, indexedAt, replies = [])` returning `{ post: { uri, author: { did, handle: did + '.test', displayName: 'N' }, record: { text: 'x'.repeat(150) }, indexedAt }, replies }`.

```js
test('collectReplies walks every depth, skips nodes without a post, sorts by indexedAt', () => {
  const t = node('at://r/p/root', 'r', T0, [
    node('at://a/p/1', 'a', T2, [node('at://b/p/2', 'b', T1, [node('at://c/p/3', 'c', T3)])]),
    { $type: 'app.bsky.feed.defs#blockedPost', uri: 'at://x/p/9', blocked: true },
  ]);
  assert.deepEqual(collectReplies(t).map((r) => r.rkey), ['2', '1', '3']);
  assert.equal(collectReplies(t)[0].text.length, 100);
});
test('collectReplies dedupes a URI that appears twice', ...);           // length 1
test('collectReplies of a thread with no replies is []', ...);
test('classifyThread recognizes ok, notFound and blocked', ...);        // incl. { notFound: true }, { $type: '...#blockedPost' }, undefined -> 'notFound'
test('isNotFoundError matches NotFound errors only', ...);              // { error: 'NotFound' } true, { message: 'Post not found' } true, { status: 429 } false
test('findNewReplies: URIs in known and replies at or before knownBefore are not new', ...);
test('own replies are known but not new', () => {
  const { newReplies, ownNew } = findNewReplies(replies, rec, 'did:me');
  assert.deepEqual(ownNew.map((r) => r.authorDid), ['did:me']);
  assert.ok(!newReplies.some((r) => r.authorDid === 'did:me'));
});
test('atUriForWatch prefers uri, then builds from DID, else null', ...);
```

- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/unit/watchReplyTree.test.mjs` — Expected: FAIL, cannot find module `src/watch/replyTree.js`.
- [ ] **Step 3: Implement** the five exports in `src/watch/replyTree.js` (iterative stack walk, `Map` for dedupe).
- [ ] **Step 4: Run to verify they pass.** Run: `node --test tests/unit/` — Expected: all pass (42 + new).
- [ ] **Step 5: Lint.** Run: `npx eslint src/watch/replyTree.js && npx prettier --check src/watch/replyTree.js tests/unit/watchReplyTree.test.mjs` — Expected: no errors.
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 2: Watch records — check, seen, tombstones, merge, caps

**Files:**
- Create: `src/watch/watchRecords.js`
- Test: `tests/unit/watchRecords.test.mjs`

**Interfaces:**
- Consumes: `findNewReplies` from Task 1.
- Produces:
  - Constants: `MAX_WATCHES = 50`, `MAX_KNOWN_REPLIES = 2000`, `MAX_UNSEEN_REPLIES = 200`, `WATCH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000`, `WATCH_TOMBSTONE_TTL_MS` (same 30 days).
  - `createWatch(info: WatchInfo, nowIso) -> WatchRecord` (`baselined: false`, empty `known`/`unseen`, `watchedAt = updatedAt = lastActivityAt = nowIso`, `removedAt: null`, `unavailable: false`, `uri` from `atUriForWatch`).
  - `isLive(record) -> boolean`, `liveWatches(map) -> WatchRecord[]`, `canAddWatch(map) -> boolean` (live count < 50).
  - `applyCheck(record, replies: ReplyInfo[], { nowIso, selfDid }) -> { record, newReplies }`
  - `markUnavailable(record, nowIso) -> record`, `markWatchSeen(record, nowIso) -> record` (empties `unseen`), `removeWatch(record, nowIso) -> tombstone`
  - `mergeWatch(a, b) -> record`, `mergeWatchMaps(a: WatchMap, b: WatchMap) -> WatchMap`, `changedIds(before: WatchMap, after: WatchMap) -> Set<postId>` (stable-JSON comparison)
  - `pruneWatches(map, nowMs) -> WatchMap`
  - `unseenTotal(map) -> number`, `unseenCountFor(map, postId) -> number`, `sortForList(map) -> WatchRecord[]`

`applyCheck` rules (inputs fixed, return new objects, never mutate):
- Not baselined: every current reply becomes known (`known` = their URIs), `baselined = true`, `newReplies = []`.
- Baselined: `findNewReplies`; append `newReplies` and `ownNew` URIs to `known`; append `newReplies` to `unseen` (keep the newest 200); if any `newReplies`, `lastActivityAt = nowIso`.
- Overflow: if `known` would exceed 2,000, set `knownBefore` to the max `indexedAt` among `replies` (and the old `knownBefore`), and `known` to the URIs of replies newer than that (normally none). Unseen entries are untouched.
- `updatedAt = nowIso` only when something changed.

`mergeWatch(a, b)` rules (missing side → the other):
- `epoch = max(watchedAt)`, `removed = max(removedAt)`. If `removed >= epoch`, the result is a tombstone with that `removedAt`.
- Otherwise drop any copy whose `watchedAt <= removed` (it belongs to an earlier, unwatched epoch), then: `known` = union (order: a's then b's new ones; trim to the newest 2,000), `knownBefore` = max, `baselined` = OR, `unavailable` = OR, `lastActivityAt`/`updatedAt` = max, `uri` = first non-null, other metadata from the copy with the newer `updatedAt`.
- `unseen` = union by URI, minus any reply that some copy *knows* (URI in its `known` or `indexedAt <= its knownBefore`) but does not list as unseen. That is "seen anywhere stays seen".

`pruneWatches`: a live watch whose `lastActivityAt` is older than 30 days becomes a tombstone (`removedAt = now`); tombstones whose `removedAt` is older than 30 days are deleted; if more than 50 live remain, tombstone the oldest by `lastActivityAt`.

`sortForList`: live only; watches with unseen replies first, ordered by newest unseen `indexedAt` desc; then the rest by `lastActivityAt` desc.

- [ ] **Step 1: Write the failing tests** in `tests/unit/watchRecords.test.mjs` (fixed `NOW = '2026-11-27T12:00:00.000Z'`):

```js
test('createWatch starts unbaselined with empty sets', ...);
test('first applyCheck baselines: all current replies known, none new', () => {
  const { record, newReplies } = applyCheck(createWatch(info, NOW), [r1, r2], { nowIso: NOW });
  assert.deepEqual(newReplies, []);
  assert.deepEqual(record.known, [r1.uri, r2.uri]);
  assert.equal(record.baselined, true);
});
test('later applyCheck reports only unknown replies and records them unseen', ...);
test('applyCheck with nothing new leaves updatedAt and lastActivityAt unchanged', ...);
test('unseen keeps the newest 200', ...);
test('overflow collapses known into knownBefore and nothing old reappears', () => {
  // 2,001 replies baselined -> known.length <= 2000 and knownBefore = newest indexedAt
  // then applyCheck with the same 2,001 plus one newer reply -> newReplies is exactly [newer]
});
test('own replies are added to known without becoming unseen', ...);   // applyCheck(..., { selfDid: 'did:me' })
test('markWatchSeen empties unseen; removeWatch makes a tombstone', ...);
test('merge: tombstone newer than watchedAt wins over a stale live copy', ...);
test('merge: re-watch after the tombstone wins and ignores the pre-tombstone copy', ...);
test('merge: known sets are unioned', ...);
test('merge: a reply seen on either copy stays seen', () => {
  // a: known [u1], unseen []   (seen on a)    b: known [u1], unseen [u1]
  assert.deepEqual(mergeWatch(a, b).unseen, []);
});
test('merge: a reply only one copy has discovered stays unseen', ...);
test('mergeWatchMaps keeps ids from both maps; changedIds lists only differing records', ...);
test('pruneWatches expires watches idle for 30 days and drops old tombstones', ...);
test('pruneWatches keeps at most 50 live watches', ...);
test('canAddWatch is false at 50 live watches, tombstones do not count', ...);
test('sortForList puts unseen first, newest activity first, and omits tombstones', ...);
test('unseenTotal and unseenCountFor count live watches only', ...);
```

- [ ] **Step 2: Run to verify they fail.** `node --test tests/unit/watchRecords.test.mjs` — FAIL, module not found.
- [ ] **Step 3: Implement** `src/watch/watchRecords.js` per the rules above. Use a local `timeOf(iso)` like `src/StateManager.js:30`.
- [ ] **Step 4: Run.** `node --test tests/unit/` — all pass.
- [ ] **Step 5: Lint** the two new files (eslint + prettier --check).
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 3: Toast copy, grouping and small helpers

**Files:**
- Create: `src/watch/watchCopy.js`
- Test: `tests/unit/watchCopy.test.mjs`

**Interfaces:**
- Consumes: `WatchRecord`, `ReplyInfo` shapes.
- Produces:
  - `MAX_ROUND_TOASTS = 5`, `WATCHED_TAB_URL = '/notifications#watched'`
  - `relativeTime(iso, nowMs) -> 'now' | '<n>m' | '<n>h' | '<n>d'` (same thresholds as `parseApiNotification`, `src/main.js:704-722`)
  - `replyUrl(reply) -> '/profile/<handle or did>/post/<rkey>'`
  - `postIdFromPath(pathname) -> string | null` (rkey from `/profile/<x>/post/<rkey>`, ignores trailing segments)
  - `buildWatchToast(record, newReplies, nowMs) -> ToastNotification`
  - `planRoundToasts(results: Array<{ record, newReplies }>, nowMs) -> ToastNotification[]`
  - `watchButtonLabel({ watched, unseen, hasApi }) -> { label, title }`
  - `WATCH_LIMIT_MESSAGE = 'You can watch up to 50 threads. Stop watching one first.'`
  - `NEEDS_LOGIN_MESSAGE = 'Checking for new replies needs the app-password login in settings.'`

`ToastNotification` is the object `showToast()` in `src/main.js:749` already takes, plus three fields: `{ type: 'watch', kind: 'watch', postId, url, replyUris, author, handle, avatar, action, preview, time, indexedAt }`.

Copy (exact):
- One reply: `author` = reply display name or handle, `handle` = reply handle, `avatar` = reply avatar, `action = "replied in a thread you're watching"`, `url = replyUrl(reply)`.
- Several: `author = '<n> new replies'`, `handle = null`, `avatar = ''`, `action = "in a thread you're watching"`, `url = record.url`.
- `preview` = newest reply's `text`; `time` = `relativeTime(newest.indexedAt)`; `indexedAt` = newest's.
- `planRoundToasts`: results with replies, newest activity first; if ≤ 5, one toast each; if more, the first 4 plus a summary `{ type: 'watch', kind: 'watch', postId: null, url: WATCHED_TAB_URL, author: '<k> more watched threads', handle: null, action: 'have new replies' }` (k = the rest).
- `watchButtonLabel`: label "Watch for new replies" / "Stop watching"; title = label, plus ` · <n> new repl(y|ies)` when `unseen > 0`, plus ` (${NEEDS_LOGIN_MESSAGE})` when `!hasApi`.

- [ ] **Step 1: Write the failing tests:**

```js
test('one new reply: "@alice replied" copy and the reply URL', () => {
  const t = buildWatchToast(rec, [alice], NOW_MS);
  assert.equal(t.handle, 'alice.test');
  assert.equal(t.action, "replied in a thread you're watching");
  assert.equal(t.url, '/profile/alice.test/post/3kreply');
  assert.equal(t.type, 'watch');
});
test('several new replies: count copy, newest snippet, the watched post URL', () => {
  const t = buildWatchToast(rec, [alice, bob, carol], NOW_MS);
  assert.equal(t.author, '3 new replies');
  assert.equal(t.action, "in a thread you're watching");
  assert.equal(t.preview, carol.text);   // carol is newest
  assert.equal(t.url, rec.url);
});
test('planRoundToasts makes one toast per watched post with new replies', ...);   // results without replies are skipped
test('caps toasts at 5 with a summary', () => {
  const toasts = planRoundToasts(sevenResults, NOW_MS);
  assert.equal(toasts.length, 5);
  assert.equal(toasts[4].author, '3 more watched threads');
  assert.equal(toasts[4].url, '/notifications#watched');
});
test('relativeTime buckets', ...);       // 30s 'now', 5m '5m', 3h '3h', 2d '2d'
test('postIdFromPath', ...);            // '/profile/a.b/post/3k' -> '3k'; '/profile/a.b' -> null; '/profile/a/post/3k/liked-by' -> '3k'
test('watchButtonLabel covers watched, unseen and missing login', ...);
```

- [ ] **Step 2: Run to verify they fail.** `node --test tests/unit/watchCopy.test.mjs` — FAIL.
- [ ] **Step 3: Implement** `src/watch/watchCopy.js`.
- [ ] **Step 4: Run.** `node --test tests/unit/` — all pass.
- [ ] **Step 5: Lint** the new files.
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 4: Storage and remote sync (`watch` table)

**Files:**
- Create: `src/watch/watchRemote.js`, `src/watch/WatchStore.js`
- Modify: `doc/remote_state.md` (add a "Watched threads" section), `AGENTS.md` ("Remote State Sync": a third bullet for `watch:<postId>`)
- Test: `tests/unit/watchRemote.test.mjs`, `tests/unit/watchStore.test.mjs`

**Interfaces:**
- Consumes: `mergeWatchMaps`, `changedIds`, `pruneWatches`, `WATCH_TOMBSTONE_TTL_MS` (Task 2); `isValidPostId`, `isValidTimestamp` exported from `src/StateManager.js:19-28`.
- Produces:
  - `watchRemote.js`: `watchRecordId(postId) -> 'watch:<id>'` (same character mapping as `seenRecordId`, `src/StateManager.js:40`); `buildWatchUpsertStatements(records: WatchRecord[]) -> { statements: string[], skipped: string[] }`, one `UPSERT watch:<id> CONTENT <JSON.stringify(record)>;` each, skipping a record with an invalid `postId` or invalid `watchedAt`/`updatedAt`/non-null `removedAt`; `buildWatchSelectQuery(postIds?: string[]) -> string` (`SELECT * FROM watch;` or `SELECT * FROM watch:a, watch:b;` with valid ids only); `parseWatchRows(rows) -> WatchMap` (drops `id`, skips rows without a valid `postId`, defaults missing arrays to `[]`); `buildWatchCleanupQuery(nowMs) -> string` (`DELETE watch WHERE removedAt != NONE AND removedAt != NULL AND removedAt < "<cutoff>";`).
  - `WatchStore.js`: `WATCHES_GM_KEY = 'bluesky_navigator_watches'`; `REMOTE_PUSH_DELAY_MS = 5000`;
    `new WatchStore({ getValue, setValue, remote, timers })` where `remote = { enabled: boolean, queryAll(q) -> Promise<rows>, exec(q) -> Promise }` or null, `timers = { setTimeout, clearTimeout, now }`.
    Methods: `load() -> WatchMap`; `save(map) -> WatchMap` (re-reads the GM key, `mergeWatchMaps(stored, map)`, `pruneWatches`, writes, returns the merged map, and queues the changed ids for a debounced push); `async syncRemote() -> WatchMap | null`; `async pushPending() -> void`.
  - Stored GM value: `JSON.stringify({ version: 1, watches: WatchMap })`; unreadable or wrong-shaped values load as `{}`.

Remote behavior:
- `syncRemote()` (called once at init when `stateSyncEnabled` and `!stateManager.remoteStateLoadFailed`): `queryAll(buildWatchSelectQuery())`, merge with local, write local, then push every id where the merged record differs from the remote row, then `exec(buildWatchCleanupQuery(now))`. On failure: log, set `remoteFailed = true`, return null; later pushes are skipped for the session (same rule as `remoteStateLoadFailed`).
- `pushPending()` is read-merge-write: select the pending ids, merge each with its remote row, upsert the merged records in one `exec` of the joined statements, write the merged records back to GM. On failure, put the ids back in the pending set.

- [ ] **Step 1: Write the failing tests:**

```js
// watchRemote.test.mjs
test('watchRecordId maps "-" and other characters to "_"', ...);          // '3k-a.b' -> 'watch:3k_a_b'
test('buildWatchUpsertStatements upserts valid records and skips invalid ids or timestamps', ...);
test('buildWatchSelectQuery selects all or only valid ids', ...);
test('parseWatchRows drops id, invalid rows and fills missing arrays', ...);
test('buildWatchCleanupQuery uses a 30-day cutoff', ...);                // cutoff ISO equals new Date(now - 30d).toISOString()

// watchStore.test.mjs (fake GM map, fake remote recording queries, manual timers)
test('load returns {} for a missing or corrupt GM value', ...);
test('save merges with what another tab stored instead of overwriting', () => {
  // GM already holds watch B (written by "another tab"); save({ A }) -> GM holds A and B
});
test('save does not resurrect a watch another tab removed', ...);       // GM has tombstone for A newer than our A
test('save queues a remote push that runs after 5000 ms', ...);
test('syncRemote merges remote rows into local and pushes only records that differ', ...);
test('pushPending reads, merges and upserts, so a newer remote seen mark survives', ...);
test('after a failed syncRemote no pushes are sent', ...);
test('with remote disabled nothing is queried', ...);
```

- [ ] **Step 2: Run to verify they fail.** `node --test tests/unit/watchRemote.test.mjs tests/unit/watchStore.test.mjs` — FAIL.
- [ ] **Step 3: Implement `src/watch/watchRemote.js`.**
- [ ] **Step 4: Implement `src/watch/WatchStore.js`.** No `GM_*` or `window` references; everything comes in through the constructor.
- [ ] **Step 5: Run.** `node --test tests/unit/` — all pass.
- [ ] **Step 6: Document** the `watch:<postId>` table in `doc/remote_state.md` (fields = the WatchRecord shape, tombstones via `removedAt`, 30-day cleanup, per-record merge) and add the bullet to `AGENTS.md`.
- [ ] **Step 7: Lint** the new files.
- [ ] **Step 8: Leave changes uncommitted.**

---

### Task 5: Thread depth option and the poller

**Files:**
- Modify: `src/api.js:222-231` (`getThread`)
- Create: `src/watch/WatchPoller.js`
- Test: `tests/unit/watchPoller.test.mjs`

**Interfaces:**
- Consumes: `THREAD_DEPTH`, `classifyThread`, `collectReplies`, `isNotFoundError` (Task 1).
- Produces:
  - `BlueskyAPI.getThread(uri, { depth, parentHeight } = {})`: passes `depth`/`parentHeight` to `agent.getPostThread` only when given; existing one-argument callers are unchanged.
  - `DEFAULT_INTERVAL_MS = 180000`, `CHECK_GAP_MS = 2000`, `MIN_ROUND_SPACING_MS = 60000`
  - `new WatchPoller({ api, getWatches, resolveUri, onResult, onRoundDone, intervalMs, timers, visibility })`
    - `getWatches() -> WatchRecord[]` (live ones), `resolveUri(record) -> Promise<string | null>`,
    - `onResult(postId, { status: 'ok' | 'notFound' | 'blocked', replies?: ReplyInfo[] })`, `onRoundDone()`,
    - `timers = { setTimeout, clearTimeout, now }`, `visibility = { isHidden() -> boolean, onChange(cb) -> unsubscribe }`.
  - Methods: `start()`, `stop()`, `setIntervalMs(ms)`, `checkNow(postId) -> Promise<void>` (one watch, used for the baseline right after watching), `runRound() -> Promise<{ checked: number, skipped?: 'rateLimited' | 'hidden' | 'busy' | 'login' }>`.

Behavior:
- `start()` with no `api` does nothing. Otherwise it runs a round right away (this is the page-load check that toasts replies that arrived while away), then schedules the next round `intervalMs` after the previous one finishes.
- A round: skip if hidden, if a round is already running, or if `api.isRateLimited()`. If `!api.agent.session`, `await api.login()`; on failure skip with `'login'`. For each watch with `!unavailable`, in order: stop the round if `api.isRateLimited()`; `uri = await resolveUri(record)` (skip if null); `getThread(uri, { depth: THREAD_DEPTH, parentHeight: 0 })`; call `onResult` with `classifyThread` and `collectReplies`; wait `CHECK_GAP_MS` before the next call. A `NotFound` error gives `status: 'notFound'`; an error with `status === 429` or `isRateLimitCooldown` ends the round; any other error skips that watch with `console.warn`.
- Hidden → clear the scheduled timer. Visible → if `now - lastRoundStartedAt >= MIN_ROUND_SPACING_MS`, run a round now; then reschedule.

- [ ] **Step 1: Write the failing tests** with a fake API (`isRateLimited`, `agent.session`, `login`, `getThread` recording calls), a manual timer queue (`advance(ms)`), and a fake visibility source:

```js
test('no api: start schedules nothing', ...);
test('start checks right away, then every intervalMs', ...);
test('checks one watch at a time with a 2000 ms gap', ...);          // second getThread only after advance(2000)
test('passes depth 50 and parentHeight 0', ...);
test('skips the whole round during the rate-limit cooldown', ...);
test('a 429 mid-round stops the round', ...);
test('NotFound error reports status notFound', ...);
test('unavailable watches are never fetched', ...);
test('hidden tab: no rounds; becoming visible checks once', ...);
test('flipping visibility within 60 s does not start another round', ...);
test('logs in first when there is no session; a failed login skips the round', ...);
```

- [ ] **Step 2: Run to verify they fail.** `node --test tests/unit/watchPoller.test.mjs` — FAIL.
- [ ] **Step 3: Change `getThread`** in `src/api.js` to accept the options object (keep `checkRateLimit()` / `handleApiError()` as they are).
- [ ] **Step 4: Implement `src/watch/WatchPoller.js`.**
- [ ] **Step 5: Run.** `node --test tests/unit/` — all pass. `npm run build` — succeeds.
- [ ] **Step 6: Lint** the new file; check `src/api.js` gained no ESLint errors.
- [ ] **Step 7: Leave changes uncommitted.**

---

### Task 6: WatchService

**Files:**
- Create: `src/watch/WatchService.js`
- Test: `tests/unit/watchService.test.mjs`

**Interfaces:**
- Consumes: Tasks 2-5.
- Produces:
  - `WATCH_CHANGED_EVENT = 'bsky-nav-watch-changed'`, `OPEN_WATCHED_TAB_EVENT = 'bsky-nav-open-watched-tab'`
  - `class WatchService` and `export const watchService = new WatchService()` (the app singleton; handlers and components import it).
  - `init({ store, api, enabled, intervalMs, showToasts, selfDid, notify, createPoller, now })`, where `showToasts(toasts: ToastNotification[])`, `selfDid() -> string | null`, `notify()` dispatches the change event (main.js passes `() => document.dispatchEvent(new CustomEvent(WATCH_CHANGED_EVENT))`), `createPoller(opts) -> WatchPoller` (defaults to `new WatchPoller`), `now() -> ms`.
  - Queries: `isEnabled()`, `hasApi()`, `isWatched(postId)`, `getWatch(postId)`, `getWatches()` (= `sortForList`), `unseenTotal()`, `unseenCountFor(postId)`.
  - Actions: `watch(info: WatchInfo) -> { ok: true } | { ok: false, reason: 'limit' | 'disabled' }`; `unwatch(postId)`; `toggle(info) -> { ok, watched, reason? }`; `markSeen(postId)`; `applyConfig({ enabled, intervalMs })`; `handleResult(postId, result)` (the poller's `onResult`; public for tests); `startSync() -> Promise` (calls `store.syncRemote()` and notifies).

Behavior:
- Every change: `this.map = store.save(this.map)` then `notify()`. The `onClick` on toasts is added by main.js's `showToasts` adapter (Task 7), so this module never touches `window`. `markSeen` of a watch with no unseen replies is a no-op (no save).
- `watch()`: refuse when disabled or when `!canAddWatch`; else `createWatch`, save, notify, then `poller?.checkNow(postId)` so the baseline is taken right away.
- `handleResult`: `notFound`/`blocked` → `markUnavailable`; `ok` → `applyCheck` with `selfDid()`. Results are collected per round; `onRoundDone` calls `showToasts(planRoundToasts(...))` once, only for results with new replies, and only when the watch was already baselined.
- `resolveUri(record)`: `atUriForWatch(record)`, else `api.resolveHandleToDid(record.authorHandle)` → save the built URI on the record.
- `applyConfig`: disabled → `poller.stop()`; enabled → `poller.setIntervalMs(intervalMs)` and `start()`.

- [ ] **Step 1: Write the failing tests** with an in-memory store fake (`save` returns its argument, `load` returns `{}`), a fake poller and a `notify` counter:

```js
test('watch adds a record, saves, notifies and requests a baseline check', ...);
test('refuses past the limit', () => {
  // 50 live watches loaded -> watch(info51) returns { ok: false, reason: 'limit' }; isWatched false; no notify
});
test('toggle watches, then unwatches (tombstone, isWatched false)', ...);
test('disabled service refuses to watch', ...);
test('baseline result shows no toast', ...);
test('one round with new replies in two threads shows two toasts once', ...);
test('notFound marks the watch unavailable and it is not polled again', ...);
test('markSeen clears unseen counts; markSeen with nothing unseen does not save', ...);
test('unseenTotal sums unseen replies of live watches', ...);
test('without api, watch still works and nothing polls', ...);
```

- [ ] **Step 2: Run to verify they fail.** `node --test tests/unit/watchService.test.mjs` — FAIL.
- [ ] **Step 3: Implement `src/watch/WatchService.js`.**
- [ ] **Step 4: Run.** `node --test tests/unit/` — all pass.
- [ ] **Step 5: Lint** the new files.
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 7: App wiring — init, toasts, settings, post-page seen

**Files:**
- Modify: `src/main.js` — `onStateInit` (~1022-1104), `showToast` (~749-814), `removeToast` (~819-833), `onConfigSave` (~310-330), `setContextFromUrl` (~1442)
- Modify: `src/components/ConfigModal.js:277-313` (Notifications section)
- Modify: `src/assets/css/style.css` (after `.bsky-nav-toast-icon.quote`, ~6549)

**Interfaces:**
- Consumes: `watchService`, `WATCH_CHANGED_EVENT` (Task 6), `WatchStore`, `WATCHES_GM_KEY` (Task 4), `postIdFromPath` (Task 3).
- Produces: config keys `watchThreads` (checkbox, default `true`) and `watchCheckInterval` (number, minutes, default `3`, min `1`, max `60`); toast `kind: 'watch'` handling; a running `watchService` by the time handlers activate.

- [ ] **Step 1: Settings.** Add after `toastTestMode` in `CONFIG_SCHEMA.Notifications.fields`:
  `watchThreads: { label: 'Watch threads', type: 'checkbox', default: true, help: 'Show a bell on posts to follow their threads for new replies' }`,
  `watchCheckInterval: { label: 'Check watched threads every (minutes)', type: 'number', default: 3, min: 1, max: 60, help: 'How often to check watched threads for new replies (needs the app-password login)', showWhen: { watchThreads: true } }`.
- [ ] **Step 2: Toasts.** In `showToast`: add a `watch` bell icon to `iconSvgs`; render `data-toast-kind="${esc(notification.kind || '')}"` on the toast; on click, if `notification.onClick` call it, otherwise keep the `/notifications` behavior; `removeToast($toast, true)` after either. In `removeToast`, skip `markNotificationsSeenUpTo` when `data-toast-kind` is `watch`. CSS: `.bsky-nav-toast-icon.watch` with the accent tint, like `.reply` (~6539).
- [ ] **Step 3: Init.** In `onStateInit`, after `initToastNotifications(api)` (~1104): build `new WatchStore({ getValue: GM_getValue, setValue: GM_setValue, remote, timers })` where `remote` is `null` unless `state.stateManager.config.stateSyncEnabled && !state.stateManager.remoteStateLoadFailed`, and wraps `executeRemoteQueryAll` / `postRemoteQuery`. Then `watchService.init({ store, api, enabled: config.get('watchThreads'), intervalMs: config.get('watchCheckInterval') * 60000, selfDid: () => api?.agent?.session?.did ?? null, showToasts, notify })`, and `watchService.startSync()`. `showToasts` maps each toast to `showToast({ ...t, onClick: () => { if (t.postId) watchService.markSeen(t.postId); window.location.href = t.url; } })`. Place the store/service setup right after `state.listCache = listCache;` (~1066), before `handlers = { … }`, because handlers read `watchService` on activate (Task 8). `showToast` is a function declaration in the same closure, so it is callable there; it no-ops until `initToastNotifications` (~1104) creates the container, and the first round only finishes after the async login.
- [ ] **Step 4: Settings save.** In `onConfigSave` call `watchService.applyConfig({ enabled: config.get('watchThreads'), intervalMs: config.get('watchCheckInterval') * 60000 })`.
- [ ] **Step 5: Post page marks seen.** In `setContextFromUrl`, when `urlChanged` (also true on the first call, since `current_url` starts `null`, `src/main.js:202`), `const id = postIdFromPath(location.pathname); if (id) watchService.markSeen(id);`.
- [ ] **Step 6: Build and smoke test.** `npm run build` — succeeds. `node --test tests/unit/` — all pass. Boot the scratch harness (described in Task 8, Step 1) with `config: { watchThreads: true, toastNotifications: true }`: no `[pageerror]` lines, the settings modal (Alt+.) shows both new fields under Notifications, and `window.__store.bluesky_navigator_watches` stays unset (nothing is watched yet).
- [ ] **Step 7: Lint.** ESLint count on `src/main.js` and `ConfigModal.js` not above baseline.
- [ ] **Step 8: Leave changes uncommitted.**

---

### Task 8: Bell button, `w` / `W`, shortcut overlay

**Files:**
- Create: `src/watch/watchButton.js`
- Modify: `src/handlers/ItemHandler.js` — `applyItemStyle` (7492-7508), `handleItemAction` (2450-2577, add `case 'w'` before `default`), `activate` (211) / `deactivate` (277)
- Modify: `src/handlers/Handler.js:94-99` (`W` in the non-Alt branch)
- Modify: `src/components/ShortcutOverlay.js:11-73`
- Modify: `src/assets/css/style.css` (new `/* Watch threads */` section at the end)
- Create: `tests/e2e/watch-threads.spec.ts`

**Interfaces:**
- Consumes: `watchService`, `WATCH_CHANGED_EVENT`, `OPEN_WATCHED_TAB_EVENT` (Task 6); `watchButtonLabel`, `WATCH_LIMIT_MESSAGE` (Task 3).
- Produces:
  - `watchButton.js`: `WATCH_BUTTON_CLASS = 'bsky-nav-watch-btn'`; `ensureWatchButton(itemEl, info: WatchInfo) -> HTMLElement | null` (idempotent: reuses an existing bell in that action row, updates its `data-*`); `refreshWatchButtons(root = document)` (sets icon, `aria-pressed`, `aria-label`, `title`, count badge from `watchService`); `removeWatchButtons(root = document)`; `installWatchButtonClicks(onToggle: (info, buttonEl) => void)` (once per page).
  - `ItemHandler`: `watchInfoForItem(item) -> WatchInfo | null` (from `postIdForItem`, `urlForItem` path, `didFromItem`, `getAuthorHandle`, `div[data-testid="postText"]` text ≤100); `watchTargetItem() -> jQuery` (the sidecar reply when `showReplySidecar && replyIndex != null && selectedReply.is(':visible')`, else `selectedPost` when `threadIndex` is truthy, else `selectedItem`; same order as `handleLikeAction`, 2954); `applyWatchButton(element)`; `toggleWatchForSelection()`.

- [ ] **Step 1: Recon the action row (logged-out harness).** The scratch harness named in the brief (`uikit-env.mjs`) is not in the scratchpad; use `/private/tmp/claude-501/-Users-tonyc-dev--projects-bluesky-navigator/1eac83e0-dd42-4d30-a976-8f74b073d00f/scratchpad/sh-lib.mjs`. Its `boot({ script, config })` launches headless Chromium on logged-out bsky.app ("Explore the app" Discover feed), shims `GM_*`, injects the given built userscript, fakes the userscript's API login and proxies its reads to `public.api.bsky.app` (so `getThread` works). It **can** reach feed items, post pages, the post-view modal and unrolled threads. It **cannot** reach `/notifications`, the logged-in sidebar's Notifications link, real Bluesky notifications, or remote sync (`GM_xmlhttpRequest` is a no-op). Run `npm run build`, then write a scratch script next to it that boots with `script: '<repo>/dist/bluesky-navigator.user.js'` and prints, for the first `.item` in the feed, for a post page (`/profile/<handle>/post/<rkey>` of that item) and with `config: { postActionButtonPosition: 'Left' }`: the outerHTML (attributes only, text trimmed) of the ancestor chain from `button[data-testid="postDropdownBtn"]` up to the row containing `button[data-testid="likeBtn"]`. Record in the task notes: the row element, the per-button wrapper's structure, and whether unrolled sub-posts (`.unrolled-reply`) and sidecar replies have a Bluesky action row (expected: no; then they get `w` but no bell). Use the row and wrapper you found as the insertion point (after the last built-in button wrapper), mirroring the wrapper's sizing with our own CSS classes, not Bluesky's generated `css-*` / `r-*` classes.
- [ ] **Step 2: Implement `watchButton.js`.** The bell is a `<button type="button" class="bsky-nav-watch-btn" data-post-id data-post-url data-author-did data-author-handle data-snippet>` with outline / filled 18px bell SVGs (currentColor) and a `<span class="bsky-nav-watch-count">` shown when unseen > 0. `installWatchButtonClicks` adds document-level capture listeners for `pointerdown`, `mousedown` and `click` that, when the target is inside a bell, call `preventDefault()` + `stopPropagation()` (all three, so Bluesky's row click doesn't open the post) and on `click` call `onToggle(info, button)`. The delegation also covers bells cloned into the post-view modal (`src/components/PostViewModal.js:150`), which `refreshWatchButtons()` updates by `data-post-id`.
- [ ] **Step 3: Wire ItemHandler.** In `applyItemStyle`, call `this.applyWatchButton(element)` last: if `config.get('watchThreads')` and `watchInfoForItem` returns info, `ensureWatchButton` + refresh that one bell; if disabled, `removeWatchButtons(element)`. In `activate`, `installWatchButtonClicks` (idempotent module flag) and add a `WATCH_CHANGED_EVENT` listener that calls `refreshWatchButtons()`; remove it in `deactivate`. The toggle callback: `watchService.toggle(info)`; on `{ ok: false, reason: 'limit' }` call `announceToScreenReader(WATCH_LIMIT_MESSAGE)` and show it in the bell's title briefly; on success `this.showActionFeedback(button)` when the bell is off screen (`isElementInViewport`) and announce "Watching thread for new replies" / "Stopped watching thread".
- [ ] **Step 4: `w` and `W`.** `case 'w'`: if `!config.get('watchThreads')` return false; else `toggleWatchForSelection()` (uses `watchTargetItem()`, its bell if any, else `watchInfoForItem` directly). In `Handler.handleInput`'s non-Alt branch add `else if (event.key === 'W' && !event.ctrlKey && this.config.get('watchThreads')) { event.preventDefault(); document.dispatchEvent(new CustomEvent(OPEN_WATCHED_TAB_EVENT)); }` (the listener comes in Task 10).
- [ ] **Step 5: Shortcut overlay.** "Post Actions": `{ keys: ['w'], description: 'Watch/unwatch thread for new replies' }` after `s`/`S`. "Global Navigation": `{ keys: ['W'], description: 'Watched threads' }`.
- [ ] **Step 6: CSS.** `/* Watch threads */` section: bell sized/colored like Bluesky's action icons (`var(--bsky-nav-text-medium)`; watched = `var(--bsky-nav-accent)`), hover/focus-visible ring using `--bsky-nav-ring-width`, count badge pill; Left-position layout from the recon.
- [ ] **Step 7: Verify in the harness.** `npm run build`; boot the harness; check: every feed item and post-page post shows one bell after scrolling and after the selection moves (React re-render re-applies it); clicking a bell fills it, does not change `location.href`, does not add `item-read` to the item, and stores a record under `bluesky_navigator_watches`; pressing `w` on the selection toggles it; with `unrolledPostSelection` on, `w` on a sub-post watches that sub-post's rkey; `?` lists `w` and `W`; the post-view modal (`v`) shows the bell and clicking it toggles both copies. Screenshot light and dark (`data-bsky-nav-theme`).
- [ ] **Step 8: Write e2e** `tests/e2e/watch-threads.spec.ts` (run by owner/CI, not locally), using `authenticatedPage` and `FeedPage` like `tests/e2e/shortcuts.spec.ts`: "bell appears in the action row", "clicking the bell does not navigate" (URL unchanged, item not read, bell `aria-pressed="true"`), "w toggles watch on the selected post", "shortcut overlay lists w and W". Each test unwatches what it watched.
- [ ] **Step 9: Run.** `node --test tests/unit/` — all pass; ESLint counts not above baseline; prettier on new files.
- [ ] **Step 10: Leave changes uncommitted.**

---

### Task 9: Feed — hide-read exemption and badge refresh

**Files:**
- Modify: `src/handlers/FeedItemHandler.js:1562-1567` (`filterItem` read check), `activate` (888) / `deactivate` (942)
- Modify: `tests/e2e/watch-threads.spec.ts`

**Interfaces:**
- Consumes: `watchService.unseenCountFor(postId)`, `WATCH_CHANGED_EVENT`.
- Produces: none.

- [ ] **Step 1: Exempt watched posts with unseen replies.** Change the read check to `if (postId && this.state.seen[postId] && !(this.config.get('watchThreads') && watchService.unseenCountFor(postId) > 0)) return false;`. Nothing else in the thread changes (the other read posts still hide; `filterThread` keeps the thread because one item is visible).
- [ ] **Step 2: Re-filter on change.** In `activate`, listen for `WATCH_CHANGED_EVENT` and, when `this.state.feedHideRead`, call `this.filterItems()` (debounced 200 ms); remove the listener in `deactivate`. `ProfileItemHandler` and `SavedItemHandler` inherit this.
- [ ] **Step 3: Verify in the harness.** Copy `boot()` from `sh-lib.mjs` into your scratch script and add a seeded `bluesky_navigator_watches` value (one baselined watch for a Discover post, with one unseen reply) to the store object it builds before the script is injected. Mark that post read (`.`), turn hide-read on: the post stays, its bell shows "1". Clear unseen (open the post page, come back): with hide-read on it disappears. A read unwatched post next to it still hides.
- [ ] **Step 4: e2e.** The e2e specs have no way to seed Tampermonkey storage (no existing spec does), so add only "with hide-read on, a watched post with no unseen replies hides like any read post" (watch, mark read with `.`, toggle hide-read). The unseen case is covered by Step 3 and the owner's manual check.
- [ ] **Step 5: Run** unit tests and ESLint (no new errors in `FeedItemHandler.js`).
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 10: Watched tab on `/notifications`

**Files:**
- Create: `src/watch/WatchedTab.js`
- Modify: `src/main.js` (start it after `watchService.init`), `src/assets/css/style.css` (Watch threads section)
- Modify: `tests/e2e/watch-threads.spec.ts`

**Interfaces:**
- Consumes: `watchService` (queries, `markSeen`, `unwatch`, `hasApi`), `WATCH_CHANGED_EVENT`, `OPEN_WATCHED_TAB_EVENT`, `relativeTime`, `replyUrl`, `WATCHED_TAB_URL`, `NEEDS_LOGIN_MESSAGE`.
- Produces: `class WatchedTab { constructor({ service, config }); start(); stop(); activate(); deactivate(); render() }`; `NOTIF_SELECTORS` (one exported object holding every Bluesky selector this file uses).

- [ ] **Step 1: Recon (owner, logged in).** The harness can't reach `/notifications`. Ask the owner to open `https://bsky.app/notifications` while logged in and run in DevTools, then paste the output into the task notes:

```js
copy((() => {
  const s = document.querySelector('[data-testid="notificationsScreen"]');
  const tabs = s?.querySelector('[role="tablist"]');
  const strip = (el) => el ? el.outerHTML.replace(/>[^<]{40,}</g, '>…<') : null;
  return JSON.stringify({ tablist: strip(tabs?.parentElement), tabs: [...(tabs?.querySelectorAll('[role="tab"]') || [])].map((t) => ({ text: t.innerText, selected: t.getAttribute('aria-selected'), cls: t.className })), pagerChildren: [...(tabs?.parentElement?.parentElement?.children || [])].map((c) => c.tagName + ' ' + (c.getAttribute('data-testid') || '') + ' ' + c.className.slice(0, 80)) }, null, 2);
})())
```

  Until that arrives, code against these assumptions and keep them in `NOTIF_SELECTORS`: screen `[data-testid="notificationsScreen"]` (already used in `src/main.js:181`), tab bar `[role="tablist"]`, tabs `[role="tab"]` with `aria-selected`, Bluesky's list = the pager content after the tab bar. If the paste contradicts them, adjust only `NOTIF_SELECTORS` and the insertion code.
- [ ] **Step 2: Implement `WatchedTab`.** `start()` uses `waitForElement(NOTIF_SELECTORS.screen, …)` plus an `observeChanges` on the screen (rAF-debounced) to re-insert the tab whenever React re-renders the tab bar. The tab: a `role="tab"` element labeled "Watched" with a count pill when `unseenTotal() > 0`, cloned sizing via our own classes. `activate()`: add `bsky-nav-watched-active` to the screen (CSS hides Bluesky's list and Bluesky's selected-tab indicator, shows our panel), set our tab `aria-selected="true"`, `history.replaceState` to `/notifications#watched`. A capture click listener on Bluesky's tabs calls `deactivate()` (restores Bluesky's view, drops the hash). `OPEN_WATCHED_TAB_EVENT`: on `/notifications` activate; elsewhere set `pendingOpen` and click `nav a[aria-label="Notifications"]` (fallback `location.href = WATCHED_TAB_URL`); when the tab is inserted with `pendingOpen` or with `location.hash === '#watched'`, activate.
- [ ] **Step 3: Render the list** from `service.getWatches()` on activate and on `WATCH_CHANGED_EVENT`: per entry the author handle, snippet, "Watched <relativeTime>", "Post unavailable" when `unavailable`, and each unseen reply (author, snippet, time) as a plain `<a href="${replyUrl(reply)}">`; the entry header links to `record.url`. Clicking any link in an entry calls `service.markSeen(postId)` before navigating. Buttons "Mark seen" (only when there are unseen replies) and "Stop watching" (`service.unwatch`). Escape all text with `utils.escapeHtml`. Empty state: "No watched threads. Press w on a post, or click its bell, to watch it for new replies." plus `NEEDS_LOGIN_MESSAGE` when `!service.hasApi()` (also shown above a non-empty list).
- [ ] **Step 4: Wire** `new WatchedTab({ service: watchService, config }).start()` in `onStateInit` after `watchService.init`, only when `watchThreads` is on; `applyConfig` path in `onConfigSave` starts/stops it.
- [ ] **Step 5: Verify what the harness can.** Using the seeded `boot()` copy from Task 9, Step 3, mount the panel's `render()` output into a test container on the logged-out harness page with seeded watches (two with unseen, one without, one unavailable) and check order, copy, Mark seen / Stop watching behavior and light/dim/dark styling via screenshots.
- [ ] **Step 6: e2e (owner/CI)** in `tests/e2e/watch-threads.spec.ts`: "W opens the Watched tab", "selecting another tab restores Bluesky's list", "Watched tab is re-inserted after the tab bar re-renders" (switch tabs twice), "empty state explains how to watch", "/notifications#watched opens the tab".
- [ ] **Step 7: Owner manual check** (list it in the hand-off): watch a thread from another account's reply, wait for a check, confirm the toast, the tab entry, Mark seen, Stop watching.
- [ ] **Step 8: Run** unit tests, build, ESLint, prettier on the new file.
- [ ] **Step 9: Leave changes uncommitted.**

---

### Task 11: Sidebar badge

**Files:**
- Create: `src/watch/watchBadge.js`
- Modify: `src/main.js` (start after `watchService.init`), `src/assets/css/style.css`
- Modify: `tests/e2e/watch-threads.spec.ts`

**Interfaces:**
- Consumes: `watchService.unseenTotal()`, `WATCH_CHANGED_EVENT`.
- Produces: `startWatchBadge(service) -> stop()`; `NAV_NOTIFICATIONS_SELECTOR = 'a[aria-label="Notifications"]'` (the selector `updateNotificationBadge` already relies on, `src/main.js:870-875`).

- [ ] **Step 1: Recon.** Check on the logged-out harness whether any `a[aria-label="Notifications"]` exists (expected: none logged out). For the logged-in markup ask the owner to run `copy(document.querySelector('a[aria-label="Notifications"]').outerHTML)` on a page with unread notifications (so Bluesky's `div[aria-label*="unread"]` badge is present) and paste it into the task notes. Desktop sidebar and mobile bottom bar may both match; badge every match.
- [ ] **Step 2: Implement.** For each matching link, ensure one `<span class="bsky-nav-watch-nav-badge" aria-label="<n> unseen watched replies">` placed next to Bluesky's unread badge (inside the icon wrapper, offset so the two never overlap; distinct color: `--bsky-nav-accent` outline style rather than Bluesky's filled badge). Hidden at 0. Re-applied on `WATCH_CHANGED_EVENT` and through `waitForElement(NAV_NOTIFICATIONS_SELECTOR, …)` when the nav re-renders. Never touch Bluesky's own badge element.
- [ ] **Step 3: Wire** in `onStateInit` (when `watchThreads` on) and stop/start from `onConfigSave`.
- [ ] **Step 4: e2e (owner/CI):** "no watch badge when there are no unseen watched replies" (storage can't be seeded from e2e). The count itself is checked by the owner's manual check (Task 10, Step 7) and, for rendering, by calling the badge renderer on the harness page with an injected fake `a[aria-label="Notifications"]` built from the owner's pasted markup.
- [ ] **Step 5: Run** unit tests, build, ESLint, prettier on the new file.
- [ ] **Step 6: Leave changes uncommitted.**

---

## Final verification (after Task 11)

- [ ] `node --test tests/unit/` — all pass (42 baseline + the new suites).
- [ ] `npm run build` — succeeds; `dist/` changes are expected and left uncommitted.
- [ ] ESLint on every touched file — error count not above the baseline; `npx prettier --check src/watch/*.js tests/unit/watch*.test.mjs tests/e2e/watch-threads.spec.ts` — clean.
- [ ] Harness pass of Tasks 8-9 checks on the final build.
- [ ] Hand-off notes for the owner: run `npm test -- --grep "watch"` (or let CI), the Task 10 manual check, and a two-device check if remote sync is configured (watch on A, reload B: watched; mark seen on B, reload A: seen; unwatch on A, reload B: gone).
- [ ] Leave all changes uncommitted.
