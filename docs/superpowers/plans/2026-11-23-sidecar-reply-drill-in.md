# Sidecar Reply Drill-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reply sidecar drill into a reply to show that reply's replies, one level at a time, with a breadcrumb back up, and make `r` reply to the focused sidecar reply.

**Architecture:** A small pure module (`src/sidecarDrill.js`) turns a `getPostThread` node into the reply list for one level and says when a level needs fetching. `ItemHandler` keeps a drill stack per main post, renders the current level through the existing sidecar template (extended with a breadcrumb, a pinned reply, and a › marker), and re-renders on drill and up. `r` on a sidecar reply navigates to that reply's post page and a one-shot pending-reply flag makes `PostItemHandler` click Bluesky's reply button there.

**Tech Stack:** Plain ES modules bundled by vite into a Tampermonkey userscript; jQuery and Handlebars templates (`src/sidecar.html`); `@atproto/api` via `src/api.js`. Unit tests use Node's built-in `node:test` (no new dependency). Browser checks use the scratchpad Playwright harness.

**Spec:** [docs/superpowers/specs/2026-11-23-sidecar-reply-drill-in-design.md](../specs/2026-11-23-sidecar-reply-drill-in-design.md)

## Global Constraints

- Owner rules: never commit, push, or run `npm test` / the Playwright suite without an explicit request; never `git stash`; never touch `.claude/settings.local.json`. "Commit" steps below are replaced by "leave changes uncommitted".
- Build with `npm run build`; `dist/bluesky-navigator.user.js` is tracked and must be rebuilt after source changes.
- ESLint must show no new problems versus `main` on changed files; new lines must be Prettier-formatted (several files already fail Prettier on `main`).
- US English in code comments, UI text and docs.
- Unchanged per spec: Fixed and Inline sidecar modes, `t` toggle, `;` refresh, `sidecarReplySortOrder`, width settings, `hoverToFocusSidecar`. Replies shown in an unrolled thread stay excluded at the top level only.
- Breadcrumb root label is exactly `Replies`; later crumbs are the drilled reply authors' display names (fall back to handle). The › marker appears only on replies with `replyCount > 0`.

## Review Focus

1. Nested reply nodes that aren't normal posts (`#notFoundPost`, `#blockedPost`, missing `post`) must be skipped at every level, never rendered or counted. → Task 1 test.
2. Selecting a different main post while a drill fetch is in flight must not render the stale response into the new post's sidecar. → Task 3 check.
3. Drilling keys must do nothing when the sidecar isn't available (hidden with `t`, below the minimum width, no replies). → Task 3 check.
4. `r` must never click the reply button of the wrong post: if the user navigates elsewhere or the button doesn't appear within the timeout, the pending reply is dropped. → Task 4 check.
5. At a drilled level with zero renderable replies (all blocked/deleted, or a fetch that returns none), the pinned reply still shows with a "No replies" note and ← still works. → Task 2 check.

## Testing approach

