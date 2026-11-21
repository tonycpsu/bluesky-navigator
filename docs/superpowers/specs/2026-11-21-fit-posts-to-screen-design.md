# Fit posts to screen

Date: 2026-11-21
Status: approved

## Intent

A post should never be taller than the part of the screen you can actually
see. That space is the window minus everything drawn over the feed: the
navigator toolbar, Bluesky's feed or profile tabs, the feed map (which sits in
the toolbar or the status bar), and the status bar.

Today ordinary posts have no height cap. On a tall post, `j`/`k` page the
window half a screen at a time. Unrolled self-threads are capped at a fixed
`80vh` and scroll inside themselves, but that 80% ignores the bars, so their
bottom can still be hidden.

## Behavior

A new Display setting, **Fit posts to screen** (checkbox, default off, so
nothing changes for existing users):

1. **Shrink media first.** Images, videos and link or quote embeds inside a
   post are capped at 70% of the visible height and keep their aspect ratio.
   The rest is left for the text around them.
2. **Then scroll inside.** The whole post is capped at 100% of the visible
   height. Anything still too tall, such as long text, scrolls inside the post.
3. **`j`/`k` scroll inside the post first**, the same way they already do in
   unrolled threads, and only then move to the next or previous post.
4. **Unrolled threads use the same visible height** instead of `80vh`, but only
   when the setting is on. With it off they stay as they are.
5. **Interaction with "Collapse posts":** posts you aren't on still collapse to
   their 25/50/75vh cap. The post you're on expands only as far as the visible
   height, not without limit.

## Approach (owner picked A)

- **A, chosen:** a single measured value plus CSS. A small module measures the
  visible height and keeps it current. It re-measures on window resize, on
  changes to the bars' size and visibility, on layout-change events, and when
  `feedMapPosition` changes. It writes the result to one CSS custom property
  on `<html>`, and CSS does the rest. This is cheap, does no work per post,
  and copes with images that load late. The cost is that media shrinks by a
  fixed 70% share even when there's little text.
- **B, rejected:** measuring each post on selection and sizing its media to
  fit exactly. It gives the tightest fit, but it runs on every selection,
  jumps when images finish loading, and leaves posts you aren't on uncapped.

## Constraints

- Follow the restyle rules (`2026-11-21-ui-restyle-design.md`):
  - Don't depend on Bluesky's hashed `css-*`/`r-*` classes. Use
    `data-testid`, element types and our own classes.
  - Don't leak styles into Bluesky's own UI.
  - Leave the feed map's own styles alone.
- Clean and regular screenshots (`C`/`c`) capture the whole post. The cap and
  the internal scroll are lifted during capture.
- Mobile (≤800px) must not regress. Bluesky's own bottom tab bar also counts
  as something drawn over the feed.
- Turning the setting off restores today's behavior exactly, live, without a
  reload.

## Builder's calls (marked, owner can override)

- The setting's name, label and position in the Display tab. My proposal is
  next to "Collapse posts".
- The 70% media share, kept as a single constant rather than a new setting.
- Which element is "the post" for the height cap. Unrolled threads use the
  parent of `contentHider-post`, which is the likely candidate.
- Whether the existing `getToolbarHeight`/`getStatusBarHeight` helpers become
  the single source for the visible height, so that scrolling and the cap
  agree.
- Whether sidecar posts are capped too. My proposal is no, because the sidecar
  scrolls on its own.
