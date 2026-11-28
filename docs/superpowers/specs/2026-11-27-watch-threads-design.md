# Watch threads for new replies — design

Date: 2026-11-27
Status: draft, awaiting owner approval

## Intent

The owner sometimes wants to follow a thread for new replies. They browse with
hide-read on (only unread posts shown), so once a thread is read it disappears and
new replies to it go unnoticed. Bluesky's timeline does not resurface an old post
when it gets new replies, so this can't be solved inside the feed alone: the script
has to check watched threads itself, through the API, and tell the owner about new
replies wherever they are.

## Goals

- Watch or unwatch a post from a bell button on the post and from a hotkey.
- A watched post covers **every reply below it, at any depth** (owner's choice).
  Watching a thread's root follows the whole thread; watching one reply follows
  only its branch.
- Detect new replies by polling, independent of whether the post is in the feed.
- Tell the owner in three places:
  1. **Toasts**, through the existing toast notification system, grouped per
     watched post per check ("5 new replies in a thread you're watching").
  2. **A "Watched" tab on the notifications page**, listing watched posts with
     their unseen new replies; the place to catch up and to unwatch.
  3. **A badge count** of unseen watched replies, next to Bluesky's Notifications
     link.
- **In the feed:** a watched post with unseen new replies stays visible when
  hide-read is on, and shows a badge, while it is in the loaded feed.

## Non-goals

- Mixing watched replies into Bluesky's own "All" notifications list (rejected:
  Bluesky renders and pages that list; injected rows would be fragile).
- Moving or inserting a watched post at the top of the feed.
- Keyboard (j/k) navigation of the notifications page or the Watched tab.
- Server-side notifications or push; this works only while a Bluesky tab with the
  script is open.

## Anti-goals

- Flooding: a busy thread must not produce a toast per reply.
- Hitting Bluesky API rate limits or slowing the page because of polling.
- Breaking the existing toasts, the native notifications badge, or hide-read for
  posts that aren't watched.

## Constraints (from the code)

- **API access requires the owner's app-password login** (`atprotoService`,
  `atprotoIdentifier`, `atprotoPassword`; `src/main.js` ~1026). Without it `api`
  is undefined. Watching still works (stored locally) and the bell and feed
  behavior still work, but no polling, toasts, tab content updates or badge.
  The bell's tooltip / the Watched tab says that checking needs the login.
- `getThread(uri)` (`src/api.js:222`) returns the raw ThreadViewPost
  (`.post`, `.replies[]` nested). The API's default thread depth limits how deep
  replies are returned; replies deeper than that are not seen. Expose a depth
  parameter if needed (the API allows up to 1000; pick a sane value, e.g. 50).
- `checkRateLimit()` throws during a 60 s cooldown after a 429; there is no
  request-count limiter, so watch polling must pace itself.
- Shortcuts are hardcoded in `ItemHandler.handleItemAction`
  (`src/handlers/ItemHandler.js` ~2448) and listed in
  `src/components/ShortcutOverlay.js`. `w` and `W` are free.
- The script injects nothing into Bluesky's action row today; the bell is the
  first such injection and must survive React re-renders (re-apply in the
  per-item decoration pass).
- State: keys in `DEFAULT_STATE` (`src/state.js`) persist via GM storage and
  sync as one newest-wins blob; `seen` is the one collection merged per record
  with its own remote table. Watches follow the `seen` model (see Sync below).
- Every open tab runs the script; there is no cross-tab messaging
  (no `GM_addValueChangeListener`), and remote state is loaded only at page load.
- Toast click currently always navigates to `/notifications` and marks Bluesky
  notifications seen (`src/main.js` ~788, ~835). Watch toasts must not mark
  Bluesky notifications seen.

## Approaches considered

1. **Watched list in the script's own notification surfaces** (toasts + a
   Watched tab + badge), with the feed keeping watched posts visible while
   loaded. Detection by polling the API. **Chosen** — notices replies wherever
   the post is, doesn't fight Bluesky's feed or notification list.
2. **Feed only:** keep watched posts visible and badged in the loaded feed.
   Simple, but misses exactly the older threads worth watching (they scroll out
   of the loaded feed). Kept only as the in-feed part of approach 1.
3. **Insert the watched post at the top of the feed / interleave into Bluesky's
   notification list.** Matches the original wording, but Bluesky owns those
   list rows; fragile and complex. Rejected.

## Design

### Watching

- **Bell button** in each post's action row, after Bluesky's built-in buttons,
  styled like them (outline bell = not watched, filled bell = watched, with a
  tooltip "Watch for new replies" / "Stop watching"). Applies to feed items,
  post pages and the post-view modal where the action row exists.
