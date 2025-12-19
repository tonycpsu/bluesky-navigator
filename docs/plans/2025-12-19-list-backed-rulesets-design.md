# List-Backed Rule Sets Design

## Overview

Extends rule sets to optionally be backed by a Bluesky list. When a rule set has a backing list:
- Authors in the list are automatically recognized for filtering (list is source of truth)
- Adding authors defaults to the list, with option to add locally only
- Removal removes from wherever the author exists (list, local rules, or both)

This complements the existing push/pull sync by providing automatic, continuous sync for rule sets that should mirror a list.

## Configuration Syntax

### Header Syntax

Rule sets declare their backing list in the header using `->` or `→`:

```ini
[friends -> My Friends List]
allow from @alice.bsky.social
# Authors in "My Friends List" are also matched automatically

[enemies -> Block List]
deny from @spammer.bsky.social
```

### Visual Editor

The config modal's visual editor shows a "Backing List" dropdown below the category name field:
- Options: "None" + all user's Bluesky lists
- Selecting a list adds/updates the `-> List Name` in the header
- Selecting "None" removes the backing list association

### Validation

If the specified list doesn't exist on Bluesky:
- Show validation error: "List 'X' not found"
- Require the list to exist first (no auto-creation)
- Prevents typos from silently failing

## Sync Behavior

### Source of Truth

The Bluesky list is the source of truth:
- Authors in the list are automatically matched by the rule set
- No local copy of list members is stored in the rules
- List membership is checked via the existing `ListCache`

### Local-Only Rules

Rule sets can still have author rules that aren't in the backing list:
- These are "local-only" authors
- They work alongside list members for filtering
- Useful for temporary additions or authors you don't want in the list

### No Visual Distinction

Users don't need to see which authors are from the list vs local:
- The system tracks it internally
- Add/remove just works regardless of source
- Simpler mental model for users

## Add Author Flow

When adding an author to a list-backed rule set (via sidecar or add-rule popup):

### UI: Two Buttons

```
┌─ Add @alice.bsky.social to "friends" ──────┐
│                                             │
│  [  Add to List  ]   [ Add to Rules Only ] │
│      (primary)            (secondary)       │
└─────────────────────────────────────────────┘
```

- **Add to List** (primary/default): Adds to the Bluesky list via API
- **Add to Rules Only** (secondary): Adds as local rule, not synced to list

### Behavior

| Button | API Call | Local Rules | List Members |
|--------|----------|-------------|--------------|
| Add to List | Yes (addToList) | No change | Updated |
| Add to Rules Only | None | Added | No change |

## Remove Author Flow

When removing an author from a list-backed rule set:

### Behavior

The system removes from wherever the author exists:
- If in list → remove from list via API
- If in local rules → remove from local rules
- If in both → remove from both

### No Prompt Needed

Since we remove from wherever they exist, no disambiguation is needed. The user just "removes an author" and it works.

## Error Handling

### API Failures

When list add/remove fails:
- Show error toast with failure reason
- Don't change local state (keep UI consistent with reality)
- User can retry manually

### Network Issues

- List membership checks fall back to cached data
- If no cache exists, list members won't be matched until fetch succeeds
- Local-only rules continue to work regardless

## Implementation Notes

### Parsing

Update header parsing to extract backing list:

```javascript
// Parse "[category -> List Name]" or "[category → List Name]"
const headerMatch = header.match(/^\[([^\]→-]+?)(?:\s*(?:->|→)\s*(.+?))?\]$/);
const categoryName = headerMatch[1].trim();
const backingList = headerMatch[2]?.trim() || null;
```

### Rule Matching

Update `handleMatchesCategory()` to check backing list:

```javascript
// Check backing list membership (already done via ListCache)
if (category.backingList) {
  const inList = this.state.listCache?.isInListSync(handle, category.backingList);
  if (inList === true) return true;
  // Trigger async fetch if not cached
  if (inList === undefined) {
    this.state.listCache?.getMembers(category.backingList);
  }
}
```

### Visual Editor Integration

Add backing list dropdown to category editor:
- Fetch available lists via `listCache.getListNames()`
- Show current backing list as selected
- Update header text when selection changes

### Existing Authors

When adding a backing list to an existing rule set with author rules:
- Keep existing authors as local-only
- No automatic migration to list
- User can manually re-add to move to list if desired

## Summary

| Aspect | Design Decision |
|--------|-----------------|
| Configuration | Header syntax: `[name -> List Name]` |
| Visual editor | Backing List dropdown, "None" + available lists |
| Source of truth | Bluesky list (automatic sync) |
| Local-only rules | Supported alongside list |
| Visual distinction | None needed (transparent to user) |
| Add UI | Two buttons: "Add to List" (primary) / "Add to Rules Only" |
| Remove behavior | Remove from wherever author exists |
| Missing list | Validation error, require list to exist |
| Existing authors | Keep as local-only when linking |
| API errors | Toast + no local state change |
