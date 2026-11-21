# Fit Posts to Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Display setting, "Fit posts to screen", that keeps every feed post within the part of the screen not covered by the toolbar, the tabs, the feed map, the status bar, or Bluesky's mobile bottom bar. Media shrinks first, and the post scrolls inside itself if it's still too tall.

**Architecture:** A new module, `src/fitPosts.js`, measures the unobstructed height and writes it to `--bsky-nav-fit-height` on `<html>`. It re-measures on resize, on layout changes, and when the bars change size. It also toggles `body.bsky-nav-fit-posts`. All capping is CSS under that body class. `ItemHandler` gets one helper so that `j`/`k` scroll inside a capped post before moving on. Unrolled threads switch from their fixed `80vH` to the same height through a CSS override. Without the body class, every rule is inert, so turning the setting off restores today's behavior.

**Tech Stack:** Vanilla JS and jQuery (global `$`), a vite userscript build, and scratchpad Playwright scripts for verification.

**Spec:** `docs/superpowers/specs/2026-11-21-fit-posts-to-screen-design.md`

## Global Constraints

- The setting key is `fitPostsToScreen`. It's a `checkbox`, default `false`, labeled `Fit posts to screen`, and goes in the Display section of `src/components/ConfigModal.js` directly after `postMaxHeight`. Its help text is `Cap posts at the visible screen height; media shrinks first, then the post scrolls`.
- Media is capped at 70% of the visible height. Define it once, as `--bsky-nav-fit-media-height: calc(var(--bsky-nav-fit-height) * 0.7)` in style.css, and nowhere else.
- Setting off: `body.bsky-nav-fit-posts` is absent and no rule from this plan applies. Toggling in Settings takes effect live, without a reload.
- Don't depend on Bluesky's hashed classes (`css-*`, `r-*`). Use `data-testid`, element types, `role` and our own classes (`.item`, `.unrolled-replies`, and so on). Every new selector is scoped under `body.bsky-nav-fit-posts`.
- Sidecar posts (`.sidecar-replies`, `.sidecar-post`, the fixed sidecar panel) are never capped.
- Leave the feed map's styles alone: don't edit the style.css region from the `Scroll Position Indicator` header through the line before `Breadcrumb Trail`, or `src/handlers/feedMapUtils.js`.
- Screenshots (`c` and `C`) capture the whole post. Caps are lifted while a capture runs.
- Mouse-wheel scrolling over a capped post must chain to the page once the post reaches its end. Use `overscroll-behavior: auto` on capped items, never `contain`.
- Mobile (≤800px) must not regress.
- Owner rules: no commits until asked, no `git stash`, don't run `npm test` unless asked, US English, semicolons are fine (`.prettierrc` has `semi: true`).

## Review Focus

