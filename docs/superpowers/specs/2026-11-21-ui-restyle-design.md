# UI restyle: consistency, selection, native sidecar

Date: 2026-11-21
Status: approved (owner asked to apply the review's recommended answers and proceed)

## Intent

The userscript's own UI works but looks unfinished. The owner's main complaint
is **no consistency**: the toolbar, status bar, settings modal, toasts, overlays,
sidecar and new sidebar toggle each pick their own colors, radii, shadows and
dark-mode handling. Two specific problems on top of that:

- **Selection is confusing.** When a post inside a thread (or a reply inside an
  unrolled thread) is selected, the thread, the post and the reply each draw
  their own outline, so the user sees nested rings and can't tell at a glance
  where they are. They want a clearer highlight of the active post and thread.
- **The thread sidecar looks like a poor facsimile of real Bluesky posts.** It
  is shaped like a post but doesn't match Bluesky's spacing, type, colors or
  icons.

Success: the UI reads as one coherent system that sits naturally inside
Bluesky in all three Bluesky themes, the current post is obvious with a single
marker, and sidecar/unrolled posts look like Bluesky's own posts.

## Goals

1. A shared design-token layer (colors, radii, shadows, spacing, type sizes)
   that all restyled components use.
2. Theme follows **Bluesky's own Light / Dim / Dark setting**, not the OS
   `prefers-color-scheme`. (Today 39 dark-mode blocks key off the OS, so the
   userscript UI clashes whenever the two disagree.)
3. Selection style **A — accent bar + tint** (chosen from mockups):
   - The active thread gets a soft background tint in the accent color and a
     ~3px accent bar on its left edge.
   - Exactly one strong marker — a single lifted ring (2px accent ring plus a
     soft accent shadow) — on the focused unit: the post itself, or the
     focused reply inside an unrolled thread.
   - No other rings: remove the nested thread/parent outlines and the 1px gray
     outlines around unrolled replies.
   - Read/unread keeps its mechanism (opacity + background); see "Resolved
     after builder review" §2 for theming.
4. Sidecar **faithful native** (chosen from mockups): sidecar posts and
   unrolled-thread replies match Bluesky's real post layout — 36px avatars,
   display name · handle · age on one line, Bluesky's type scale and text
   colors, a thread connector line joining the parent to the replies (instead
   of the dashed parent box), Bluesky's reply/repost/like icons and spacing,
   and Bluesky's radii/borders on image, quote and link embeds.
5. Remaining components restyled onto the tokens: toolbar, status bar,
   settings modal (incl. rule builder, timeouts panel), toasts/action
   feedback, shortcut overlay, post view modal, reader mode, filter pill,
   new-posts pill, breadcrumb, saved searches, popups (list category, timeout,
   add-to-rules, profile hover card), bottom sheet, skeleton loaders, fixed
   sidecar panel chrome and toggle, left sidebar toggle. "Modern flair" here
   means consistent radii, layered soft shadows, subtle hover/press
   transitions, and coherent spacing — not new features.

## Non-goals

- **The feed map is out of scope entirely** — its styles, themes
  (campfire/ocean/forest/monochrome), tooltip and current-segment marker stay
  as they are (style.css "Scroll Position Indicator", "Scroll Indicator
  Themes", "Feed Map Tooltip" sections). The owner may revisit it later.
- No behavior or feature changes beyond styling (the selection change is
  visual only; navigation logic is untouched).
- No new settings except where needed to keep existing ones meaningful.
- Mobile layout redesign. Mobile must not regress, but isn't being redesigned.

## Anti-goals (failure even if it "works")

- The userscript UI looking out of place against Bluesky in any of its three
  themes.
- Breaking users' customized style settings (see Constraints).
- Any visible change to the feed map.
- Nested or competing selection markers anywhere.

## Constraints

- **User-editable style settings must keep working.** Settings such as
  `posts`, `selectionActive`, `selectionInactive`, `selectionChildFocused`,
  `replySelectionActive`, `replySelectionInactive`, `unreadPosts*`,
  `readPosts*` are raw CSS strings injected by `main.js`. New defaults may
  change (that is how selection style A ships), but a user who has customized
  a value keeps their value and it must still apply.
- Single stylesheet `src/assets/css/style.css` (~6,900 lines) plus CSS
  generated in `main.js`, sidecar templates in `src/sidecar.html` (some
  embed templates use inline `style=` attributes and copied Bluesky hashed
  class names), and inline styles set from JS in several components.
- Bluesky ships its own styles and hashed class names that change; userscript
  styles must not depend on Bluesky's hashed classes and must not leak into
  Bluesky's own UI.
- Desktop and mobile (≤800px) must both keep working; existing
  accessibility features (focus-visible rings, high-contrast and
  reduced-motion handling in the custom-properties section) must be kept.
- Screenshot capture (`c` / clean `C`, html-to-image) must still produce
  correct images.

## Approaches considered

1. **Token layer in the existing stylesheet, migrate components
   incrementally** — *chosen.* Add CSS variables at the top of
   `style.css` (with Light/Dim/Dark values keyed off Bluesky's theme), then
   move components onto them one at a time, retiring hard-coded colors and
   `prefers-color-scheme` blocks per component. Fits the current build,
   reviewable in steps, a Bluesky restyle becomes a token retune. Cost:
   `style.css` stays one big file.
2. **Rewrite into per-component stylesheets around the same tokens** —
   cleanest end state, but one huge diff over all 6,900 lines including the
   feed map, and hard to verify in one pass.
3. **Adopt a CSS framework (e.g. Tailwind)** — ruled out: adds weight to a
   userscript, its resets fight Bluesky's styles, every template rewritten.

## Decided

- Approach 1.
- Selection style A as described in Goal 3.
- Sidecar faithful native as described in Goal 4; unrolled-thread replies get
  the same treatment because they share the sidecar body/footer templates.
- Theme follows Bluesky's setting (Light / Dim / Dark).
- Feed map untouched.

## Resolved after builder review

Settled by the owner's instruction to apply the recommended answers:

1. **Sidecar reply focus.** When focus moves into the sidecar (inline or fixed
   panel), the focused sidecar reply carries the single ring. The main post
   drops to the thread treatment (tint + accent bar only, no ring). New
   default for `selectionChildFocused` = no outline; `replySelectionActive` =
   the same lifted ring as `selectionActive`. The tint/bar stay on the main
   column's thread; the sidecar column/panel is not tinted.
2. **Read/unread across three themes.** The mechanism stays (opacity + a
   background per theme, user-editable), but the selectors switch from
   `prefers-color-scheme` to Bluesky's theme: the `*LightMode` settings apply
   in Light, the `*DarkMode` settings apply in Dim and Dark. Their defaults
   change to theme tokens (e.g. surface / muted-surface) so they look right
   in all three; customized values are preserved.
3. **Sidecar structure.** Keep the collapsible Parent / Replies sections
   (no behavior change) but restyle their headers as quiet, native-looking
   labels ("Replying to", "Replies · N"). Drop the `↙️` indicator and the
   dashed parent box. The parent's avatar column gets Bluesky's connector
   line running to the bottom of its row to signal continuation; no stub for
   the selected post.
4. **Unrolled-thread markers.** Keep the "N/M" badges and first/last
   markers (they're features), restyled with tokens: neutral pill badges,
   accent for the current one; the green/red text becomes subtle token
   colors.
5. **Accent = `focusRingColor`.** One source of truth: `--focus-ring-color`
   drives the ring, and the thread tint/bar are derived from it with
   `color-mix`. A user's custom color therefore also tints the thread. The
   default may move to a blue that works in Light/Dim/Dark (builder picks);
   customized values are preserved.
6. **Thread progress bar** (`.feed-map-thread-segment`, "styled like mini
   basic feed map") counts as feed map: out of scope, untouched.

## Suggested delivery order

Each step is independently shippable and reviewable:

1. Tokens + Bluesky theme detection (no visual change yet beyond theme
   correctness of already-tokenized bits).
2. Selection style A (new defaults for the selection settings + thread
   tint/accent CSS; remove nested outlines).
3. Native sidecar + unrolled replies (templates and CSS).
4. Remaining components, grouped (modal & rule builder; overlays, toasts &
   popups; toolbar, status bar & panels).

## Left to the builder

- Exact token names, values and how many tokens; the accent color (must sit
  well with Bluesky's own blue in all three themes).
- How Bluesky's active theme is detected (e.g. measuring the shell
  background as `LeftSidebar.js` already does, or anything Bluesky exposes on
  `html`/`body`) and how changes to it are picked up live.
- Exact measurements for the native sidecar, taken from Bluesky's live page
  and/or the `social-app` source, kept in one place.
- How existing users' unmodified selection settings pick up the new defaults
  while customized ones are preserved.
- Whether thread-level tint applies to single (non-thread) posts too, as long
  as there's exactly one strong marker on the focused unit.
- Commit/PR granularity within the delivery order.