- **Hotkey `w`** toggles watch on the selected post (for an unrolled thread with
  sub-post selection, the selected sub-post). Shows a short confirmation (the
  script's existing status/toast style). Listed in the shortcut overlay.
- **Hotkey `W`** opens the notifications page on the Watched tab.
- Watching records, per post URI: author handle/DID, a text snippet, when it was
  watched, the set of reply URIs already known (all current replies count as
  seen at watch time), and the unseen new replies (URI, author, snippet,
  indexedAt).

Owner's calls so far: scope = everything below the watched post; grouped toasts.

### Detecting new replies

- Runs only when the API is available. Its own timer, separate from the 30 s
  notification poll: check watched posts **every 3 minutes**, staggered (one
  `getThread` call at a time, a short gap between calls), skipping a round while
  in rate-limit cooldown, and pausing while the tab is hidden (check once on
  becoming visible again).
- For each watched post, walk the returned tree, collect every reply URI below
  it, and diff against the known set. New URIs are added to the unseen list and
  the known set.
- Deleted / not-found watched posts: mark the watch as "post unavailable" in the
  Watched tab and stop polling it.
- Limits (builder's call on exact values, suggested): at most **50 watched
  posts**; a watch with no new replies for **30 days** expires automatically;
  known-reply sets are capped per post (e.g. 2,000 URIs) to bound storage.

### Seen

New replies stop counting as unseen when the owner:
- clicks the toast for them,
- opens that watched post's entry in the Watched tab,
- opens the watched post's page (its thread view), or
- dismisses them in the Watched tab ("mark seen").

Dismissing a toast without clicking (timeout, `x`, close button) does not mark
them seen — they remain in the Watched tab and badge.

### Toasts

- A new toast type `watch` (bell icon) in the existing toast system, shown only
  when `toastNotifications` is on.
- One toast per watched post per check: "@alice replied in a thread you're
  watching" for one reply, "3 new replies in a thread you're watching" for
  several, with the newest reply's snippet as the preview.
- Clicking opens the newest new reply (one reply) or the watched post's page
  (several), and marks them seen. It does not mark Bluesky notifications seen.
- On page load, the first check toasts replies that arrived while away, like the
  existing behavior for unread notifications.

### Watched tab (notifications page)

- An extra "Watched" tab added next to Bluesky's tabs on `/notifications`, with a
  count when there are unseen replies. Selecting it hides Bluesky's list and
  shows the script's own list; selecting another tab restores Bluesky's view.
  Re-inserted if React re-renders the tab bar.
- The list shows watched posts, those with unseen replies first (newest
  activity first), each with: author, snippet, watched time, and its unseen new
  replies (author, snippet, time). Clicking a reply or the post opens it and
  marks that post's replies seen.
- Per entry: "Mark seen" and "Stop watching". Empty state explains how to watch
  (bell or `w`) and, when the API login is missing, that checking needs it.
- `W` (and a direct URL, e.g. `/notifications#watched`, builder's call) open the
  tab.

### Badge

- A small count badge on Bluesky's Notifications link in the left sidebar, for
  unseen watched replies, visually distinct from (and next to) Bluesky's own
  unread badge. Not merged into Bluesky's number.

### In the feed

- With hide-read on, a watched post that has unseen new replies is not hidden
  even if read (hook: the read check in the feed item filter,
  `src/handlers/FeedItemHandler.js` ~1562). Its thread's other read posts follow
  the normal rules.
- Watched posts in the feed show the filled bell; those with unseen replies also
  get a count badge on the bell.

### Sync and multiple tabs (owner's decisions)

- **Everything syncs across devices** (owner's choice): the watch list, each
  watch's known replies, its unseen replies and seen status. This uses the
  script's optional remote state sync, so it only crosses devices when that
  sync server is configured; otherwise watches stay per device.
- **Per-record storage and merge, not the shared state blob.** The general
  state syncs as one `state:current` record where the newest copy wins
  (`src/StateManager.js`); watch data changes every check, so a stale copy would
  drop or resurrect watches and undo "mark seen". Watches are instead stored and
  synced one record per watched post, modeled on how `seen` is merged
  (`mergeSeen` and its own remote table): merging is per watch, a removal is a
  tombstone so it isn't brought back by an older copy, known-reply sets merge
  as unions, and a reply seen on any copy stays seen.
- **Local writes merge too.** Every save re-reads the stored watch records and
  merges into them rather than overwriting, so two tabs on one device don't
  clobber each other even with remote sync off.
- **Only the visible tab checks** (owner accepted). Checking pauses while a tab
  is hidden, so with several tabs in one window only the one in view polls. Two
  windows side by side may both check and occasionally toast the same reply;
  accepted. No cross-tab locking or messaging.
- Remote state is only loaded at page load today; tabs don't see each other's
  updates live. Accepted: merges reconcile on the next save/load.
- Storage size: known-reply sets are the bulk (cap per watch, e.g. 2,000 URIs);
  only changed watch records are uploaded.

### Settings

- A "Watch threads" toggle (default on) and the check interval (default 3 min)
  in the config modal, near the toast settings. Watch toasts follow the existing
  `toastNotifications` setting.

## Left to the builder

- Exact bell markup/placement within the action row and how it is re-applied on
  re-render; icon SVG.
- Storage shape and exact caps, within the per-record sync design above (a
  separate GM key and remote table for watches, not `DEFAULT_STATE`).
- Tab markup matching Bluesky's tab bar, and the list styling (light/dim/dark).
- Thread depth parameter value.
- Tests: unit tests for the pure parts (reply-tree diff, grouping, seen
  bookkeeping, caps/expiry); e2e coverage where the logged-in CI can reach it.
