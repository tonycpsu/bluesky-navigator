# Feed Map Tooltip Design

## Overview

Add a hover tooltip to feed map segments that shows a quick preview of the post without scrolling to it.

## Content Structure

```
┌────────────────────────────────────────┐
│ @handle · 2h ago                       │
│ Display Name                           │
├────────────────────────────────────────┤
│ Post text preview that can wrap to     │
│ two or three lines before being        │
│ truncated with an ellipsis...          │
├────────────────────────────────────────┤
│ ❤️ 12   🔁 3   💬 5                     │
└────────────────────────────────────────┘
```

**Content details:**
- Header: `@handle` + relative time ("2h ago", "yesterday")
- Author name: Display name on second line
- Preview: First ~150 characters of post text, truncated with ellipsis
- Engagement: Heart/repost/reply icons with counts (reuse existing SVG icons)

**Visual indicators:**
- Ratioed posts: tint engagement row background
- Read posts: slightly dimmed appearance
- Media: small icon if post has image/video

## Behavior

- **Delay**: 300ms before showing (prevents tooltip spam)
- **Hide**: Immediate on mouseout
- **Debounce**: Moving to adjacent segment within 100ms updates content instead of hide/show
- **Scope**: Works on both main timeline map and zoom indicator

## Positioning

- Appears **above** the feed map by default
- Flips **below** if near top of viewport
- Horizontally centered on hovered segment
- Shifts left/right if would overflow viewport edge
- Fixed position relative to segment (doesn't follow cursor)

## Styling

```css
.feed-map-tooltip {
  position: fixed;
  z-index: 10001;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 10px 12px;
  max-width: 300px;
  min-width: 200px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 150ms ease;
}

.feed-map-tooltip.visible { opacity: 1; }
```

Dark mode: invert background/border colors.

## Data Sources

All data available from existing methods:
- `getPostEngagement()` → likes, reposts, replies, isRatioed, hasImage, hasVideo
- `handleFromItem()` / `displayNameFromItem()` → author info
- `getTimestampForItem()` → post time
- `$(item).find('div[data-testid="postText"]').text()` → post content

## Files to Modify

1. `src/handlers/FeedItemHandler.js` - Tooltip logic, hover handlers
2. `src/assets/css/style.css` - Tooltip styling

## Implementation Notes

- Single tooltip element, reused for all segments
- Append to `document.body` for proper z-index stacking
- Use `setTimeout`/`clearTimeout` for delay management
