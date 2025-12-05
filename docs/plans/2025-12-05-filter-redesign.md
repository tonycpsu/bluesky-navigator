# Filter System Redesign

## Problem

The current filter implementation has race conditions where the filter state gets cleared by spurious autocomplete events. The filter value lives in two places (state and DOM input field) which get out of sync.

## Solution: Preview/Commit Hybrid Model

### Core Architecture

**Single source of truth**: The *committed* filter lives only in `this.state.filter`. The input field is UI for composing a new filter.

**Two distinct states**:
- `this.state.filter` - The committed filter (persisted, applied to hide items)
- Input field value - The "draft" filter (temporary, used for preview only)

**Behavior**:
- **Preview** (typing): Non-matching items get `.filter-preview-hidden` class (dimmed at 30% opacity, still visible)
- **Committed** (Enter pressed): Non-matching items get `.filtered` class (hidden), state updates, filter pill appears

### Event Handling

**Input events** (typing):
- On `input`: Apply preview styling immediately (no debounce, CSS-only)
- Preview reads from input field, never touches `this.state.filter`

**Commit events**:
- `Enter` key → commit input value to state
- Clicking saved search → commit that value
- Autocomplete select → commit selected value

**Ignored events**:
- `autocompletechange`, `autocompleteclose` - caused the bugs
- `blur`, `focus` - don't affect filter

**Escape key**:
- If input differs from committed: revert input, clear preview
- If input matches committed: clear filter entirely

### Visual Feedback

**Preview state**:
- Non-matching: `.filter-preview-hidden` → `opacity: 0.3`
- No filter pill (not committed)

**Committed state**:
- Non-matching: `.filtered` → `display: none`
- Matching: text highlights for search terms
- Filter pill visible

### Implementation

**New methods**:
```javascript
applyFilterPreview(filterText)  // CSS classes only, no state
commitFilter(filterText)        // Update state, hide items
clearFilterPreview()            // Remove preview classes
```

**Simplified event bindings**:
```javascript
$(searchField).on('input', () => applyFilterPreview());
$(searchField).on('keydown', handleKeydown);  // Enter commits, Escape reverts
$(searchField).on('autocompleteselect', commitFromAutocomplete);
// NO autocompletechange/autocompleteclose handlers
```

### State Persistence

- Filter saved locally, excluded from remote sync (session-only)
- On page load: set input from state, apply committed filter
- On handler activate: restore input from state, apply filtering