1. **Top and bottom measurement disagreeing.** The cap must come from the same `getToolbarHeight()` and `getStatusBarHeight()` numbers that scrolling uses. Otherwise a capped post is a few pixels "too tall" for `scrollElementIntoView`, which pages it endlessly. Task 1 asserts a scrolled-into-view capped post sits exactly between the bars. Task 2 asserts `j` leaves it, rather than paging, once its inner scroll is at the end.
2. **Wheel getting stuck inside a capped post.** Task 1 asserts the computed `overscroll-behavior-y` is `auto`, and that a wheel past the end of a capped post moves `window.scrollY`.
3. **Images getting cropped or stretched instead of shrunk.** Task 1 asserts each capped image's rendered aspect ratio is within 3% of its natural ratio.
4. **The feed map moving between the top and bottom bars**, so the visible height changes without a resize. Task 1 asserts `--bsky-nav-fit-height` updates after `feedMapPosition` changes.
5. **Unrolled threads scrolling twice, nested**, once in the item and once in the thread container. Task 3 asserts the item holding `.unrolled-replies` doesn't scroll itself.

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/fitPosts.js` (new) | `measureToolbarHeight()` and `measureStatusBarHeight()`, moved from ItemHandler. `measureBottomBarHeight()` for mobile. `computeFitHeight()`. `setFitPostsEnabled(enabled)` owns the body class, the watcher and the CSS variable | 1 |
| `src/handlers/ItemHandler.js` | `getToolbarHeight`/`getStatusBarHeight` delegate to fitPosts. Screenshot lift. `scrollInsideItem`, `resetItemInnerScroll`, `j`/`k` wiring. Unrolled-container marker class and chrome variable | 1, 2, 3 |
| `src/main.js` | Call `setFitPostsEnabled(config.get('fitPostsToScreen'))` next to `updatePostMaxHeight()` | 1 |
| `src/components/ConfigModal.js` | The setting | 1 |
| `src/assets/css/style.css` | New `Fit Posts to Screen` section, placed after the feed map region, before `Breadcrumb Trail` | 1, 3 |

Scratchpad `$S` = `/private/tmp/claude-501/-Users-tonyc-dev--projects-bluesky-navigator/1eac83e0-dd42-4d30-a976-8f74b073d00f/scratchpad`. Reuse its helpers:

- `uikit.mjs`: `boot({ theme, config, viewport, api, threadFixture, url })` returns `{ browser, ctx, page }`, loads the built `dist` script into logged-out bsky.app, and dismisses the signup dialog.
- `harness.mjs` and `mockapi.mjs`, as before. Pass `api: true` for thread and unroll fetches.

Run `npm run build` before each check, since the harness reads `dist`. Run scripts with `cd $S && node <name>.mjs`. A viewport of **1400×500** makes most image posts taller than the visible band. Use it for every "tall post" assertion. Red means the new script fails against the current build. Green means it passes after the change.

---

### Task 1: Measure the visible height, add the setting, and cap posts and media in CSS

**Files:**
- Create: `src/fitPosts.js`
- Modify:
  - `src/handlers/ItemHandler.js:3839-3870` (the two measuring methods)
  - the screenshot capture at `src/handlers/ItemHandler.js:~3158` and `~3236`
  - `src/main.js:~444` (inside `updateContentWidth`, next to `updatePostMaxHeight()`)
  - `src/components/ConfigModal.js:~34`
  - `src/assets/css/style.css`
- Test: `$S/fit1.mjs`

**Interfaces:**
- Produces, in `src/fitPosts.js`:
  - `export const FIT_HEIGHT_VAR = '--bsky-nav-fit-height'`
  - `export const FIT_BODY_CLASS = 'bsky-nav-fit-posts'`
  - `export const FIT_CAPTURE_CLASS = 'bsky-nav-fit-capture'`
  - `export function measureToolbarHeight(): number`: the existing `getToolbarHeight` body, moved verbatim, including the 60px minimum and the 4px ring space.
  - `export function measureStatusBarHeight(): number`: the existing `getStatusBarHeight` body, moved verbatim.
  - `export function measureBottomBarHeight(): number`: the height of Bluesky's fixed bottom tab bar when it's visible and at most 800px wide, otherwise 0. Find a stable, non-hashed selector for it in the live mobile DOM, such as a `role` or `data-testid`, and record the one you chose in a code comment. Return 0 when none is found.
  - `export function computeFitHeight({ innerHeight, top, bottom }): number`: `Math.max(0, Math.floor(innerHeight - top - bottom))`.
  - `export function setFitPostsEnabled(enabled: boolean): void`. It's idempotent. When enabled, it:
    - adds `FIT_BODY_CLASS`
    - measures once, writing `${px}px` to `FIT_HEIGHT_VAR` on `document.documentElement`
    - starts one watcher, throttled with `requestAnimationFrame`, on window `resize`, on `LAYOUT_CHANGED_EVENT` (from `src/components/LeftSidebar.js`), and on a `ResizeObserver` over the toolbar (`#bsky-navigator-toolbar, #bsky-navigator-global-toolbar`), `#statusBar` and the tab bar (`div[data-testid="profilePager"], div[data-testid="homeScreenFeedTabs"]`). It re-queries those elements on `LAYOUT_CHANGED_EVENT`, since they can be re-rendered.
    - Here `top = measureToolbarHeight()` and `bottom = measureStatusBarHeight() + measureBottomBarHeight()`.

    When disabled, it removes the class, removes the variable and stops the watcher.
- Produces in ItemHandler: `getToolbarHeight()` returns `measureToolbarHeight()`, and `getStatusBarHeight()` returns `measureStatusBarHeight()`. Behavior is unchanged.

