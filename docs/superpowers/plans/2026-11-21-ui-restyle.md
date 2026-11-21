# UI Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the userscript's whole UI on one design-token layer that follows Bluesky's Light / Dim / Dark theme. Replace nested selection outlines with "accent bar + tint + one lifted ring". Make sidecar and unrolled-thread posts match Bluesky's native post layout.

**Architecture:** A new `src/theme.js` copies Bluesky's theme (the `theme--light|dim|dark` class Bluesky puts on `<html>`) into our own `html[data-bsky-nav-theme]` attribute and keeps it updated as the theme changes. `style.css` gets one token block (`--bsky-nav-*`) with Light defaults on `:root` and Dim/Dark overrides keyed on that attribute. Components then move onto the tokens one group at a time, and each group's `prefers-color-scheme` blocks are deleted. Existing users whose stored selection and read/unread settings still equal an old default get the new defaults through a one-time config migration. Customized values are left alone.

**Tech Stack:** Vanilla JS (ES modules), jQuery, Handlebars templates (`src/sidecar.html`), one CSS file, built by Vite into a Tampermonkey userscript. Verification uses Playwright (headless Chromium) scripts in the scratchpad.

**Spec:** `docs/superpowers/specs/2026-11-21-ui-restyle-design.md` (read it fully, including "Resolved after builder review").

## Global Constraints

