# Sidecar: Drill Into Replies

## Intent

The reply sidecar shows only a post's top-level replies, so there's no way to read
replies to replies without leaving the feed. The user wants to see replies to replies
from the sidecar, one level at a time: focus a reply, drill into it, and read its
replies.

## Goals

- From any reply in the sidecar that has replies, drill in to see that reply's replies,
  and keep drilling down the branch.
- Go back up one level at a time, landing on the reply you drilled from.
- `r` replies to the focused sidecar reply instead of the main post.
- The same works in the `v` post view, which reuses the sidecar content.

## Non-goals

- A tree or indented view of the whole conversation (considered and not chosen; see
  Approaches).
- A reply composer inside the sidecar.
- Changing which actions other keys (`p`, repost, and so on) apply to.

## Approaches

- **A. Indented tree:** replies to replies nested under their parent with thread lines,
  collapsible branches. Shows whole conversations at once, but the narrow sidecar runs
  out of width after a few levels.
- **B. Collapsed tree:** the same tree with every branch collapsed until expanded.
  Compact, but every nested reply costs a key press.
- **C. Drill-in (chosen by the user):** the sidecar shows one level at a time; drilling
  into a reply replaces the list with its replies, with a breadcrumb to go back. Every
  reply gets the full sidecar width.

## Design (as agreed)

### What you see

```
Thread Context                          ×
‹ Replies · Alice › Bob                 ← breadcrumb, click a part to go back to it
┌ Bob: disagree because…            (pinned: the reply drilled into)
│ ♡ 4  ↩ 3
├─────────────
  Alice: fair, but…        ↩ 2 ›     ← "›" marks replies that have replies
  Carol: no, look at…
  Dave: ok
```

- **Top level** is unchanged: "Replying to" (the main post's parent) and
  "Replies · N". Each reply with replies shows its reply count and a › marker.
- **Drilled in:** the reply drilled into is pinned at the top in place of "Replying
  to", followed by its replies. A breadcrumb shows the path from the top level; clicking
  any part of it goes back to that level.

### Keys and mouse

- **→** enters the sidecar from the main post, as today. On a focused reply that has
  replies, → drills into it and focuses its first reply.
- **←** goes up one level and refocuses the reply you came from. At the top level, ←
  leaves the sidecar, as today.
- `j`/`k`, arrows, PageUp/PageDown, Home/End, `o`/Enter and `l` behave as today, within
  the current level. The pinned reply is focusable like "Replying to" is today.
- **`r`** on a focused sidecar reply (at any level, including the pinned reply and
  "Replying to") opens that reply's post page and then opens Bluesky's own reply dialog
  for it there. With focus on the main post, `r` works as today.
- Clicking a reply's › marker or reply count drills into it.

### Data

- `getPostThread` already returns nested replies (Bluesky's default depth is 6), which
  the sidecar currently discards. Drill into those without another request.
- Drilling into a reply at the edge of the fetched data, whose replies weren't included,
  fetches that reply's thread at that point. Show a loading state while it loads and an
  error state if it fails.
- Selecting a different main post resets the sidecar to the top level.

### Unchanged

- Sidecar modes (Fixed and Inline), toggling with `t`, refreshing with `;`, the reply
  sort order setting, the width settings, and hover-to-focus.
- Replies already shown in an unrolled thread stay excluded at the top level.

## Left to the builder

- Where drill state lives (per main post, on the handler) and how the breadcrumb and
  pinned reply are rendered in `sidecar.html`.
- Whether the reply sort order applies at every level (expected: yes).
- How `r` waits for the post page and its reply button before clicking, and what
  happens if the button never appears (expected: stay on the page, no error dialog).
- Keeping the breadcrumb "Reply i/N" indicator and screen reader announcements
  meaningful at nested levels.
- Updating the README key table and the shortcuts overlay.