- [ ] **Step 1: Write `$S/fit1.mjs`**

  It boots at 1400×500 with `{ fitPostsToScreen: true }` unless a case says otherwise, waits for at least 5 `.item` elements, and asserts each case below. It prints `PASS <name>` or `FAIL <name>: <details>` per case and exits non-zero on any failure.
  - `var_set`: `parseFloat(getComputedStyle(html).getPropertyValue('--bsky-nav-fit-height'))` is greater than 0.
  - `items_capped`: every `.item` that isn't inside a sidecar has `getBoundingClientRect().height <= fit + 1`. At least one item has `scrollHeight > clientHeight + 1` or contains an image shrunk below its natural layout height. The second condition proves the page exercised a tall post. If none does, fail with "no tall post on page" rather than passing.
  - `fits_between_bars`: select a capped item with `j` until its index is current. Wait 300ms. Then:
    - `item.top >= toolbar.getBoundingClientRect().bottom - 1`, using `#bsky-navigator-toolbar`, or the tab bar if it's lower
    - `item.bottom <= statusBar.getBoundingClientRect().top + 1`
  - `media_capped_aspect`: for every `img` inside `.item [data-testid="contentHider-post"]` with `naturalWidth > 0` and a rendered height over 50px:
    - its rendered height is at most `fit * 0.7 + 1`
    - `|(w/h) - (naturalWidth/naturalHeight)| / (naturalWidth/naturalHeight) < 0.03`, using the rendered box `w`/`h` and taking `object-fit` into account; if `object-fit` is `contain`, use the painted content box
    - also check `video` elements, which must be capped at the same height
  - `wheel_chains`: the computed `overscroll-behavior-y` of a capped item is `auto`. Put the mouse over an item with inner scroll, set its `scrollTop` to the maximum, and wheel `deltaY: 400`. `window.scrollY` increases.
  - `sidecar_uncapped`: with `api: true`, open the sidecar on a post (`boot` with `api: true`, then the same steps `v4.mjs`/`v5.mjs` use). The computed `max-height` of `.sidecar-replies` and each `.sidecar-post` is not the fit height.
  - `resize_updates`: `page.setViewportSize({ width: 1400, height: 700 })`. Within 500ms the variable grows by about 200, ±2.
  - `feedmap_move_updates`: change `feedMapPosition` from `Bottom status bar` to `Top toolbar` through Settings (Alt+., Feed Map tab, Save). The variable changes, and `fits_between_bars` holds again.
  - `off_inert`: boot with `fitPostsToScreen: false`. `body` doesn't have `bsky-nav-fit-posts`, the variable is empty, and the computed `max-height` of `.item` is `none`.
  - `live_toggle`: boot off, enable the checkbox in Settings (Display), Save. `var_set` and `items_capped` pass without a reload. Disable it and Save, and `off_inert` passes.
  - `collapse_combo`: boot with `fitPostsToScreen: true` and `postMaxHeight: '25vh'`. Unselected items' `contentHider-post` stays at most `0.25 * innerHeight + 1`. The selected item stays within `fit + 1` even though its `contentHider-post` expands.
  - `capture_lift`: add `bsky-nav-fit-capture` to a capped item. Its computed `max-height` is `none` and `overflow-y` is `visible`, and inner images are no longer capped. Remove the class and the cap returns.
  - `mobile_bottom_bar`: boot at 390×844. If `measureBottomBarHeight` finds a bar, the selected item's bottom is at most the bar's top + 1. If not, log `SKIP mobile_bottom_bar: no bottom bar logged out` and don't count it as a failure.

- [ ] **Step 2: Run red**

  Run `npm run build && cd $S && node fit1.mjs`. Expected: `var_set` and `items_capped` fail, and `off_inert` passes.

- [ ] **Step 3: Implement `src/fitPosts.js`** with the interface above. Move the two measuring bodies out of ItemHandler and delegate to them. Don't copy them.

- [ ] **Step 4: Add the setting** to ConfigModal as specified in Global Constraints. In `main.js`, import `setFitPostsEnabled` and call `setFitPostsEnabled(!!config.get('fitPostsToScreen'))` right after `updatePostMaxHeight()` inside `updateContentWidth()`. That function runs at startup and on every config save.

