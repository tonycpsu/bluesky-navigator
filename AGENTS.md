# Bluesky Navigator - Agent Guidelines

Tampermonkey userscript that adds keyboard navigation, read tracking, filtering, and enhancements to Bluesky.

## Quick Reference

```bash
npm run dev      # Watch mode for development
npm run build    # Production build
npm test         # Run Playwright tests
npm run test:headed  # Tests with visible browser
```

## Architecture

### Core Files
- `src/main.js` - Entry point, initialization, DOM observation
- `src/state.js` - Default state object and state proxy
- `src/StateManager.js` - State persistence (local + optional remote sync)
- `src/ConfigWrapper.js` - Configuration management wrapper

### Handlers (in `src/handlers/`)
- `ItemHandler.js` - Base class for item navigation, keyboard handling, scroll management
- `FeedItemHandler.js` - Feed-specific logic, filtering, feed map, timeouts
- `PostItemHandler.js` - Single post view
- `ProfileItemHandler.js` - Profile page handling

### Components (in `src/components/`)
- `ConfigModal.js` - Settings UI with tabs (Display, Rules, Timeouts, etc.)
- `ShortcutOverlay.js` - Keyboard shortcuts help overlay
- `PostViewModal.js` - Full-screen post view with sidecar

### Other
- `src/assets/css/style.css` - All CSS styles
- `doc/remote_state.md` - Remote state sync setup

## Critical Patterns

### State Management
Always use `updateState()` for state changes that should persist:
```javascript
// Correct - persists across reloads
state.stateManager.updateState({ timeouts: newTimeouts });
state.stateManager.saveStateImmediately();

// Wrong - doesn't persist
state.timeouts = newTimeouts;
```

### jQuery vs DOM Elements
Many methods receive jQuery objects. When you need raw DOM access:
```javascript
// Handle both jQuery and raw elements
const el = element instanceof $ ? element[0] : (element.jquery ? element[0] : element);
if (el && el.style) {
  el.style.setProperty('scroll-margin-top', value, 'important');
}
```

### CSS with !important
jQuery `.css()` ignores the third parameter. Use native API:
```javascript
// Wrong - third param ignored
$(element).css('scroll-margin-top', '50px', 'important');

// Correct
element.style.setProperty('scroll-margin-top', '50px', 'important');
```

### Remote State Sync
Local-only fields (`filter`, `timeouts`) must be preserved when remote state is newer:
```javascript
const { filter: remoteFilter, timeouts: remoteTimeouts, ...remoteWithoutLocalFields } = remoteState;
return {
  ...remoteWithoutLocalFields,
  filter: savedState.filter || defaultState.filter,
  timeouts: savedState.timeouts || defaultState.timeouts,
};
```

## Handler Architecture

### Inheritance Chain
```
Handler (base)
  └── ItemHandler (navigation, keyboard, scroll, popups)
        ├── FeedItemHandler (feed filtering, feed map, timeouts)
        ├── PostItemHandler (single post view)
        ├── ProfileItemHandler (profile pages)
        └── SavedItemHandler (saved posts)
```

### Key ItemHandler Methods
- `handleItemAction(event)` - Keyboard shortcut dispatcher
- `filterItems()` - Apply current filter to items
- `updateFilterEnforcement()` - Periodic re-filtering for React DOM updates
- `applyThreadStyling(element, selected)` - Visual styling for focused item

### Filter Enforcement
Bluesky's React can re-render DOM and remove our filtering. Use intervals carefully:
```javascript
if (this.state.filter || hasActiveTimeouts) {
  this._filterEnforcementInterval = setInterval(() => {
    if (this.ignoreMouseMovement) return; // Skip during navigation
    // Re-apply filters...
  }, 200);
}
```

## Common Pitfalls

1. **Scroll interference**: Filter enforcement can interfere with scroll. Check `ignoreMouseMovement` flag.

2. **Author handle extraction**: Posts use `getAuthorHandle()`, reposts also need `getReposterHandle()`.

3. **Config vs State**: Config (`this.config.get()`) for user preferences, State (`this.state`) for runtime data.

4. **Event cleanup**: Always clean up intervals/listeners in `deactivate()`:
```javascript
deactivate() {
  if (this._myInterval) {
    clearInterval(this._myInterval);
    this._myInterval = null;
  }
}
```

## Testing

Tests run with Playwright + Firefox + Tampermonkey:
```bash
npm test                    # All tests
npm run test:headed         # Visible browser
npm test -- --grep "test name"  # Single test
```

Test files are in `tests/e2e/`. The test framework handles:
- Installing Tampermonkey extension
- Installing the userscript
- Logging into Bluesky (credentials in `tests/.env`)

## Code Style

- No semicolons (project uses no-semi style)
- ES6 modules with default exports for classes
- JSDoc comments for public methods
- Console logs only for debugging (remove before commit)

## Adding Features

1. **New hotkey**: Add case in `ItemHandler.handleItemAction()`
2. **New config option**: Add to `CONFIG_SCHEMA` in `ConfigModal.js`
3. **New state field**: Add to `DEFAULT_STATE` in `state.js`
4. **New UI panel**: Add tab in `ConfigModal.renderTabs()`
5. **New CSS**: Add to `src/assets/css/style.css` with section comment

## Build Verification

Always rebuild and test after changes:
```bash
npm run build
npm test
```

The git commit hook automatically rebuilds, but manual verification catches issues early.