- The **feed map is untouched**. Do not edit the `style.css` region from the `Scroll Position Indicator` header through the line before the `Breadcrumb Trail` header. That region includes `.feed-map-thread-segment`, the feed-map themes and the Feed Map Tooltip. Leave `src/handlers/feedMapUtils.js` alone. The 4 `prefers-color-scheme` blocks inside `style.css`'s feed map region stay as they are.
- **Known limitation (owner's call):** the feed map keeps following the OS `prefers-color-scheme`, so it can disagree with Bluesky's theme when the two differ. The feed map must not change through inheritance either (toolbar/status bar background, `font-family`, and so on). Task 1 records a feed map baseline and every task compares against it (see `feedMapStylesUnchanged` in Task 1).
- `npm run build` rewrites the tracked `dist/bluesky-navigator.user.js` (and `dist/bluesky-navigator.js`, `.meta.js`). That is expected. Do not revert or `git checkout` the `dist/` files.
- The theme comes from Bluesky's setting, not the OS. When this plan is done, the only `prefers-color-scheme` left in `style.css` is in the feed map region (4 blocks), and `src/` contains no `matchMedia('(prefers-color-scheme` calls.
- Userscript styles must not depend on Bluesky's hashed class names (`css-*`, `r-*`), and they must not leak into Bluesky's own UI. Every new selector is scoped to our own classes or IDs.
- Users' customized style settings keep their values, and those values still apply.
- Behavior does not change. Navigation logic, the selection class names and when they are toggled, and the collapsible section behavior all stay the same.
- Keep the existing accessibility behavior: `prefers-reduced-motion`, `prefers-contrast: more`, the `highContrastMode` and `reducedMotion` settings, and focus-visible rings.
- Mobile (≤800px) must not regress. Clean screenshots (`C`) must contain no ring, tint or bar.
- Use US English spelling. The code style has no semicolons in new JS (match the surrounding file). Do not run `prettier --write` on whole files.
- **No commits.** The owner commits only when asked. Every task ends with the changes left uncommitted.
- **Do not run `npm test`** (the Playwright e2e suite). Do not add a unit-test runner. Never touch `tests/user-data-firefox`.

## Review Focus

1. **Only some settings customized.** A user changed `selectionActive` (for example to a red outline) and left everything else at its default. Their red outline applies, the thread tint and bar still appear, and there is still exactly one ring. Tested in Task 2 (preservation) and Task 3 (ring count with a custom value).
2. **Theme switched while the page is open** (Bluesky Settings → Appearance). Every token-based surface recolors without a reload. Tested in Task 1 (class swap → attribute and token update).
3. **High contrast in Dim/Dark.** `highContrastMode` used to force a `#000000` ring, which is invisible on Dark. The ring must stay visible: it follows `--bsky-nav-text`, which is black in Light and white in Dim/Dark. The OS `prefers-contrast: more` path also has to work. Today it is silently overridden, because `main.js` always injects `--focus-ring-color` after `style.css` (see Task 3). Tested in Task 3.
4. **Clean screenshot (`C`) in Dim.** The image has no ring, tint or bar, and its background is the theme background, not white. Tested in Task 3.
5. **Fixed sidecar panel (the default `fixedSidecar: 'Fixed'`).** When focus moves into the panel, the focused panel reply carries the only ring and the main post keeps only the tint and bar. Tested in Task 3 for both Fixed and Inline modes.

---

## Decisions made while planning (spec "Left to the builder")

| Question | Decision |
|---|---|
| Theme detection | Bluesky's web app calls `updateDocument(theme)` in `src/alf/util/useColorModeTheme.ts`, which puts `theme--light`, `theme--dim` or `theme--dark` on `<html>`, sets `meta[name="theme-color"]` `content` to the theme background (`#FFFFFF` / `#151D28` / `#000000`, checked live), and writes `localStorage.ALF_THEME`. `detectBlueskyTheme` tries these signals in order:<br>1. The `theme--*` class.<br>2. The `meta[name="theme-color"]` content, mapped through the three exact backgrounds, or by luminance if it is another color.<br>3. `localStorage.ALF_THEME`, if it is `light`, `dim` or `dark` (wrapped in try/catch).<br>4. The shell background, found by walking up from `main[role="main"]` to the first background that isn't fully transparent; the same idea as `LeftSidebar.getShellBackground`. Luminance below 0.02 → dark, below 0.5 → dim, otherwise light.<br>5. If none of those gives an answer, it returns the last known theme, or `'light'` if there isn't one.<br>A fully transparent color (`rgba(…, 0)` or `transparent`) never counts as a signal: without the class, Bluesky's `body` background is `rgba(0, 0, 0, 0)`. The function also works when `document.body` is null. The result goes into `html[data-bsky-nav-theme]`. A `MutationObserver` watches `<html>`'s `class` and the meta tag's `content` (and `<head>` children, in case the meta tag is added later) and keeps the attribute updated live. All CSS keys off our attribute, so if Bluesky renames its class only one file has to change. |
| How tests set Bluesky's theme | Bluesky stores its preference in `localStorage.BSKY_STORAGE` as a full zod-validated object; `colorMode` is `light` or `dark`, and `darkTheme` is `dim` or `dark`. The scratchpad helper `theme.mjs` (`setBskyTheme(context, 'light'|'dim'|'dark')`) writes a valid object through `addInitScript`. Verified: the `<html>` class becomes `theme--light`, `theme--dim` and `theme--dark` respectively. |
| Accent / `focusRingColor` default | `#1085fe`, Bluesky's brand gradient hover blue (`gradients.primary.hover_value` in social-app `src/alf/tokens.ts`). Its contrast is about 3.6:1 on white, 4.6:1 on Dim and 5.8:1 on black, so it clears 3:1 for non-text UI in all three themes. Stored lowercase because `<input type=color>` saves lowercase. |
| How unmodified users get the new defaults | `ConfigWrapper.save()` writes **all** values, defaults included, so anyone who has ever saved has the old defaults stored. A one-time migration (`_styleDefaultsVersion: 1`) removes stored values that equal any previously shipped default (compared after whitespace and case normalization), so the new schema default applies. Every other value is kept. In the same `GM_setValue` write, every removed pair is saved as `_styleDefaultsBackup: { key: oldValue }`, so the old look can be restored by hand. `save()` semantics are not changed. |
| Read/unread direction | The old direction is preserved: in Dim and Dark, read posts are darker than unread ones; in Light, read posts are a muted gray. A new token, `--bsky-nav-bg-read`, holds the read background: Light `#EFF2F6` (contrast_50), Dim `#0F141C` (the Dim background mixed 30% toward black), Dark `#000000`. Unread = `--bsky-nav-bg`. In Dark the page background is already `#000000`, so nothing darker exists: read and unread share the background, and the 75% `readPosts` opacity carries the difference. The old Dark default (read `black`) did the same. |
| Read + selected post | The selected post is drawn at full opacity, so the ring keeps its contrast on a read post. The generated CSS adds `html[data-bsky-nav-theme] .item.item-read.item-selection-active, html[data-bsky-nav-theme] .item.item-read.item-selection-child-focused { opacity: 1 !important; }` after the read/unread rules. Its specificity (0,4,1) plus `!important` beats the user's `readPosts` CSS (injected at (0,2,1) `!important`). This overrides a custom `readPosts` opacity for the selected item only, which is intended. |
| Thread tint for single posts | Yes. A post that isn't in a thread is a thread of one, so it gets the same tint and bar. There is still exactly one ring. |
| Where the tint is painted | As a `background-image` gradient on each `.item` of the active `.thread`. A background image paints above `background-color`, so users' read/unread backgrounds stay intact underneath. The inline sidecar column is never tinted. The bar is a `::before` on `.thread`. The thread is found with `:has()` on **direct** children: `.thread:has(> div > .item-selection-active, > div > .item-selection-child-focused)`. The tint targets `… > div > .item`. This follows the existing convention at `style.css` ~487–489 and how `applyThreadStyling` assigns `.thread` (the item's `parent().parent()`). A plain descendant `:has()` would also match `.item`s nested inside quote posts: 14 of 93 items on a bsky.app profile were nested. The selector doesn't use `thread-selection-active` because `applyThreadStyling` toggles that class per item, so a sibling item can clear it. |
| Avatar size | **36px**, as the spec states (confirmed by the owner). It is one token, `--bsky-nav-avatar-size`. Bluesky's live thread and feed avatars currently measure 42px. |
| Sidecar header timestamp | The header shows `name · @handle · {{timestamp}}`, using the user's `postTimestampFormat` (owner commit 3c7a78a2), which is the same format the main column's header gets from `applyTimestampFormat`. The class `.sidecar-post-timestamp` moves into the header, so `openCurrentItem` (`.sidecar-post-timestamp a`) keeps working. Unrolled replies have no header, so they keep the timestamp in their footer. |
| `threadIndicatorColor` | Its default `rgb(212, 219, 226)` only suits Light, so it migrates to `var(--bsky-nav-border)` under the same superseded-defaults rule. |
| Feed map vs Bluesky theme | Known limitation (owner's call): the feed map stays untouched, so it keeps following the OS color scheme and can disagree with Bluesky's theme. Verification guards against inherited changes with a computed-style diff and an advisory pixel diff, with the OS and Bluesky themes matched. |
| Scrim | `rgba(0, 0, 0, 0.8)`, Bluesky's own dialog overlay (black at 0.8 opacity, `src/components/Dialog/index.web.tsx`). |
| Unrolled first/last markers | The badge text color becomes `--bsky-nav-positive` (first) and `--bsky-nav-negative` (last), with no hover darkening and no `!important`. The current badge, the one inside `.reply-selection-active`, uses the accent. |

## Native measurements (record of truth; Task 1 encodes these as tokens)

These were measured on live bsky.app (logged out, headless Chromium) on 2026-11-21 and cross-checked against `@bsky.app/alf@0.2.2`: `DEFAULT_PALETTE` for Light, `invertPalette(DEFAULT_SUBDUED_PALETTE)` for Dim, and `invertPalette(DEFAULT_PALETTE)` for Dark.

| Thing | Light | Dim | Dark | ALF source |
|---|---|---|---|---|
| Page background | `#FFFFFF` | `#151D28` | `#000000` | contrast_0 (live ✓) |
| Subtle background | `#F9FAFB` | `#1C2736` | `#111822` | contrast_25 |
| Muted background | `#EFF2F6` | `#222E3F` | `#19222E` | contrast_50 |
| Strong background / low border | `#DCE2EA` | `#2C3A4E` | `#232E3E` | contrast_100 (live ✓ post separator, connector line, avatar ring) |
| Medium border | `#C0CAD8` | `#394960` | `#313F54` | contrast_200 (Dialog border) |
| Text | `#000000` | `#FFFFFF` | `#FFFFFF` | contrast_1000 (live ✓) |
| Medium text (handle, age, link domain) | `#405168` | `#ABB8C9` | `#A5B2C5` | contrast_700 (live ✓) |
| Low text (placeholder/disabled) | `#8798B0` | `#586C89` | `#526580` | contrast_400 |
| Action icons and counts | `#667B99` | `#6F839F` | `#667B99` | contrast_500 (live ✓) |
| Link | `#006AFF` | `#4D97FF` | `#4291FF` | text_link (primary_500 in light, primary_600 in dark schemes) |
| Primary button | `#006AFF` | `#0F73FF` | `#006AFF` | primary_500 |
| Positive (repost active) | `#09B35E` | `#0AC266` | `#09B35E` | positive_500 (`RepostButton` activeColor) |
| Negative | `#E91646` | `#EB2452` | `#E91646` | negative_500 |
| Like active | `#EC4899` | `#EC4899` | `#EC4899` | pink |
| Shadow color | `rgba(0,0,0,0.1)` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.4)` | createTheme shadowOpacity |
| Menu / popover surface | `#FFFFFF` | `#1C2736` | `#111822` | Menu: `light ? bg : bg_contrast_25` |

Post layout (live thread reply row):

- Avatar: 42px live, but the spec says 36px. It is a circle with a 1px border overlay in contrast_100 at 0.6 opacity.
- Avatar column to content gap: 12px. Top spacer: 12px.
- Header: one row, `gap 4px`, `padding-bottom 4px`. Name is 15px, weight 600, line-height 17px, text color, `max-width 70%`. Handle is 15px with medium-text color and truncates with ellipsis (`flex-shrink 10`). Age is `· 8h`, 15px, medium text, `nowrap`.
- Body text: 15px / 20px, text color, `margin-bottom 2px`.
- Action row: `padding-top 2px`, `max-width 320px`, three equal `flex: 1` cells. The first cell has `margin-left: -6px`. Each button has `padding 5px`, `gap 4px`, `border-radius 999px`. Icons are 18×18, `viewBox 0 0 24 24`, color is the icon token, path `fill` uses the icon color. Count text is 13.1px in the icon color.
- Connector (parent → child): a 2px-wide line in contrast_100, `margin-top 4px` below the avatar, centered under it, growing (`flex: 1`) to the bottom of the row.
- Image embed: `border-radius 12px`, `overflow hidden`, with an inner 1px contrast_100 border overlay at opacity 0.6.
- Quote embed: `border 1px` contrast_100, `border-radius 12px`, `padding 12px`. Avatar 16px. Name 15px/600. Handle in medium text.
- External link card: `border 1px` contrast_100, `border-radius 12px`, `margin-top 8px`, `overflow hidden`. Title 15px/600/20px. Description 13.1px/17px in text color. Domain 11.3px/15px in medium text.
- Font family: `InterVariable, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`.
- Native reply icon path. Our `SIDECAR_SVG_REPLY` is outdated; the repost and like paths already match live:
  `M20.002 7a2 2 0 0 0-2-2h-12a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v1.918l3.375-2.7a1 1 0 0 1 .625-.218h5a2 2 0 0 0 2-2V7Zm2 8a4 4 0 0 1-4 4h-4.648l-4.727 3.781A1.001 1.001 0 0 1 7.002 22v-3h-1a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8Z`

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/theme.js` (new) | Detect Bluesky's theme, mirror it to `html[data-bsky-nav-theme]`, expose `isDarkTheme()` and `getThemeBackground()` | 1 |
| `src/configMigrations.js` (new) | Superseded-default table, CSS-value normalization, one-time migration (pure, no imports) | 2 |
| `src/ConfigWrapper.js` | Call the migration in `load()` | 2 |
| `src/components/ConfigModal.js` | New schema defaults | 2 |
| `src/main.js` | Start the theme watcher; generated CSS (read/unread by theme, nested-outline removal, high contrast); loading-indicator inline styles | 1, 2, 3, 8 |
| `src/assets/css/style.css` | Token block (in the "CSS Custom Properties" section); new "Selection (style A)" section; per-component migration | 1–8 |
| `src/sidecar.html` | Native post, header, footer, counts, embed templates; section labels | 4, 5 |
| `src/constants.js` | `SIDECAR_SVG_REPLY/REPOST/LIKE` recolored by `currentColor` and state classes | 4 |
| `src/handlers/ItemHandler.js` | `isDarkTheme()` instead of `matchMedia`; screenshot background; screenshot toast colors; loading indicator inline styles | 1, 7, 8 |
| `src/components/UIManager.js`, `src/handlers/FeedItemHandler.js` | Remove hashed classes from toolbar icon markup | 8 |
| Scratchpad `uikit.mjs` (new), plus the existing `harness.mjs`, `theme.mjs`, `mockapi.mjs` | Verification helpers | 1 (then reused) |

Scratchpad = `/private/tmp/claude-501/-Users-tonyc-dev--projects-bluesky-navigator/1eac83e0-dd42-4d30-a976-8f74b073d00f/scratchpad` (called `$S` below). The following already exist there and are verified working:

- `harness.mjs`: `launch()`, `loadWithScript(page, url, store)`, `getStore(page)`. It reads `dist/bluesky-navigator.user.js` at import time, so run `npm run build` first.
- `theme.mjs`: `setBskyTheme(context, theme)`.
- `mockapi.mjs`:
  - `mockApi(context)` fakes `createSession` on `https://bsky.social` and proxies the other XRPC reads to `public.api.bsky.app`, filling in the missing `post.viewer`. This makes sidecar fetches work while logged out. The config must set `atprotoIdentifier` and `atprotoPassword` (any values).
  - `dismissSignup(page)` closes Bluesky's logged-out signup dialog.

---

### Task 1: Theme detection and design tokens

**Files:**
- Create: `src/theme.js`
- Modify: `src/main.js` (top, right after `GM_addStyle(style)`; and the contentHider fade at ~476)
- Modify: `src/assets/css/style.css`, "CSS Custom Properties" section (~45–97), plus the 5 uses of `var(--background-color, white)`
- Modify: `src/handlers/ItemHandler.js` (~3192 screenshot `backgroundColor`; ~4527 and ~5568 `matchMedia` dark checks)
- Create: `$S/uikit.mjs`, `$S/v1.mjs`, `$S/feedmap-HEAD.css`

**Interfaces:**
- Produces, in `src/theme.js`:
  - `export const THEME_ATTR = 'data-bsky-nav-theme'`
  - `export function detectBlueskyTheme(doc = document, lastKnown = null): 'light' | 'dim' | 'dark'`: uses the signal order from the "Theme detection" decision. It ignores fully transparent colors and is safe when `doc.body` is null.
  - `export function startThemeWatcher(doc = document): () => void`: sets the attribute right away and observes:
    - `<html>`'s `class` attribute,
    - `meta[name="theme-color"]`'s `content` attribute,
    - `<head>`'s `childList`, re-binding if the meta tag is replaced.

    It passes the current attribute value as `lastKnown` and returns a disconnect function.
  - `export function isDarkTheme(): boolean`: true when the attribute is `dim` or `dark`.
  - `export function getThemeBackground(): string`: the computed `--bsky-nav-bg` on `<html>`, trimmed, falling back to `'#FFFFFF'`.
- Produces CSS tokens, used by every later task. Light values go on `:root`. Dim and Dark values go on `html[data-bsky-nav-theme="dim"]` and `html[data-bsky-nav-theme="dark"]`.

  | Token | Light | Dim | Dark |
  |---|---|---|---|
  | `--bsky-nav-bg` | `#FFFFFF` | `#151D28` | `#000000` |
  | `--bsky-nav-bg-subtle` | `#F9FAFB` | `#1C2736` | `#111822` |
  | `--bsky-nav-bg-muted` | `#EFF2F6` | `#222E3F` | `#19222E` |
  | `--bsky-nav-bg-strong` | `#DCE2EA` | `#2C3A4E` | `#232E3E` |
  | `--bsky-nav-bg-read` | `#EFF2F6` | `#0F141C` | `#000000` |
  | `--bsky-nav-surface` | `#FFFFFF` | `#1C2736` | `#111822` |
  | `--bsky-nav-border` | `#DCE2EA` | `#2C3A4E` | `#232E3E` |
  | `--bsky-nav-border-strong` | `#C0CAD8` | `#394960` | `#313F54` |
  | `--bsky-nav-text` | `#000000` | `#FFFFFF` | `#FFFFFF` |
  | `--bsky-nav-text-medium` | `#405168` | `#ABB8C9` | `#A5B2C5` |
  | `--bsky-nav-text-low` | `#8798B0` | `#586C89` | `#526580` |
  | `--bsky-nav-icon` | `#667B99` | `#6F839F` | `#667B99` |
  | `--bsky-nav-link` | `#006AFF` | `#4D97FF` | `#4291FF` |
  | `--bsky-nav-primary` | `#006AFF` | `#0F73FF` | `#006AFF` |
  | `--bsky-nav-positive` | `#09B35E` | `#0AC266` | `#09B35E` |
  | `--bsky-nav-negative` | `#E91646` | `#EB2452` | `#E91646` |
  | `--bsky-nav-shadow-color` | `rgba(0, 0, 0, 0.1)` | `rgba(0, 0, 0, 0.4)` | `rgba(0, 0, 0, 0.4)` |
  | `--bsky-nav-thread-tint-strength` | `6%` | `10%` | `10%` |
  | `--bsky-nav-icon-filter` | `none` | `invert(1)` | `invert(1)` |

  These tokens are the same in all themes (`:root` only):
  - Colors:
    - `--bsky-nav-like: #EC4899`
    - `--bsky-nav-warning: #FFC404`
    - `--bsky-nav-on-accent: #FFFFFF`
    - `--bsky-nav-scrim: rgba(0, 0, 0, 0.8)`
  - Accent:
    - `--bsky-nav-accent: var(--focus-ring-color)`
    - `--bsky-nav-ring-width: var(--focus-ring-width)`
    - `--bsky-nav-ring-lift: 0 2px 10px -2px color-mix(in srgb, var(--bsky-nav-accent) 40%, transparent)`
    - `--bsky-nav-accent-soft: color-mix(in srgb, var(--bsky-nav-accent) 15%, transparent)`
    - `--bsky-nav-thread-tint: color-mix(in srgb, var(--bsky-nav-accent) var(--bsky-nav-thread-tint-strength), transparent)`
    - `--bsky-nav-thread-bar-width: 3px`
  - Soft status colors:
    - `--bsky-nav-positive-soft: color-mix(in srgb, var(--bsky-nav-positive) 12%, transparent)`
    - `--bsky-nav-negative-soft: color-mix(in srgb, var(--bsky-nav-negative) 12%, transparent)`
    - `--bsky-nav-warning-soft: color-mix(in srgb, var(--bsky-nav-warning) 18%, transparent)`
  - Radii (ALF): `--bsky-nav-radius-xs: 4px`, `-sm: 8px`, `-md: 12px`, `-lg: 16px`, `-xl: 20px`, `-full: 999px`
  - Space (ALF): `--bsky-nav-space-2xs: 2px`, `-xs: 4px`, `-sm: 8px`, `-md: 12px`, `-lg: 16px`, `-xl: 20px`, `-2xl: 24px`
  - Type (ALF):
    - Font sizes: `--bsky-nav-font-xs: 11.3px`, `-sm: 13.1px`, `-md: 15px`, `-lg: 16.9px`, `-xl: 18.8px`
    - Line heights: `--bsky-nav-leading-tight: 1.15`, `-snug: 1.3`, `-relaxed: 1.5`
    - `--bsky-nav-font-family:` the Inter stack above
  - Shadows (ALF):
    - `--bsky-nav-shadow-sm: 0 4px 6px -1px var(--bsky-nav-shadow-color), 0 2px 4px -2px var(--bsky-nav-shadow-color)`
    - `--bsky-nav-shadow-md: 0 10px 15px -3px var(--bsky-nav-shadow-color), 0 4px 6px -4px var(--bsky-nav-shadow-color)`
    - `--bsky-nav-shadow-lg: 0 20px 25px -5px var(--bsky-nav-shadow-color), 0 8px 10px -6px var(--bsky-nav-shadow-color)`
    - `--bsky-nav-shadow-xl: 0 10px 40px 0 var(--bsky-nav-shadow-color)`
  - Motion: `--bsky-nav-ease: cubic-bezier(0.17, 0.73, 0.14, 1)` (Bluesky's). Durations keep using `--transition-duration`.
  - Native post metrics:
    - `--bsky-nav-avatar-size: 36px`
    - `--bsky-nav-post-gap: 12px`
    - `--bsky-nav-post-pad-x: 12px`
    - `--bsky-nav-post-pad-top: 12px`
    - `--bsky-nav-post-pad-bottom: 6px`
    - `--bsky-nav-connector-width: 2px`
    - `--bsky-nav-action-icon: 18px`
    - `--bsky-nav-action-pad: 5px`
    - `--bsky-nav-actions-max: 320px`
    - `--bsky-nav-embed-radius: 12px`
    - `--bsky-nav-quote-avatar: 16px`

  Put the "Native measurements" table's source note in a comment above the block. That block is the single place the measurements live.

- [ ] **Step 1: Record baselines.** Run:
  - `git show HEAD:src/assets/css/style.css | sed -n '/Scroll Position Indicator/,/Breadcrumb Trail/p' > $S/feedmap-HEAD.css`
  - ESLint baselines for every existing JS file the plan touches. Run `npx eslint src/main.js src/ConfigWrapper.js src/components/ConfigModal.js src/constants.js src/handlers/ItemHandler.js src/handlers/FeedItemHandler.js src/components/UIManager.js > $S/lint-before-all.txt` (a non-zero exit is fine). New files (`src/theme.js`, `src/configMigrations.js`) must lint with zero problems. "No new errors" in every task means comparing against this file.
  - Left-sidebar baseline: run `node $S/t1.mjs` through `node $S/t7.mjs` against the HEAD build and save the outputs to `$S/sidebar-before-t{1..7}.txt`. Task 8 compares against these.
  - Feed map baseline. With the HEAD build (`npm run build` before any edit; `dist/` is rewritten, which is fine), for each theme in `light`, `dim`, `dark`:
    - Create the context with `colorScheme` matching Bluesky's theme (`light` → `'light'`, `dim`/`dark` → `'dark'`) so the feed map's OS-keyed colors and Bluesky's theme agree.
    - Boot with `config: { showFeedMap: true }`. Check the real option name for the feed map in ConfigModal's schema before writing this.
    - Save `fmStyles(page)` (defined in Step 2) to `$S/feedmap-baseline-{theme}.json`.
    - Save a screenshot of `.feed-map-wrapper`, or the first `[class*="feed-map"]` container, to `$S/feedmap-baseline-{theme}.png`.

- [ ] **Step 2: Write `$S/uikit.mjs`.** It reuses `harness.mjs`, `theme.mjs` and `mockapi.mjs` and exports:
  - `boot({ theme = 'light', config = {}, viewport = { width: 1400, height: 900 }, api = false, url = 'https://bsky.app/' }) → { browser, ctx, page }`. It launches, calls `setBskyTheme`, calls `mockApi` when `api` (adding `atprotoIdentifier: 'test.bsky.social', atprotoPassword: 'x'` to the config), loads with store `{ bluesky_navigator_config: JSON.stringify({ _migrationComplete: true, ...config }) }`, then calls `dismissSignup`.
  - `ringed(page) → Promise<Array<{ tag, cls, outline, boxShadow }>>`: every element not inside `[class*="feed-map"]` whose computed `outlineStyle !== 'none'`, `parseFloat(outlineWidth) > 0` and `outlineColor` does not end in `, 0)` (transparent).
  - `token(page, name) → Promise<string>`: the trimmed `getComputedStyle(document.documentElement).getPropertyValue(name)`.
  - `rgb(hex) → string`, for example `rgb('#151D28') === 'rgb(21, 29, 40)'`.
  - `feedMapUnchanged() → boolean`: `sed`-extracts the feed map region from the working-copy `style.css` and compares it byte-for-byte with `$S/feedmap-HEAD.css`.
  - `fmStyles(page) → Promise<object>`: for the feed map container and the first element of each unique `className` under `[class*="feed-map"]` (cap 40), record computed `backgroundColor`, `color`, `fontFamily`, `fontSize`, `borderTopColor`, `outlineColor`, `opacity` and `filter`, keyed by class name.
  - `feedMapStylesUnchanged(page, theme) → Promise<boolean>`: compares `fmStyles(page)` with `$S/feedmap-baseline-{theme}.json` on the keys both contain, ignoring segment classes that depend on live content. It logs every difference. The page must be booted with the same matched `colorScheme`.
  - `feedMapPixelDiff(page, theme) → Promise<number>`: screenshots the same container and returns the fraction of pixels that differ from `$S/feedmap-baseline-{theme}.png` (size mismatch → 1). The feed contents are live, so this is advisory: log it, and flag it for manual review if it is above 0.05. `feedMapStylesUnchanged` is the assertion.

- [ ] **Step 3: Write the check `$S/v1.mjs`.** For each `theme` in `['light', 'dim', 'dark']`, `boot({ theme })` and assert:
  - `document.documentElement.getAttribute('data-bsky-nav-theme') === theme`.
  - `token('--bsky-nav-bg')`, `--bsky-nav-text-medium` and `--bsky-nav-border` match the table, compared case-insensitively.
  - Live switch (only in the Light run): `documentElement.classList.replace('theme--light', 'theme--dark')`. After 100ms the attribute is `'dark'` and `--bsky-nav-bg` is `#000000`.
  - Fallback (Dim run):
    1. Remove every `theme--*` class from `<html>` and set our attribute to `'light'` by hand.
    2. Call `localStorage.removeItem('ALF_THEME')` so only the meta signal is left.
    3. Add and remove a dummy class to trigger the observer.

    Expected: the attribute becomes `'dim'`, from `meta[name="theme-color"]` = `#151D28`. Then set the meta `content` to `#000000`; within 100ms the attribute becomes `'dark'`. Also confirm `getComputedStyle(document.body).backgroundColor` is `rgba(0, 0, 0, 0)` at that point. That shows the transparent background was correctly ignored.
  - Null body: `page.evaluate` a copy of the detection logic against a `document.implementation.createHTMLDocument('')` with no body; or expose `detectBlueskyTheme` through a debug hook only if one exists already. If neither is practical, review the code for the null guard and note that in the report. It must not throw.
  - Feed map: with matched `colorScheme`, `feedMapStylesUnchanged(page, theme)` is true; also log `feedMapPixelDiff`.
  - The contentHider fade uses the token: some `<style>` element's `textContent` contains `linear-gradient(transparent, var(--bsky-nav-bg))`. The style is injected only when `postMaxHeight` is set (`updatePostMaxHeight`, `main.js` ~448), so boot with `config: { postMaxHeight: <a valid value from its schema> }`.
  - `feedMapUnchanged() === true`.

- [ ] **Step 4: Build and run to see it fail.** Run `npm run build && node $S/v1.mjs`. Expected: FAIL, because the attribute is null.

- [ ] **Step 5: Implement.**
  - Write `src/theme.js` with the interfaces above. Luminance for the fallback signals: parse `rgb()`/`rgba()`/hex and compute `0.2126R + 0.7152G + 0.0722B` over 255. Treat alpha 0 and `transparent` as no signal.
  - In `main.js`, call `startThemeWatcher()` immediately after `GM_addStyle(style)`.
  - Add the token block to the CSS Custom Properties section. Keep `--focus-ring-*`, the z-index scale, `prefers-contrast` and `prefers-reduced-motion` as they are; high contrast changes in Task 3.
  - Replace every `var(--background-color, white)` in `style.css` and `main.js` with `var(--bsky-nav-bg)`.
  - `ItemHandler`:
    - The `htmlToImage.toBlob` `backgroundColor` becomes `getThemeBackground()`.
    - Both `window.matchMedia('(prefers-color-scheme: dark)').matches` calls become `isDarkTheme()`, with `import { isDarkTheme, getThemeBackground } from '../theme.js'` at the top of the file.

- [ ] **Step 6: Verify.**
  - `npm run build` succeeds.
  - `node $S/v1.mjs` prints all PASS.
  - `npx eslint src/theme.js src/main.js src/handlers/ItemHandler.js` reports no errors beyond `$S/lint-before-all.txt`, and `src/theme.js` is clean.
  - Screenshots `$S/t1-{light,dim,dark}.png` show no visual change except the fade gradient now matching the theme.

- [ ] **Step 7: Leave changes uncommitted.**

---

### Task 2: New selection and read/unread defaults, preserving customized values

**Files:**
- Create: `src/configMigrations.js`
- Modify: `src/ConfigWrapper.js` (`load()`)
- Modify: `src/components/ConfigModal.js` (Appearance and CSS Styles field defaults, ~409–520)
- Modify: `src/main.js` (`config.get('focusRingColor') || '#0066cc'` → `'#1085fe'`)
- Modify: `src/assets/css/style.css`. Replace every `var(--focus-ring-color, #0066cc)` fallback with `#1085fe`, and set the `:root` `--focus-ring-color` to `#1085fe`. These occurrences are all outside the feed map region; re-check with `feedMapUnchanged()`.
- Create: `$S/v2.mjs`

**Interfaces:**
- Consumes: the Task 1 tokens `--bsky-nav-accent`, `--bsky-nav-ring-width`, `--bsky-nav-ring-lift`, `--bsky-nav-bg`, `--bsky-nav-bg-read` and `--bsky-nav-border`.
- Produces, in `src/configMigrations.js`:
  - `export const STYLE_DEFAULTS_VERSION = 1`
  - `export const SUPERSEDED_DEFAULTS: Record<string, string[]>`
  - `export function normalizeCssValue(value: unknown): string`: `String(value).toLowerCase()`, collapse whitespace runs to one space, drop spaces around `: ; , ( )`, strip trailing `;`, trim.
  - `export function migrateSupersededDefaults(stored: object): object`: if `stored._styleDefaultsVersion >= STYLE_DEFAULTS_VERSION`, return `stored` itself. Otherwise return a shallow copy without each key whose normalized value is in that key's normalized superseded list. The copy also records each removed `key: oldValue` pair under `_styleDefaultsBackup`, merged with any existing backup, and sets `_styleDefaultsVersion` to `1`. `ConfigWrapper` persists it in that same single write. `save()` is unchanged.
- New defaults (exact strings):
  - `focusRingColor: '#1085fe'`
  - `threadIndicatorColor: 'var(--bsky-nav-border)'`
  - `selectionActive` and `replySelectionActive`: `'outline: var(--bsky-nav-ring-width) solid var(--bsky-nav-accent) !important; outline-offset: calc(-1 * var(--bsky-nav-ring-width)); box-shadow: var(--bsky-nav-ring-lift) !important;'`
  - `selectionChildFocused`, `selectionInactive`, `replySelectionInactive`: `'outline: none;'`
  - `unreadPostsLightMode`, `unreadPostsDarkMode`: `'background-color: var(--bsky-nav-bg);'`
  - `readPostsLightMode`, `readPostsDarkMode`: `'background-color: var(--bsky-nav-bg-read);'`. This gives Light `#EFF2F6`, Dim `#0F141C` and Dark `#000000`, which preserves the old direction (read darker than unread in Dim/Dark).
  - `posts`, `unreadPosts`, `readPosts`: unchanged.
- `SUPERSEDED_DEFAULTS`: every value ever shipped as a default, from git history, verbatim.
  - `selectionActive`:
    - `'border: 3px rgba(128, 0, 0, .6) solid !important;'`
    - `'border: 3px rgba(255, 0, 0, .3) solid !important;'`
    - `'border: 3px rgba(255, 0, 0, .3) solid;'` (a shipped variant without `!important`)
    - `'border: 3px rgba(255, 0, 0, .6) solid !important;'`
    - `'outline: 3px rgba(255, 0, 0, .6) solid !important;'`
    - `'outline: var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc) solid !important;'`
    - `'outline: var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc) solid !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--focus-ring-color, #0066cc) 15%, transparent);'`
  - `selectionChildFocused`:
    - `'border: 3px rgba(128, 0, 0, .2) solid !important;'`
    - `'outline: 3px rgba(128, 0, 0, .2) solid !important;'`
    - `'outline: var(--focus-ring-width, 2px) color-mix(in srgb, var(--focus-ring-color, #0066cc) 40%, transparent) solid !important;'`
    - the same string with `35%`
  - `selectionInactive`:
    - `'border: 3px solid transparent;'`
    - `'outline: 3px solid transparent;'`
    - `'outline: var(--focus-ring-width, 2px) solid transparent;'`
  - `replySelectionActive`:
    - `'border: 1px rgba(255, 0, 0, .6) solid !important;'`
    - `'outline: 1px rgba(255, 0, 0, .8) solid !important;'`
    - `'outline: 1px var(--focus-ring-color, #0066cc) solid !important;'`
    - `'outline: 3px var(--focus-ring-color, #0066cc) solid !important; outline-offset: -1px;'`
  - `replySelectionInactive`:
    - `'border: 1px rgb(212, 219, 226) solid !important;'`
    - `'outline: 1px rgb(212, 219, 226) solid'`
  - Single-value keys:
    - `unreadPostsLightMode: ['background-color: white;']`
    - `unreadPostsDarkMode: ['background-color: #202020;']`
    - `readPostsLightMode: ['background-color: #f0f0f0;']`
    - `readPostsDarkMode: ['background-color: black;']`
    - `focusRingColor: ['#0066cc']`
    - `threadIndicatorColor: ['rgb(212, 219, 226)']`

- [ ] **Step 1: Write the module check.** `$S/v2-node.mjs` imports `src/configMigrations.js` by absolute path and asserts:
  - `migrateSupersededDefaults({ selectionActive: <the 2nd var() default with extra spaces and no trailing ;>, focusRingColor: '#0066CC', selectionInactive: 'outline: 3px solid red;' })` returns an object without `selectionActive` or `focusRingColor`, with `selectionInactive === 'outline: 3px solid red;'`, `_styleDefaultsVersion === 1`, and `_styleDefaultsBackup` equal to `{ selectionActive: <the input string>, focusRingColor: '#0066CC' }`. Also check that `'border: 3px rgba(255, 0, 0, .3) solid;'` for `selectionActive` is removed.
  - Calling it again on that result returns the identical object (`===`).
  - `{}` gives `{ _styleDefaultsVersion: 1 }`.

  Run `node $S/v2-node.mjs`. Expected: FAIL (module not found).

- [ ] **Step 2: Write the browser check `$S/v2.mjs`.**
  - **(a) Unmodified legacy user.** Store `{ _migrationComplete: true, selectionActive: <old 6th default>, readPostsDarkMode: 'background-color: black;', focusRingColor: '#0066cc' }` with theme `dim`. Press `j` twice.
    - The `.item-selection-active` computed `outlineColor === 'rgb(16, 133, 254)'` and `outlineWidth === '2px'`.
    - `getStore()` config lacks `selectionActive` and `focusRingColor` (or holds the new default), has `_styleDefaultsVersion: 1`, and `_styleDefaultsBackup.readPostsDarkMode === 'background-color: black;'`.
  - **(b) Customized user.** Store `selectionActive: 'outline: 3px solid red !important;'` and `readPostsDarkMode: 'background-color: purple;'`.
    - The active item's outline is `rgb(255, 0, 0)` and `3px`.
    - The stored value is unchanged after load.
  - **(c) Fresh user** (store `{ _migrationComplete: true }`).
    - The active item `outlineColor === 'rgb(16, 133, 254)'`.
    - `boxShadow !== 'none'`.
    - `outlineOffset === '-2px'`.

- [ ] **Step 3: Run both checks.** Run `npm run build && node $S/v2-node.mjs && node $S/v2.mjs`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - Write `src/configMigrations.js`.
  - In `ConfigWrapper.load()`, apply `migrateSupersededDefaults(parsed)` before merging. If it returns a different object, persist it with `GM_setValue(STORAGE_KEY, JSON.stringify(migrated))`. Then set `this.values = { ...this.defaults, ...migrated }`.
  - Update the ConfigModal defaults, change the `help` text for `focusRingColor` to "Accent color for the selected post ring and thread highlight", and update the fallbacks.

- [ ] **Step 5: Verify.**
  - Both checks pass.
  - `npm run build` succeeds.
  - `src/configMigrations.js` lints clean. `src/ConfigWrapper.js`, `src/components/ConfigModal.js` and `src/main.js` show no new errors against `$S/lint-before-all.txt`.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes.

- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 3: Selection style A CSS and read/unread theming

**Files:**
- Modify: `src/main.js`, the generated stylesheet (~1193–1340) and `applyAccessibilityStyles` (~1170)
- Modify: `src/assets/css/style.css`. Add a new section `Selection (style A)` right after "Base Styles". Change `@media (prefers-contrast: more)` in Custom Properties. Restyle `.modal-item-selected` (Reader Mode section) onto the same ring.
- Create: `$S/v3.mjs`

**Interfaces:**
- Consumes: the Task 1 tokens and the Task 2 defaults.
- Produces these CSS hooks, which later tasks must not override:
  - `.thread { position: relative; }`, always. It is set unconditionally so that selecting a post never changes positioning context, and nothing shifts when the selection moves.
  - `.thread:has(> div > .item-selection-active, > div > .item-selection-child-focused)::before` is the bar: `content: ''`, absolute, `top: 0; bottom: 0; left: 0`, `width: var(--bsky-nav-thread-bar-width)`, `background: var(--bsky-nav-accent)`, `pointer-events: none`, `z-index: 1`. That is deliberately not `--z-raised` (10), so the bar doesn't paint over Bluesky's popovers or our menus inside the thread.
  - `.thread:has(> div > .item-selection-active, > div > .item-selection-child-focused) > div > .item` is the tint: `background-image: linear-gradient(var(--bsky-nav-thread-tint), var(--bsky-nav-thread-tint))`. The direct-child combinators keep nested quote-post `.item`s out, as in "Decisions".
- Generated CSS in `main.js`:
  - `@media (prefers-color-scheme:light)` becomes `html[data-bsky-nav-theme="light"] .item-unread/.item-read { …unreadPosts/readPosts + *LightMode }`.
  - `@media (prefers-color-scheme:dark)` becomes `html[data-bsky-nav-theme="dim"] .item-unread, html[data-bsky-nav-theme="dark"] .item-unread { … *DarkMode }`, and the same for `.item-read`.
  - The `.reply-selection-child-focused` rule becomes `outline: none !important;`.
  - `.thread-first` `border-top` uses `var(--bsky-nav-border)`.
  - `.sidecar-collapsed` uses `var(--bsky-nav-accent)`.
  - After the read/unread rules, add the read + selected override from "Decisions": `html[data-bsky-nav-theme] .item.item-read.item-selection-active, html[data-bsky-nav-theme] .item.item-read.item-selection-child-focused { opacity: 1 !important; }`.
- High contrast. `applyAccessibilityStyles` in `main.js` always injects `:root { --focus-ring-color: <setting>; --focus-ring-width: … }` into a `<style>` added **after** `style.css`. So today the `@media (prefers-contrast: more)` block in `style.css` never wins for `--focus-ring-color`; only the `highContrastMode` branch in `main.js` takes effect. Fix both paths in `main.js`'s injected CSS:
  - The `highContrastMode` branch sets `--focus-ring-color: var(--bsky-nav-text); --focus-ring-width: 3px`.
  - Append `@media (prefers-contrast: more) { :root { --focus-ring-color: var(--bsky-nav-text); --focus-ring-width: 3px; } }` after the base `:root` rule.
  - Change the `style.css` block to `var(--bsky-nav-text)` as well, for consistency. It stays harmless.

- [ ] **Step 1: Write `$S/v3.mjs`.** Run it for `light`, `dim` and `dark` with the default config, at 1400×900.
  1. Press `j` twice. Assert:
     - `ringed(page)` has length 1 and that element has class `item-selection-active`.
     - Its `.closest('.thread')` has `outlineStyle === 'none'`.
     - `getComputedStyle(thread, '::before').width === '3px'` and its `backgroundColor === 'rgb(16, 133, 254)'`.
     - The item's `backgroundImage` contains `linear-gradient`.
     - Exactly one `.thread` in the document has a non-`none` `::before` content.
     - No other `.item` has a gradient. This includes nested quote-post items: run it on `https://bsky.app/profile/bsky.app` too, where quote posts contain nested `.item`s, and assert that no `.item` whose `parentElement.parentElement` is not a `.thread` has a gradient.
     - The `::before` `zIndex === '1'`. Every `.thread` has `position === 'relative'`.
  2. Read/unread backgrounds. On an `.item-unread`, `backgroundColor === rgb(--bsky-nav-bg)`. Force one item to read with `classList.replace('item-unread', 'item-read')`; its `backgroundColor === rgb(--bsky-nav-bg-read)` (Light `rgb(239, 242, 246)`, Dim `rgb(15, 20, 28)`, Dark `rgb(0, 0, 0)`) and its `opacity === '0.75'`. In Dim, assert the read background is darker (lower luminance) than the unread one.
     - Read + selected: make the active item `item-read`. Its computed `opacity === '1'`. Composite its ring color over the page background (`--bsky-nav-bg`) with the item's effective opacity (the product of `opacity` up the ancestor chain), compute the WCAG contrast ratio against the read background, and assert it is ≥ 3.0 in all three themes. Repeat with `readPosts: 'opacity: 50% !important;'` in the config: the selected item is still at opacity 1 and the non-selected read item is at 0.5.
  3. Sidecar, with `boot({ api: true, config: { showReplySidecar: true, fixedSidecar } })` for both `'Inline'` and `'Fixed'`. Press `j` until a `.sidecar-post` exists, then press `ArrowRight`. Assert:
     - `ringed()` has length 1 and that element matches `.sidecar-post.reply-selection-active` (inside `.fixed-sidecar-panel` in Fixed mode).
     - The main item has `item-selection-child-focused` and `outlineStyle === 'none'`, and its thread `::before` is still 3px.
     - `.sidecar-replies` `backgroundImage === 'none'`.
  4. Unrolled replies, built synthetically (the selection logic is unchanged; this checks the CSS). Inside the active item, append `<div class="unrolled-replies"><div class="unrolled-reply reply-selection-active"></div><div class="unrolled-reply"></div></div>` and swap the item to `item-selection-child-focused`. Assert:
     - `ringed()` has length 1 and is the first `.unrolled-reply`.
     - Changing that reply's class to `reply-selection-child-focused` gives `ringed().length === 0`.
  5. A custom value (Review Focus 1). With `selectionActive: 'outline: 3px solid red !important;'`, `ringed()` has length 1 and the thread bar is still present.
  6. High contrast (Review Focus 3). With `highContrastMode: true` in Dark, the active ring `outlineColor === 'rgb(255, 255, 255)'`; in Light it is `'rgb(0, 0, 0)'`. Also, with the default config and the OS preference emulated through `page.emulateMedia({ contrast: 'more' })` (log a skip if this Playwright version doesn't support it), the Dark ring is `rgb(255, 255, 255)` and 3px wide.
  7. Clean screenshot (Review Focus 4), in Dim:
     - Stub `navigator.clipboard.write = async (items) => { window.__shot = await (await items[0].getType('image/png')).arrayBuffer() }` (convert to base64).
     - Press `C`. Decode the PNG inside the page by drawing it onto a canvas (`createImageBitmap(new Blob([buf]))`).
     - Pixel (2, 2) is about `rgb(21, 29, 40)` (±3).
     - No pixel in columns x = 0–8 is within ±20 of the accent `rgb(16, 133, 254)`. That means no ring.
     - Note: the capture is of the `.item` element only, and the bar is a `::before` on the parent `.thread`, so the bar is never inside the captured box anyway. The tint is the part at risk, and it is covered by the pixel-(2, 2) background check above: a tinted item would not be within ±3 of `rgb(21, 29, 40)`.
  8. Mobile, at 390×844 in Light. Press `j`; `ringed().length === 1` and the bar is present.

  Save screenshots `$S/t3-{theme}-{post,sidecar-inline,sidecar-fixed}.png`.

- [ ] **Step 2: Run to see it fail.** Run `npm run build && node $S/v3.mjs`. Expected: FAIL, because there is no `::before` bar and the dark read background is wrong.

- [ ] **Step 3: Implement** the CSS hooks and generated-CSS changes above. `.modal-item-selected` gets the same declarations as the `selectionActive` default.

- [ ] **Step 4: Verify.**
  - `node $S/v3.mjs` passes in all modes.
  - `npm run build` succeeds.
  - eslint on `src/main.js` shows no new errors.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes for all three themes with matched `colorScheme`.
  - Look at the screenshots: one ring, a soft tint, the bar flush with the left edge of the thread.

- [ ] **Step 5: Leave changes uncommitted.**

---

### Task 4: Native sidecar post (header, body, actions, embeds)

**Files:**
- Modify: `src/sidecar.html`: the `sidecar-post-template`, `sidecar-footer-template`, `sidecar-post-counts-template`, and the image, quote and external embed templates.
- Modify: `src/constants.js`: `SIDECAR_SVG_REPLY`, `SIDECAR_SVG_REPOST`, `SIDECAR_SVG_LIKE`.
- Modify: `src/assets/css/style.css`: the `.sidecar-post*` and `.sidecar-count*` rules (currently in "Fixed Sidecar Panel", ~1051–1145). Move them into a new section `Native Sidecar Post`.
- Modify: `src/main.js`: remove the `.sidecar-post { margin: 1px; … }` margin but keep the `replySelectionInactive` injection.
- Create: `$S/v4.mjs`

**Interfaces:**
- Consumes: the tokens, including the native post metrics.
- Post template structure. Keep every class that JS reads: `.sidecar-post`, `.sidecar-post-avatar`, `.sidecar-post-username`, `.sidecar-post-handle`, `.sidecar-post-timestamp a`, `.sidecar-post-content`, `.sidecar-like-button`, `.sidecar-count-label-likes`.
  ```
  .sidecar-post
    .sidecar-post-avatar-col > img.sidecar-post-avatar + div.sidecar-post-connector[aria-hidden=true]
    .sidecar-post-main
      .sidecar-post-header > a>span.sidecar-post-username, a>span.sidecar-post-handle ("@{{handle}}"),
                             span.sidecar-post-dot ("·"), span.sidecar-post-timestamp>a[href={{postUrl}}]{{timestamp}}
      {{> bodyTemplate this}}
      {{> footerTemplate this hideTimestamp=true}}
  ```
- Footer: `{{#unless hideTimestamp}}<div class="sidecar-post-timestamp"><a …>{{timestamp}}</a></div>{{/unless}}`, followed by the counts.
- Counts: three `.sidecar-count` cells in the order reply, repost, like. Class names are unchanged. Each cell has an icon and a label.
- SVG constants:
  - Every inactive icon uses `fill="currentColor"` on its paths and has no inline `style` color.
  - The active repost is `<svg class="bsky-nav-icon-reposted" …>` and the active like is `<svg class="bsky-nav-icon-liked" …>`, both with `fill="currentColor"`.
  - The reply path `d` is the native path given in "Native measurements".
- Embeds:
  - Remove all hashed classes and inline color/border/radius styles.
  - Classes: `.sidecar-embed-image` (button), `.sidecar-embed-image-border` (overlay), `.sidecar-embed-quote`, `.sidecar-quote-author`, `.sidecar-quote-avatar`, `.sidecar-quote-displayname`, `.sidecar-quote-handle`, `.sidecar-quote-content` (**keep this class**: `FeedItemHandler.js` ~1808 selects it for filter highlighting), `.sidecar-quote-images`, `.sidecar-embed-external`, `.sidecar-external-thumb`, `.sidecar-external-info`, `.sidecar-external-domain`, `.sidecar-external-title`, `.sidecar-external-description`.
  - Layout-only inline styles may stay on `img` (`object-fit`, `width`).
- CSS values come from "Native measurements":
  - Avatar: `--bsky-nav-avatar-size`, round, with a 1px `--bsky-nav-border` ring (`box-shadow: 0 0 0 1px`).
  - Row: `display: flex; gap: var(--bsky-nav-post-gap); padding: var(--bsky-nav-post-pad-top) var(--bsky-nav-post-pad-x) var(--bsky-nav-post-pad-bottom)`.
  - Header: `nowrap`, with the handle truncated by ellipsis.
  - Sizes: `--bsky-nav-font-md` for name, handle and body; `--bsky-nav-font-sm` for counts.
  - Colors: `--bsky-nav-text` for name and body; `--bsky-nav-text-medium` for handle, dot and age; `--bsky-nav-icon` for icons and counts; `--bsky-nav-link` for links in content.
  - `.sidecar-count:has(.bsky-nav-icon-liked)` uses `--bsky-nav-like` and `:has(.bsky-nav-icon-reposted)` uses `--bsky-nav-positive` (icon and label).
  - Separator between posts: `border-top: 1px solid var(--bsky-nav-border)`.
  - Remove the `0.8em` font scaling on `.sidecar-replies`; native sizes are absolute.

- [ ] **Step 0: Build a canned thread fixture so the embed and parent checks can't pass by skipping.**
  - Write `$S/make-fixture.mjs`. It fetches `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot&limit=100` and picks one post for each of these `post.embed.$type` values:
    - `app.bsky.embed.images#view`,
    - `app.bsky.embed.record#view` (a quote),
    - `app.bsky.embed.external#view`,
    - plus two plain posts.

    It fills `post.viewer ||= {}` and writes `$S/fixture-thread.json`, shaped as a `getPostThread` response:
    ```
    { thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: <plain A>,
                parent: { $type: '…#threadViewPost', post: <plain B> },
                replies: [<images>, <quote>, <external>].map(p => ({ $type: '…#threadViewPost', post: p, replies: [] })) } }
    ```
  - Extend `mockApi(context, { threadFixture })` in `$S/mockapi.mjs`. When `threadFixture` is set, every `app.bsky.feed.getPostThread` request is fulfilled with that JSON, whatever URI was requested. Any other request is proxied as before.
  - Run `node $S/make-fixture.mjs`. Expected: it prints the three embed post URIs. If the feed lacks a type, it retries with `limit=100&cursor=…` up to 5 pages, then fails loudly.
  - `boot()` gains an option `threadFixture` that it passes through to `mockApi`.

- [ ] **Step 1: Write `$S/v4.mjs`.** For each theme, `boot({ api: true, threadFixture: '$S/fixture-thread.json', config: { showReplySidecar: true, fixedSidecar: 'Inline', showReplyContext: true } })`, then press `j` until `.sidecar-replies-section .sidecar-post` exists. Every sidecar now shows the fixture: one parent and three embed replies. On the first reply post, assert:
  - The avatar `getBoundingClientRect()` is 36×36 and its `borderRadius` is `50%`.
  - The `.sidecar-post-username`, `.sidecar-post-handle` and `.sidecar-post-timestamp` rect tops are within 2px of each other (one line).
  - The username is `fontSize 15px` and `fontWeight 600`, with `color === rgb(--bsky-nav-text)`.
  - The handle color equals Light `rgb(64, 81, 104)`, Dim `rgb(171, 184, 201)` or Dark `rgb(165, 178, 197)`.
  - `.sidecar-post-content` is `fontSize 15px`, `lineHeight 20px`.
  - The `.sidecar-count-icon svg` rect is 18×18; its computed `color` equals Light/Dark `rgb(102, 123, 153)` or Dim `rgb(111, 131, 159)`; its `path` `fill` attribute is `currentColor`; and the reply path `d` starts with `M20.002 7a2`.
  - The `.sidecar-post-footer .sidecar-post-timestamp` count inside `.sidecar-post` is 0.
  - `document.querySelectorAll('.sidecar-replies [style]')` has no element whose `style` attribute matches `/rgb\(|#[0-9a-f]{3,6}\b/i`.
  - No element under `.sidecar-replies` has `[class*="css-"]` or `[class*=" r-"]`.
  - Exactly one each of `.sidecar-embed-quote`, `.sidecar-embed-image` and `.sidecar-embed-external` exists in the active sidecar. Their `borderRadius` is `12px`. Quote and external `borderTopColor` equals `rgb(--bsky-nav-border)`. `.sidecar-quote-content` exists and is non-empty.
  - Pressing `ArrowRight` then `o` (`openCurrentItem`) navigates to a `/post/` URL. That proves `.sidecar-post-timestamp a` still resolves.
  - Screenshots: `$S/t4-{theme}-sidecar.png`, plus a native reference `$S/t4-{theme}-native.png` (a bsky.app thread reply loaded without the script), for a side-by-side look.

- [ ] **Step 2: Run to see it fail.** Run `npm run build && node $S/v4.mjs`. Expected: FAIL (the avatar is 24px).

- [ ] **Step 3: Implement** the templates, SVG constants and CSS described above. `ItemHandler`'s like toggle (`likeButton.html(constants.SIDECAR_SVG_LIKE[svgIndex])`) keeps working because the state now comes from the swapped SVG's class.

- [ ] **Step 4: Verify.**
  - `node $S/v4.mjs` passes.
  - `npm run build` succeeds.
  - eslint on `src/constants.js` and `src/main.js` shows no new errors.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes.
  - Re-run `node $S/v3.mjs`: there is still one ring.

- [ ] **Step 5: Leave changes uncommitted.**

---

### Task 5: Sidecar structure (sections, connector) and unrolled replies

**Files:**
- Modify: `src/sidecar.html` (`sidecar-replies-template`)
- Modify: `src/assets/css/style.css`: the "Collapsible Sidecar Sections" section, the `.unrolled-*` rules in "Base Styles" (~701–789), `.sidecar-parent-indicator`, and `.sidecar-parent .sidecar-post`.
- Create: `$S/v5.mjs`

**Interfaces:**
- Consumes: Task 4's `.sidecar-post-avatar-col` and `.sidecar-post-connector`.
- Template changes:
  - Delete `<div class="sidecar-parent-indicator">↙️</div>`.
  - The parent section title text becomes `Replying to`.
  - The replies title becomes `Replies · {{replies.length}}`.
  - Keep the toggle buttons, `aria-*` attributes and `.sidecar-section-icon` span. JS still writes ▶/▼ into it.
- CSS:
  - `.sidecar-section-toggle` becomes a quiet label: transparent background, `--bsky-nav-text-medium`, `--bsky-nav-font-sm`, weight 600, `radius-sm`, hover `--bsky-nav-bg-subtle`, and a focus-visible ring using the accent.
  - `.sidecar-section-icon` gets `font-size: 0`, and a `::before` chevron (a 6px CSS border triangle in `currentColor`). **Delete** the existing `.sidecar-section-toggle[aria-expanded="false"] .sidecar-section-icon { transform: rotate(-90deg); }` rule (`style.css` ~3577) and rotate only the `::before`: `[aria-expanded="false"] .sidecar-section-icon::before { transform: rotate(-90deg); }`. The glyph JS writes is never visible, so there is exactly one rotation.
  - `.sidecar-post-connector`: `display: none` by default. `.sidecar-parent .sidecar-post-connector` gets `display: block; width: var(--bsky-nav-connector-width); flex: 1; margin: 4px auto 0; background: var(--bsky-nav-border)`. `.sidecar-post-avatar-col` is a column flexbox, so the line runs to the bottom of the row.
  - Delete the dashed parent border.
  - Unrolled replies:
    - `.unrolled-reply` keeps its 44px left padding and loses its `border` (transparent 1px).
    - `.unrolled-divider` gets a 1px `--bsky-nav-border` top border.
    - `.unrolled-post-number` gets `--bsky-nav-bg-muted` background, `--bsky-nav-text-medium` text, `radius-full` and `--bsky-nav-font-xs`.
    - `.reply-selection-active > .unrolled-post-number` gets accent background and `--bsky-nav-on-accent` text.
    - `.unrolled-post-first` uses `color: var(--bsky-nav-positive)` and `.unrolled-post-last` uses `color: var(--bsky-nav-negative)`, both without `!important` hover variants.
    - The unrolled `.sidecar-post-footer` (timestamp + counts) inherits the Task 4 native styles.
  - Delete the two `prefers-color-scheme` blocks in these sections.

- [ ] **Step 1: Write `$S/v5.mjs`.** For each theme:
  1. `boot({ api: true, threadFixture: '$S/fixture-thread.json', config: { showReplySidecar: true, fixedSidecar: 'Inline', showReplyContext: true } })` (the fixture from Task 4 Step 0 always has a parent). Press `j` until a `.sidecar-parent-section` exists; fail if none appears within 10 items. Assert:
     - `.sidecar-parent-indicator` count is 0.
     - The section titles' `textContent.trim()` match `/^Replying to$/` and `/^Replies · \d+$/`.
     - The parent's `.sidecar-post-connector` computed `width === '2px'`, its `backgroundColor === rgb(--bsky-nav-border)`, and its rect bottom is within 2px of the parent `.sidecar-post` content bottom.
     - Reply posts' connector `display === 'none'`.
     - No element under `.sidecar-replies` has `borderStyle` containing `dashed`.
     - The `.sidecar-section-toggle` `backgroundColor` is `rgba(0, 0, 0, 0)`.
     - Clicking the toggle sets `aria-expanded="false"`, the `::before` transform is a rotation matrix (`matrix(0, -1, 1, 0, …)` for -90°), the span itself has `transform === 'none'`, and the content hides.
  2. Unrolled replies, with `boot({ api: true, config: { unrollThreads: true } })`. Scroll through up to 60 items looking for a real `.unrolled-reply`. If none is found, build one synthetically: clone a rendered `.sidecar-post-main > .sidecar-post-body` and `.sidecar-post-footer` from a sidecar post into `<div class="unrolled-reply"><hr class="unrolled-divider"><a class="unrolled-post-number unrolled-post-last">3<span class="unrolled-post-total">/3</span></a>…</div>`. Assert:
     - The `.unrolled-post-number` `borderRadius === '999px'`.
     - Its `backgroundColor === rgb(--bsky-nav-bg-muted)`.
     - `.unrolled-post-last` `color === rgb(--bsky-nav-negative)`.
     - With `reply-selection-active` on the reply, the badge background is `rgb(16, 133, 254)`.
     - The footer timestamp is visible (this is not a `.sidecar-post`).
     - `ringed()` has length 1.
  3. Screenshots: `$S/t5-{theme}-parent.png`, `$S/t5-{theme}-unrolled.png`.

- [ ] **Step 2: Run to see it fail.** Run `npm run build && node $S/v5.mjs`. Expected: FAIL (the indicator is still present).

- [ ] **Step 3: Implement** the template and CSS changes above.

- [ ] **Step 4: Verify.**
  - `node $S/v5.mjs` passes, along with `node $S/v4.mjs` and `node $S/v3.mjs`.
  - `npm run build` succeeds.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes.

- [ ] **Step 5: Leave changes uncommitted.**

---

## Shared rules for Tasks 6–8 (component migration)

Each component section is migrated like this:

1. Replace hard-coded light-mode values with tokens using this map:

   | Literal | Token |
   |---|---|
   | Panel/modal background `#fff`, `#ffffff`, `white` | `--bsky-nav-bg` (modal, toolbar, panels) or `--bsky-nav-surface` (popover, toast, menu, dropdown, card) |
   | `#f9fafb` | `--bsky-nav-bg-subtle` |
   | `#f3f4f6`, `#eee`, `#f0f0f0` | `--bsky-nav-bg-muted` |
   | `#e5e7eb` used as a background | `--bsky-nav-bg-strong` |
   | `#e5e7eb` used as a border | `--bsky-nav-border` |
   | `#d1d5db`, `#ccc` | `--bsky-nav-border-strong` |
   | `#111827`, `#1f2937`, `#000` used as text | `--bsky-nav-text` |
   | `#374151`, `#4b5563`, `#6b7280` used as text | `--bsky-nav-text-medium` |
   | `#9ca3af` | `--bsky-nav-text-low` |
   | `#3b82f6`, `#2563eb`, `#1d4ed8`, `#0085ff`, `#007bff`, `#60a5fa` for buttons | `--bsky-nav-primary` |
   | The same blues for selection, current or focus states | `--bsky-nav-accent` |
   | `#dbeafe`, `#eff6ff`, `rgba(59,130,246,.1/.2)` | `--bsky-nav-accent-soft` |
   | `#dc2626`, `#ef4444`, `#f87171` | `--bsky-nav-negative` |
   | `#fee2e2`, `#fef2f2`, `#fecaca` | `--bsky-nav-negative-soft` |
   | `#22c55e`, `#16a34a`, `rgba(0,128,0,…)` | `--bsky-nav-positive` |
   | `#f0fdf4` | `--bsky-nav-positive-soft` |
   | `#f59e0b` | `--bsky-nav-warning` |
   | `#fef3c7` | `--bsky-nav-warning-soft` |
   | `rgba(0,0,0,.05–.25)` shadows | `--bsky-nav-shadow-sm`, `-md`, `-lg` or `-xl` |
   | `rgba(0,0,0,.4–.7)` backdrops | `--bsky-nav-scrim` |
   | Text on a filled primary/accent | `--bsky-nav-on-accent` |

2. Delete that section's `@media (prefers-color-scheme: dark)` block(s). The tokens now carry Dim and Dark.
3. "Modern flair" means consistent shapes and motion:
   - Radii: buttons and inputs `--bsky-nav-radius-sm`; cards, popovers, toasts and dropdowns `--bsky-nav-radius-md`; modals `--bsky-nav-radius-xl` (ALF Dialog `rounded_xl`); pills and badges `--bsky-nav-radius-full`.
   - Borders: floating surfaces get a 1px `--bsky-nav-border`; modals get a 1px `--bsky-nav-border-strong`.
   - Hover: `--bsky-nav-bg-subtle` on transparent controls.
   - Press: `transform: scale(0.97)` on buttons.
   - Transitions: `background-color, color, box-shadow, transform` over `var(--transition-duration)` with `var(--bsky-nav-ease)`.
   - Focus-visible: `outline: var(--bsky-nav-ring-width) solid var(--bsky-nav-accent); outline-offset: 2px`.
   - Fonts: `--bsky-nav-font-family`.
   - Feature colors stay as they are: rule category colors, user swatches, avatar rule rings.
4. Keep the `prefers-contrast: more` and reduced-motion blocks, retargeted at tokens where they hard-code colors.

Each task's check script (`$S/v6.mjs`, `v7`, `v8`) loops over the three themes and asserts, for every component root it opens:
- The root's computed `backgroundColor` equals the expected token's rgb for that theme.
- A representative text element's `color` equals `rgb(--bsky-nav-text)` or `-text-medium`.
- `borderRadius` equals the radius rule.

It also asserts the grep invariants given in the task, asserts `feedMapStylesUnchanged(page, theme)` with matched `colorScheme` (and logs `feedMapPixelDiff`), and saves `$S/t{N}-{theme}-{component}.png`. ESLint "no new errors" always means against `$S/lint-before-all.txt`.

Run the shell invariants as:
- `awk '/<start header>/,/<end header>/' src/assets/css/style.css | grep -c "prefers-color-scheme"` → expect `0`.
- `… | grep -ciE "#[0-9a-f]{3,6}\b|rgba?\("` → expect `0`, except for documented feature colors (list any survivors in the task notes with a reason).

---

### Task 6: Settings modal and rule builder

**Files:**
- Modify: `src/assets/css/style.css`, sections "Config Modal", "Rule Builder Styles" (including Rules sync UI, Sync dialog overlay, Sync toast, Deduplication dialog, Rule rows, Add buttons, Empty states) and "Timeouts Panel (Config Modal)"
- Create: `$S/v6.mjs`

**Interfaces:**
- Consumes: the tokens and the shared rules.
- Expected values:
  - `.config-modal-content`: background `--bsky-nav-bg`, radius `20px`, 1px `--bsky-nav-border-strong` border, shadow `--bsky-nav-shadow-xl`.
  - Backdrop: `--bsky-nav-scrim`.
  - Active tab: accent underline and text.
  - Inputs, selects and textareas: background `--bsky-nav-bg-subtle`, 1px `--bsky-nav-border`, radius 8px, focus ring in the accent.
  - Primary save button: `--bsky-nav-primary` with `--bsky-nav-on-accent`.

- [ ] **Step 1: Write `$S/v6.mjs`.** Open the modal with `Alt+.` (Handler maps `event.code === 'Period'` with Alt). For each theme, assert:
  - The `.config-modal-content` background equals `rgb(--bsky-nav-bg)` and its `borderRadius === '20px'`.
  - The backdrop background is `rgba(0, 0, 0, 0.8)`.
  - The first text `input` background equals `rgb(--bsky-nav-bg-subtle)`.
  - Click the Rules tab: `.rules-panel` text color equals `rgb(--bsky-nav-text)` or `-medium`, and a `.rules-color-swatch` keeps its inline category color.
  - Open the Timeouts tab: `.timeouts-panel` has no `rgb(255, 255, 255)` background in Dim or Dark.
  - Grep invariants for the three sections: 0 `prefers-color-scheme`, 0 literal colors (except documented feature colors).

  Screenshots: `t6-{theme}-{display,rules,timeouts}.png`.

- [ ] **Step 2: Run to see it fail.** Run `npm run build && node $S/v6.mjs`. Expected: FAIL in Dim/Dark.
- [ ] **Step 3: Migrate** the three sections per the shared rules.
- [ ] **Step 4: Verify.** `v6` passes, `npm run build` succeeds, `feedMapUnchanged()` is true, and `v3.mjs` still passes.
- [ ] **Step 5: Leave changes uncommitted.**

---

### Task 7: Overlays, toasts and popups

**Files:**
- Modify: `src/assets/css/style.css`, sections:
  - "Like/Repost Animation Feedback", "Keyboard Shortcut Overlay", "Post View Modal", "Reader Mode"
  - "Add to Rules Button (Profile Hover Card)" (including Rules Dropdown and Rule Added Notification), "List-Backed Category Choice Popup", "Timeout Popup", "Custom Profile Hover Card (for sidecar replies)" (including the dark rules dropdown, Toast Notifications, and dark toasts), "Action Feedback Indicator" (including Menu feedback)
  - "Mobile Swipe Gestures", "Mobile Bottom Sheet"
  - The `.popup` rule in Base Styles
- Modify: `src/handlers/ItemHandler.js`. The screenshot success, partial and error notifications (~3263–3310) stop using inline colors. Give them a **new** class family, `bsky-nav-status-toast bsky-nav-status-toast-success|warning|error`, and move the positioning into CSS too. Don't reuse `.bsky-nav-toast`: that class already exists (`style.css` ~6380) for the notification toasts and is hidden until `.visible`.
- Create: `$S/v7.mjs`

**Interfaces:**
- Consumes: the tokens and the shared rules.
- Expected values:
  - Overlay and modal panels: background `--bsky-nav-bg`, radius 20px, shadow `-xl`, scrim backdrop.
  - Popovers, toasts, dropdowns and the hover card: `--bsky-nav-surface`, radius 12px, 1px `--bsky-nav-border`, shadow `-md`.
  - Toast variants: a 3px left accent in `--bsky-nav-positive`, `--bsky-nav-warning` or `--bsky-nav-negative` on a `--bsky-nav-surface` body.
  - Like animation: `--bsky-nav-like`. Repost animation: `--bsky-nav-positive`.
  - `.modal-item-selected` was already set in Task 3; don't override it.

- [ ] **Step 1: Write `$S/v7.mjs`.** For each theme, with `boot({ api: true, config: { showReplySidecar: true, toastNotifications: true } })`:
  - Press `?`. The `.shortcut-overlay` panel background equals `rgb(--bsky-nav-bg)` and the radius is 20px.
  - Press `Escape`, then `j` and `v`. `.post-view-modal-content` has background `rgb(--bsky-nav-bg)`, and its selected element has `ringed()` length 1 within the modal.
  - Press `Escape`, then `V`. The reader content background equals `rgb(--bsky-nav-bg)` and its text color equals `rgb(--bsky-nav-text)`.
  - Toasts: stub the clipboard as in Task 3 and press `c`. The success notification has class `bsky-nav-status-toast-success`, is visible (`display !== 'none'` and `opacity > 0`), and its background equals `rgb(--bsky-nav-surface)`, and its `borderLeftColor` equals `rgb(--bsky-nav-positive)`.
  - Hover card: hover a `.sidecar-post-avatar`. `.bsky-nav-profile-card` has background `rgb(--bsky-nav-surface)` and radius 12px. If the card needs an API not available, log a skip.
  - Bottom sheet, at 390×844: trigger it the way `src/components` opens it (read its trigger before writing the script). Its background equals `rgb(--bsky-nav-surface)`. If it isn't reachable logged out, log a skip.
  - Grep invariants for the listed sections. The rules dropdown and list popup are checked by grep and by rendering their markup through the profile page `bsky.app/profile/bsky.app` add-to-rules button if present.

  Screenshots: `t7-{theme}-{overlay,postview,reader,toast}.png`.

- [ ] **Step 2: Run to see it fail.** Run `npm run build && node $S/v7.mjs`. Expected: FAIL.
- [ ] **Step 3: Migrate** the sections and the ItemHandler notifications.
- [ ] **Step 4: Verify.**
  - `v7` passes.
  - `npm run build` succeeds.
  - eslint on `src/handlers/ItemHandler.js` shows no new errors.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes.
  - `v3.mjs` and `v4.mjs` still pass.
- [ ] **Step 5: Leave changes uncommitted.**

---

### Task 8: Toolbar, status bar, panels and sidebar toggle

**Files:**
- Modify: `src/assets/css/style.css`, sections:
  - "Base Styles": log container, toolbar, `.toolbar-icon`, width controls, status bar, prev/next, `.ui-autocomplete`/`.ui-state-active`, preferences overlay, loading indicators, item banner
  - "Fixed Sidecar Panel": panel chrome, header, close, toggle, count badge, connector arrow
  - "Filter Indicator Pill", "New Posts Floating Pill", "Skeleton Loading States", "Breadcrumb Trail", "Saved Searches", "Filter Highlight", "Global UIManager Toolbar and Status Bar"
  - "Left Navigation Sidebar: Collapsible / Auto-hide": the toggle button and the `--bsky-nav-ln-bg` fallbacks become `var(--bsky-nav-bg)`, and its `min-width: 801px and prefers-color-scheme: dark` block is deleted
- Modify: `src/main.js` (~47–53 fullscreen loading indicator) and `src/handlers/ItemHandler.js` (~7493–7495 feed loading indicator). Inline colors become `var(--bsky-nav-bg)`, `var(--bsky-nav-border)`, `var(--bsky-nav-primary)` and `var(--bsky-nav-text-medium)`. The fullscreen indicator is created at the top of `main.js`. Keep the Task 1 `startThemeWatcher()` call above it, so the attribute exists before the indicator renders.
- Modify: `src/components/UIManager.js` (~113, ~119), `src/handlers/FeedItemHandler.js` (~410, 416, 427, 843, 849, 856, 1123) and `src/handlers/ItemHandler.js` (~3622 `#prevButton`, ~3636 `#nextButton`). Remove the hashed classes `css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb` from our markup. Replace them in CSS with explicit declarations:
  - `.toolbar-icon`, `#infoIndicator`, `.global-info-indicator`, `#prevButton`, `#nextButton`: `cursor: pointer; touch-action: manipulation; display: flex; align-items: stretch; justify-content: center; flex-grow: 1`.
  - `#infoIndicator`, `.global-info-indicator`, `#prevButton`, `#nextButton` also get `padding: 0 14px`, which is what `r-gu64tb` supplied. `.toolbar-icon` already sets its own padding; keep that. Before deleting the classes, confirm each element's computed padding and flex values from the Step 1 geometry dump, and make the explicit CSS match them.
- Create: `$S/v8.mjs`

**Interfaces:**
- Consumes: the tokens and the shared rules.
- Expected values:
  - Toolbar and status bar: background `--bsky-nav-bg`, 1px `--bsky-nav-border` separators.
  - Toolbar icon images: `filter: var(--bsky-nav-icon-filter)` on `.indicator-image` only, so feed-map icons are unaffected. Put this rule **before** the `.image-highlight` and `.load-time-icon` rules (`style.css` ~632–646). Those set their own `filter` on elements that also carry `.indicator-image`, and with equal specificity the later rule wins, so they must stay later. Icon buttons are round (`radius-full`) with a `--bsky-nav-bg-subtle` hover.
  - Filter and new-posts pills: `--bsky-nav-primary` with on-accent text, `radius-full`, shadow `-sm`.
  - Fixed sidecar panel: `--bsky-nav-bg`, 1px `--bsky-nav-border`, radius 12px, shadow `-lg`. The toggle and connector use the accent.
  - Skeleton shimmer: `--bsky-nav-bg-muted` to `--bsky-nav-bg-strong`.
  - Left nav toggle: `--bsky-nav-surface`, 1px border, `-sm` shadow, `--bsky-nav-text-medium` icon, hover `--bsky-nav-bg-subtle` and `--bsky-nav-text`.

- [ ] **Step 1: Record toolbar geometry before editing.** Run `npm run build` at the start of the task and save `$S/v8-before.json`. For `#bsky-navigator-toolbar .toolbar-icon`, `#infoIndicator`, `.global-info-indicator`, `#prevButton`, `#nextButton`, `#statusBar` and `#bsky-nav-left-nav-toggle`, in Light at 1400×900 and 390×844, it records the rect and the computed `padding`, `flexGrow`, `alignItems`, `justifyContent` and `cursor`. The left-sidebar `t1`–`t7` outputs were already saved in Task 1 Step 1 (`$S/sidebar-before-t*.txt`).

- [ ] **Step 2: Write `$S/v8.mjs`.** For each theme, assert:
  - The `#bsky-navigator-toolbar` background equals `rgb(--bsky-nav-bg)`; this used to be white in Dim.
  - The `#statusBar` background equals `rgb(--bsky-nav-bg)`.
  - A plain toolbar icon (`#sortIndicatorImage`, which has no `.image-highlight` or `.load-time-icon`) has `filter` `none` in Light and `invert(1)` in Dim/Dark. Any element carrying `.load-time-icon` or `.image-highlight` keeps its own filter (it starts with `invert(93%)` or `invert(36%)`).
  - No element inside `#bsky-navigator-toolbar` or `#statusBar`, and neither `#prevButton` nor `#nextButton`, has a class matching `/\b(css-|r-)[0-9a-z]+/`.
  - Rects and the recorded computed properties match `v8-before.json` within ±1px (both viewports).
  - With `config: { leftSidebarMode: 'Collapsible' }`, the `#bsky-nav-left-nav-toggle` background equals `rgb(--bsky-nav-surface)`.
  - With `boot({ api: true, config: { showReplySidecar: true } })` (Fixed by default), press `j` until `.fixed-sidecar-panel.visible`. Its background equals `rgb(--bsky-nav-bg)` and its `borderRadius === '12px'`.
  - Reload with the loading indicator on. The `#feedLoadingIndicator` background in Dim is not white (it either contains `21, 29, 40` or resolves the `var()`).
  - Grep invariants for the listed sections.

  Screenshots: `t8-{theme}-{feed,fixed-sidecar,collapsible}.png`.

- [ ] **Step 3: Run to see it fail.** Run `node $S/v8.mjs`. Expected: FAIL.
- [ ] **Step 4: Migrate** the sections and the JS markup and inline styles.
- [ ] **Step 5: Verify.**
  - `npm run build`, then `v8` passes.
  - eslint on `src/main.js`, `src/handlers/ItemHandler.js`, `src/handlers/FeedItemHandler.js` and `src/components/UIManager.js` shows no new errors.
  - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes.
  - `v1`, `v3`, `v4` and `v5` still pass.
  - The existing left-sidebar scripts `$S/t1.mjs`–`t7.mjs` print the same layouts as `$S/sidebar-before-t*.txt`. `diff` them; only the colors in screenshots may differ.
  - `feedMapStylesUnchanged` passes in all three themes. This task is the one most likely to cause inherited changes, through the toolbar/status bar background and fonts.
- [ ] **Step 6: Leave changes uncommitted.**

---

### Task 9: Whole-UI consistency audit

**Files:**
- Modify: only what the audit finds. List every fix in the task report.
- Create: `$S/v9.mjs`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `$S/v9.mjs` with the global invariants.**
  - Grep checks:
    - `grep -c "prefers-color-scheme" src/assets/css/style.css` is `4`, and all 4 are inside the feed map region.
    - `grep -rn "prefers-color-scheme" src --include=*.js` finds nothing.
    - `grep -rnE "css-175oi2r|r-1loqt21" src/sidecar.html src/components/UIManager.js src/handlers/FeedItemHandler.js src/handlers/ItemHandler.js` finds nothing. Today those strings in `ItemHandler.js` appear only in the `#prevButton`/`#nextButton` markup.
    - `feedMapUnchanged()` is true, and `feedMapStylesUnchanged` passes in all three themes with matched `colorScheme`. Log `feedMapPixelDiff` for each.
    - ESLint: the files touched by the plan show no errors beyond `$S/lint-before-all.txt`. `src/theme.js` and `src/configMigrations.js` are clean.
  - Literal colors: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/assets/css/style.css`, excluding the token block and the feed map region. List the survivors; each must be a documented feature color or the high-contrast `#000`.
  - Run `v1`–`v8` in sequence. All pass.
  - Mobile pass, 390×844, all three themes: toolbar and status bar visible and token-colored; `ringed().length === 1` after `j`; no horizontal scroll (`document.documentElement.scrollWidth <= 390`).
  - Theme mismatch: an OS dark scheme (`colorScheme: 'dark'` context option) with Bluesky Light. Our toolbar, modal and toasts are all Light-token colored. That is the core bug from spec Goal 2. The feed map will follow the OS here; that is the documented known limitation and is not a failure.

- [ ] **Step 2: Run, fix and re-run.** Run `npm run build && node $S/v9.mjs`, fix what it reports, and repeat until it passes.
- [ ] **Step 3: Leave changes uncommitted.** Report the screenshot paths for the owner's visual review in the three themes.