- [ ] **Step 5: Add the `Fit Posts to Screen` CSS section**, after the feed map region and before `Breadcrumb Trail`. It contains:
  - `:root { --bsky-nav-fit-media-height: calc(var(--bsky-nav-fit-height) * 0.7); }`
  - `body.bsky-nav-fit-posts .item:not(.bsky-nav-fit-capture)` gets:
    - `max-height: var(--bsky-nav-fit-height)`
    - `overflow-y: auto`
    - `overscroll-behavior: auto`
    - `scrollbar-width: thin`
  - Media inside `body.bsky-nav-fit-posts .item:not(.bsky-nav-fit-capture) [data-testid="contentHider-post"]` (images, videos and embed thumbnails) is capped at `var(--bsky-nav-fit-media-height)` with its aspect ratio kept.
    - Bluesky wraps media in containers whose height comes from the aspect ratio, so capping only the `img` can leave a tall empty box. Inspect the live DOM at 1400×500 and cap the element that sets the height, using `data-testid`, element type or structure, never hashed classes. Shrink the width to match, for example with `max-width` derived from the ratio, or `width: auto` together with `object-fit: contain`.
    - Whatever technique you choose has to pass `media_capped_aspect`. Write a one-line comment naming the DOM shape it relies on.
  - Make sure the `.item` cap doesn't clip the selection ring. The ring is drawn on the item's own outline or box-shadow, which `overflow` doesn't clip. Check visually in one screenshot under `$S`.

- [ ] **Step 6: Screenshot lift.** Where capture adds `bsky-nav-clean-capture` (around `ItemHandler.js:3158`), also add `FIT_CAPTURE_CLASS` to `item`. Remove it where `bsky-nav-clean-capture` is removed (around `:3236`). Do this for both `c` and `C`: if the add sits inside a clean-only branch, put the fit-class add outside that branch, and likewise the removal. Make sure the removal also runs on the error path. If the capture has a `finally`, put it there; otherwise add one.

- [ ] **Step 7: Run green**

  Run `npm run build && cd $S && node fit1.mjs`. Every case should pass, with `mobile_bottom_bar` allowed to SKIP.

- [ ] **Step 8: Lint** the changed JS against `$S/lint-before-all.txt`, with no new problems. Run `npx prettier --check src/fitPosts.js`.

---

### Task 2: `j`/`k` scroll inside a capped post before moving on

**Files:**
- Modify: `src/handlers/ItemHandler.js`. That means the normal-post branches of the `j`/`ArrowDown` and `k`/`ArrowUp` handlers (around `:2218-2230` and `:2250-2262`), plus `jumpToNext`/`jumpToPrev` (around `:2753`).
- Test: `$S/fit2.mjs`

**Interfaces:**
- Consumes: `FIT_BODY_CLASS` from `src/fitPosts.js`, and the CSS cap from Task 1.
- Produces in ItemHandler:
  - `scrollInsideItem(el: Element, direction: 1|-1): boolean`. It returns false unless `document.body` has `FIT_BODY_CLASS` and `el.scrollHeight > el.clientHeight + 1`.
    - Going down: when `el.scrollTop + el.clientHeight >= el.scrollHeight - 1`, it returns false. Otherwise it adds `Math.min(el.clientHeight * 0.5, remaining + 10)` to `scrollTop`, where `remaining = el.scrollHeight - el.clientHeight - el.scrollTop`, and returns true.
    - Going up: symmetric, with `remaining = el.scrollTop`. It returns false when `scrollTop <= 1`.
    - Smooth scrolling follows `enableSmoothScrolling`, as in `scrollThreadPostIntoView`.
  - `resetItemInnerScroll(el: Element, direction: 1|-1): void`. With the setting on, it sets `el.scrollTop` to 0 when `direction > 0`, and to `el.scrollHeight` when `direction < 0`, so entering with `k` starts at the bottom. With the setting off, it does nothing.

- [ ] **Step 1: Write `$S/fit2.mjs`**

  It boots at 1400×500 with `fitPostsToScreen: true`. It presses `j` until the selected `.item` has `scrollHeight > clientHeight + 1`, failing with "no tall post on page" if none appears within 40 items. Let `T` be its index. Cases:
  - `j_scrolls_inside`: right after landing on `T`, `scrollTop === 0`. Each `j` raises `scrollTop` while the selected index stays `T` and `window.scrollY` stays put (±2), until `scrollTop` reaches its maximum (±1). The next `j` selects `T+1`.
  - `j_step_size`: the first in-post `j` moves `scrollTop` by `min(clientHeight*0.5, remaining+10)`, ±2, with smooth scrolling off (`enableSmoothScrolling: false`).
  - `k_enters_at_bottom`: from `T+1`, `k` selects `T` with `scrollTop` at its maximum (±1). Each further `k` lowers it until 0. The next `k` selects `T-1`.
  - `off_unchanged`: boot with `fitPostsToScreen: false` and the same viewport. On a post taller than the band, `j` changes `window.scrollY` and keeps the index, which is the existing paging. No `.item` has `scrollTop > 0`.