- **Unit:** `node --test tests/unit/` for `src/sidecarDrill.js` (pure, no DOM).
- **Browser:** the scratchpad harness at `/private/tmp/claude-501/-Users-tonyc-dev--projects-bluesky-navigator/1eac83e0-dd42-4d30-a976-8f74b073d00f/scratchpad`: `uikit-env.mjs` exports `boot({ config, viewport, url })` → `{ browser, ctx, page }`, logged out in Chromium with the built script (env `SCRIPT_PATH` picks another build; `main-dist.js` there is `main`'s build). Use config `{ showReplySidecar: true }` (Fixed mode is the default) and also `{ showReplySidecar: true, fixedSidecar: 'Inline' }`. Find a public post with nested replies (two or more levels, and one branch deeper than 6 levels if feasible) and record its URL in each task's report. Name probe scripts `drill-*.mjs`.

## File Structure

- Create `src/sidecarDrill.js`: pure helpers for one drill level.
- Create `tests/unit/sidecarDrill.test.mjs`.
- Modify `src/sidecar.html`: breadcrumb, pinned reply section, › marker and data attributes.
- Modify `src/handlers/ItemHandler.js`: drill state, rendering per level, keys, mouse, `r` routing.
- Modify `src/handlers/PostItemHandler.js`: act on the pending-reply flag.
- Modify `src/components/PostViewModal.js`: drill in the post view's replies pane.
- Modify `src/assets/css/style.css`: breadcrumb, pinned reply and › styling (use existing theme tokens).
- Modify `README.md`, `src/components/ShortcutOverlay.js`: document the keys.

---

### Task 1: Drill-level data helpers

**Files:**
- Create: `src/sidecarDrill.js`
- Test: `tests/unit/sidecarDrill.test.mjs`

**Interfaces:**
- Produces:
  - `sortReplyPosts(posts: object[], sortOrder: string) -> object[]` — the existing comparator moved out of `getSidecarContent` (`ItemHandler.js:1830-1844`), unchanged in behavior; returns a new array.
  - `getLevelReplies(node: ThreadNode, { sortOrder: string, excludePostIds?: Set<string> }) -> ThreadNode[]` — the node's `replies` that have a `post` (skips `#notFoundPost`, `#blockedPost` and anything without `post`), minus those whose rkey (last URI segment) is in `excludePostIds`, sorted by `sortReplyPosts` on their posts. Returns `[]` when `node.replies` is missing.
  - `needsFetch(node: ThreadNode) -> boolean` — `true` when `node.post.replyCount > 0` and `node.replies` is missing or empty.
  - `hasChildReplies(node: ThreadNode) -> boolean` — `node.post.replyCount > 0`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/sidecarDrill.test.mjs` using `node:test` and `node:assert/strict`, importing from `../../src/sidecarDrill.js`:
  - `getLevelReplies skips not-found and blocked nodes`: replies `[{post:A}, {$type:'app.bsky.feed.defs#notFoundPost'}, {$type:'app.bsky.feed.defs#blockedPost'}, {post:B}]` → `[A-node, B-node]`.
  - `getLevelReplies excludes unrolled post ids`: exclude set containing A's rkey → only B.
  - `getLevelReplies sorts by Most Liked First`: likeCounts 1, 5, 3 → 5, 3, 1; `Default` keeps input order.
  - `getLevelReplies returns [] when replies missing`.
  - `needsFetch`: `{post:{replyCount:2}}` → true; `{post:{replyCount:2}, replies:[…]}` → false; `{post:{replyCount:0}}` → false.

- [ ] **Step 2: Run** `node --test tests/unit/` — expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/sidecarDrill.js` with the four exports. Then change `getSidecarContent` to use `getLevelReplies(thread, { sortOrder, excludePostIds: this.unrolledPostIds })` so top-level output is unchanged.

- [ ] **Step 4: Run** `node --test tests/unit/` — expected: all PASS. Run `npm run build`, then a harness check that the top-level sidecar for one post renders the same reply order and count as `main-dist.js`.

- [ ] **Step 5:** Leave changes uncommitted.

---

### Task 2: Render a drilled level

**Files:**
- Modify: `src/sidecar.html` (`#sidecar-replies-template`, `#sidecar-post-template`)
- Modify: `src/handlers/ItemHandler.js` (`getSidecarContent` ~1814, `updateFixedSidecarPanel` ~1510, inline path in `showSidecar` ~1854)
- Modify: `src/assets/css/style.css`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `this.sidecarDrill: { mainPostId: string, stack: Array<{ node: ThreadNode, fromIndex: number }> } | null` on `ItemHandler`. `stack` empty means the top level. `node` is the reply drilled into.
  - `getSidecarContent(item, thread, drillStack = []) -> Promise<string>`: with an empty stack, output as today plus the › marker. With a non-empty stack: breadcrumb, the last stack node's post pinned in place of "Replying to", and `getLevelReplies(lastNode, { sortOrder })` as the list (no unrolled exclusion below the top level).
  - `renderSidecarLevel() -> Promise<void>`: re-renders the current sidecar (Fixed panel or inline container, whichever is active) from `this.sidecarThread` and `this.sidecarDrill.stack`, re-binds the handlers `showSidecar`/`updateFixedSidecarPanel` bind today (mouseover, filter and author highlights, section toggles), and keeps the existing skeleton → content flow.
  - Template data: each `.sidecar-post` gets `data-uri` and, when `hasChildReplies`, `data-has-replies="true"` plus a `.sidecar-drill-marker` (`›`) after the reply count. Breadcrumb is `nav.sidecar-breadcrumb` with `button.sidecar-crumb[data-depth="N"]` per level (`Replies` is depth 0).

- [ ] **Step 1: Harness check (fails first):** `drill-render.mjs` loads the chosen post with the sidecar on, sets `handler.sidecarDrill.stack` to the first reply that has replies (via a debug hook in a patched scratchpad copy of the build, never in `src`), calls `renderSidecarLevel()`, and asserts: breadcrumb text `Replies › <name>`, pinned post is that reply, listed posts equal that reply's renderable child replies in sort order, and › appears exactly on replies with `replyCount > 0`. Run on the current build: FAIL.

- [ ] **Step 2: Implement** the template, `getSidecarContent` drill rendering, `renderSidecarLevel`, and CSS. Store the thread used for rendering as `this.sidecarThread` when the sidecar is shown for a main post.

- [ ] **Step 3: Empty level (Review Focus 5):** a drilled node whose renderable replies are empty renders the pinned reply plus a `.sidecar-replies-none` line reading `No replies`.

- [ ] **Step 4: Verify** `npm run build`; `drill-render.mjs` PASS in Fixed and Inline modes; top-level rendering matches `main` apart from the › markers; ESLint no new problems.

- [ ] **Step 5:** Leave changes uncommitted.

---

### Task 3: Drill and go up with keys and mouse

**Files:**
- Modify: `src/handlers/ItemHandler.js` (ArrowLeft/ArrowRight handling ~2333-2346, `toggleFocus` ~2776, `expandItem` ~1624 / `setIndex` sidecar reset, click handlers bound in `renderSidecarLevel`)
- Modify: `src/api.js` only if `getThread(uri)` needs a `depth` argument (it currently passes none, so server default depth 6 applies)

**Interfaces:**
- Consumes: Task 2 `sidecarDrill`, `renderSidecarLevel`, data attributes.
- Produces:
  - `drillIntoReply(index: number) -> Promise<boolean>`: if the reply at `index` in the current level has replies, push `{ node, fromIndex: index }`, fetch first when `needsFetch(node)` (show the skeleton; on error render the pinned reply with `.sidecar-replies-error` reading `Couldn't load replies` and keep ← working), re-render, set `replyIndex` to the first listed reply (index after the pinned reply). Returns whether it drilled.
  - `drillUp(toDepth?: number) -> Promise<void>`: pop to `toDepth` (default one level), re-render, and set `replyIndex` to the popped entry's `fromIndex` position in the restored list.
  - Fetches are tagged with the main post id they were started for; a response is dropped if `this.sidecarDrill.mainPostId` changed (Review Focus 2).

- [ ] **Step 1: Harness checks (fail first)** in `drill-keys.mjs`, Fixed and Inline:
  - → from the main post enters the sidecar (unchanged); → on a reply with replies drills in, focus on its first reply; → on a reply without replies does nothing.
  - ← at a drilled level goes up and focuses the reply drilled from; ← at the top level leaves the sidecar (unchanged).
  - Two levels down, clicking the `Replies` crumb returns to the top with focus on the original top-level reply.
  - Clicking a reply's › or reply count drills in.
  - `j`/`k`, Home/End stay within the current level; `o` and `l` act on the focused reply.
  - Selecting another main post (`j` on the main list) resets to the top level.
  - Stale fetch: delay the fetch (route interception), press `j` on the main list before it resolves; the new post's sidecar must not show the delayed level.
  - Sidecar hidden with `t`, or window narrower than `showReplySidecarMinimumWidth`: → and ← behave exactly as on `main` (Review Focus 3).
  - If a branch deeper than 6 levels was found: drilling past the fetched depth shows the skeleton, then that reply's replies.

- [ ] **Step 2: Implement** `drillIntoReply`, `drillUp`, the key routing (→ drills only when focus is already in the sidecar), click handlers, and the reset on main post change.

- [ ] **Step 3: Verify** `npm run build`; all `drill-keys.mjs` checks PASS; Home and profile `j`/`k` positions identical to `main-dist.js` with the sidecar off; ESLint no new problems.

- [ ] **Step 4:** Leave changes uncommitted.

---

### Task 4: `r` replies to the focused sidecar reply

**Files:**
- Modify: `src/handlers/ItemHandler.js` (`case 'r'` ~2097, `openReplyDialog` ~2493)
- Modify: `src/handlers/PostItemHandler.js`

**Interfaces:**
- Consumes: `selectedReply` (`ItemHandler.js:727`), its `.sidecar-post-timestamp a` link (used by `openCurrentItem`), `postIdFromUrl()`.
- Produces:
  - `openReplyForSidecarReply() -> void` on `ItemHandler`: when `replyIndex != null` (any level, including the pinned reply and "Replying to"), store `pendingReply = { postId, expiresAt: Date.now() + 10000 }` in `sessionStorage` key `bsky-nav-pending-reply`, then open the reply's post page by clicking its timestamp link (same SPA navigation as `o`). Otherwise `r` behaves as today.
  - `PostItemHandler.consumePendingReply() -> void`: called after the URL post is selected on load. If the pending entry is unexpired and its `postId` equals `postIdFromUrl()`, remove it and click the selected item's `button[aria-label^='Reply']` via `openReplyDialog`, waiting up to 5 s for the button. Any other page, an expired entry, or a missing button removes the entry without clicking (Review Focus 4).

- [ ] **Step 1: Harness checks (fail first)** in `drill-reply.mjs`: logged out, Bluesky's reply button opens a sign-in prompt rather than the composer, so assert on the click instead: wrap `HTMLElement.prototype.click` in the page to record clicks on `button[aria-label^='Reply']` and the post they belong to.
  - Focus a top-level sidecar reply, press `r`: URL becomes that reply's post page and exactly one reply-button click is recorded, on that post.
  - Same from a drilled level and from the pinned reply.
  - Focus on the main post: `r` behaves as on `main` (clicks the main post's reply button, no navigation).
  - Set the pending entry, then navigate to a different post page: no reply click; entry removed.
  - Expired entry (set `expiresAt` in the past): no click.

- [ ] **Step 2: Implement** both methods and the `case 'r'` routing.

- [ ] **Step 3: Verify** `npm run build`; `drill-reply.mjs` PASS; ESLint no new problems.

- [ ] **Step 4:** Leave changes uncommitted.

---

### Task 5: Post view, docs, and shortcut help

**Files:**
- Modify: `src/components/PostViewModal.js` (replies pane uses `getSidecarContent`, ~`ItemHandler.js:3393`; pane switching on h/l and ←/→ at `PostViewModal.js:50-75, 370`)
- Modify: `README.md` (key table ~:90, :129; "Fixed Sidecar Panel" section ~:295-311)
- Modify: `src/components/ShortcutOverlay.js` (~:107)

**Interfaces:**
- Consumes: Task 2 `getSidecarContent(item, thread, drillStack)`, Task 3 drill semantics.
- Produces: in the post view's replies pane, → on a reply with replies drills in and ← goes up; ← at the top level of the replies pane switches back to the thread pane as today. The modal keeps its own drill stack, reset when it opens.

- [ ] **Step 1: Harness check (fails first)** `drill-modal.mjs`: open the post view with `v`, switch to the replies pane, → drills, ← goes up, ← again returns to the thread pane.

- [ ] **Step 2: Implement** the modal drill and update README and the shortcuts overlay: → "Enter sidecar / drill into replies", ← "Up a level / leave sidecar", `r` "Reply (to the focused sidecar reply)", and add the missing `t` "Show or hide sidecar" entry.

- [ ] **Step 3: Verify** `npm run build`; `drill-modal.mjs` PASS; rerun Tasks 2–4 harness checks for regressions; ESLint no new problems; `node --test tests/unit/` PASS.

- [ ] **Step 4:** Leave changes uncommitted.