- [ ] **Step 2: Run red**

  Run `npm run build && cd $S && node fit2.mjs`. Expected: `j_scrolls_inside` and `k_enters_at_bottom` fail, and `off_unchanged` passes.

- [ ] **Step 3: Implement** the two methods. In both normal-post branches, call `if (this.scrollInsideItem(this.selectedItem[0], dir)) { /* consumed */ } else { <existing branch unchanged> }` first. In `jumpToNext` and `jumpToPrev`, after `setIndex` changes the selection, call `this.resetItemInnerScroll(this.selectedItem[0], ±1)`. Don't change any other navigation path.

- [ ] **Step 4: Run green**

  Run `npm run build && cd $S && node fit2.mjs`, then re-run `node fit1.mjs` to check for regressions. Both should pass.

- [ ] **Step 5: Lint**, with no new problems against the baseline.

---

### Task 3: Unrolled threads use the visible height

**Files:**
- Modify:
  - `src/handlers/ItemHandler.js`: the unroll container setup around `:1636` and `_renderProactiveUnroll` around `:8004`
  - `src/assets/css/style.css`: the `Fit Posts to Screen` section
- Test: `$S/fit3.mjs`

**Interfaces:**
- Consumes: `FIT_HEIGHT_VAR` and `FIT_BODY_CLASS` from Task 1.
- Produces:
  - Both unroll paths add the class `bsky-nav-unroll-scroll` to the container, which is the parent of `contentHider-post`. They keep their existing inline `80vH`, which stays the behavior with the setting off.
  - After the replies are inserted, they set the inline custom property `--bsky-nav-unroll-chrome` on the container to `${item.offsetHeight - container.offsetHeight}px`. That is the post's header and action bar, outside the scrolling area.
  - The measurement goes in one shared private helper, `_markUnrollContainer($item, $container)`, called from both paths, not written twice.

- [ ] **Step 1: Write `$S/fit3.mjs`**

  Find a self-thread through the public API: an author feed where a post's `getPostThread` replies include the same author. `make-fixture.mjs` shows the fetch style. Load that author's profile, `url: https://bsky.app/profile/<handle>`, with `api: true`, at 1400×500, and wait for `.unrolled-replies`. Cases:
  - `fit_on`, with `fitPostsToScreen: true`:
    - the item holding `.unrolled-replies` has `getBoundingClientRect().height <= fit + 1`
    - that item's `scrollHeight <= clientHeight + 1`, so it doesn't scroll itself
    - the container's computed `max-height` equals `fit - chrome`, ±1
  - `fit_off`, with `false`: the container's inline `max-height` is `80vH`, and its computed `max-height` equals `0.8 * innerHeight`, ±1.
  - `live_toggle`: from off, enable the setting in Settings and Save, and `fit_on` holds without re-rendering. Disable it, and `fit_off` holds.

- [ ] **Step 2: Run red**

  Run `npm run build && cd $S && node fit3.mjs`. Expected: `fit_on` fails and `fit_off` passes.

- [ ] **Step 3: Implement** `_markUnrollContainer` and call it from both paths. Add the CSS:
  - `body.bsky-nav-fit-posts .item:has(.unrolled-replies) { max-height: none; overflow-y: visible; }`. The item stops scrolling and its container scrolls instead. Put this rule after the Task 1 `.item` rule so it wins.
  - `body.bsky-nav-fit-posts .bsky-nav-unroll-scroll { max-height: calc(var(--bsky-nav-fit-height) - var(--bsky-nav-unroll-chrome, 0px)) !important; }`. The `!important` beats the inline `80vH`. That precedence is why the rule exists, so say so in a one-line comment.
  - Under `.bsky-nav-fit-capture`, lift the container cap too: `body.bsky-nav-fit-posts .bsky-nav-fit-capture .bsky-nav-unroll-scroll { max-height: none !important; overflow: visible !important; }`. This rule has higher specificity than the one above, so it wins regardless of order.

- [ ] **Step 4: Run green**

  Run `npm run build && cd $S && node fit3.mjs && node fit1.mjs && node fit2.mjs`. All should pass.

- [ ] **Step 5: Lint**, with no new problems. Then run a final `git status --short`: only `src/`, `docs/` and `dist/` should have changes, with no stray files.
