# Bluesky Lists + Rules Sync Feature Design

## Overview

This feature enables synchronization between Bluesky Navigator's filter rules and Bluesky lists, allowing users to:
1. Filter posts by list membership using new rule syntax
2. Sync rule categories with Bluesky lists (one-way or bidirectional)

## New Rule Syntax

### List Membership Rules

Extend the rule syntax with a new `list` type:

```ini
[favorites]
allow from list "My Favorites"      # matches authors in the named list
deny from list "Muted Accounts"     # excludes authors in the named list

# Shorthand syntax (similar to @handle):
&"My Favorites"                     # shorthand for: allow from list "My Favorites"
```

### Syntax Reference

| Prefix | Meaning | Example |
|--------|---------|---------|
| `@` | author handle | `@alice.bsky.social` |
| `$` | include category | `$music` |
| `&` | list reference | `&"My Favorites"` |

The `&` prefix was chosen as mnemonic for "and also from this list".

## Sync Mechanism

### Sync Directions

| Direction | What it does |
|-----------|--------------|
| **Rules → List** | Creates/updates a Bluesky list from all `from @handle` rules in a category |
| **List → Rules** | Imports list members as `from @handle` rules into a category |
| **Bidirectional** | Merges both: adds missing handles to list, adds missing members to rules |

### Conflict Handling

All sync operations are **additive only** to avoid accidental data loss:
- Rules → List: Adds members not already in list (never removes)
- List → Rules: Adds handles not already in rules (never removes existing rules)
- Bidirectional: Union of both

Deletions require explicit user action.

## List Resolution & Caching

### Resolution Strategy

1. **On rules load/change:** Scan for `list` rules and extract list names
2. **Lazy fetch:** Fetch list members when first needed (not on startup)
3. **Cache in memory:** Store as `Map<listName, Set<handle>>` for O(1) lookups
4. **Cache duration:** 5 minutes (configurable), with manual refresh option

### List Name → URI Mapping

Since lists are referenced by name in rules but the API needs URIs:
1. On first use, call `getLists({ actor: currentUser })` to get all user's lists
2. Build a name → URI lookup table
3. Fetch members with `getList({ list: uri })`

### Handling Missing Lists

```ini
[favorites]
allow from list "Nonexistent List"  # logs warning, rule is skipped
```

If a referenced list doesn't exist:
- Log a console warning
- Treat the rule as non-matching (fail open for `allow`, fail closed for `deny`)

### API Dependency

This feature requires the AT Protocol agent to be configured (app password). If not configured:
- `from list` rules are skipped with a warning
- Sync buttons are disabled with tooltip explaining why

## UI Design

### Sync Button Location

A new "Sync" button in the Rules tab of the config modal, next to each category header:

```
[music]  Sync ▾
─────────────────
  ├─ Push to List...
  ├─ Pull from List...
  └─ Bidirectional Sync...
```

### Push to List Dialog

```
┌─ Push "music" to Bluesky List ─────────────────┐
│                                                 │
│  Select target list:                            │
│  ○ Create new list: [________________]          │
│  ● Existing list:   [My Music People    ▾]     │
│                                                 │
│  Preview: 12 handles will be added              │
│  (3 already in list, 0 not in rules)            │
│                                                 │
│              [Cancel]  [Push to List]           │
└─────────────────────────────────────────────────┘
```

### Pull from List Dialog

```
┌─ Pull from Bluesky List to "music" ────────────┐
│                                                 │
│  Select source list:                            │
│  [My Music People                        ▾]     │
│                                                 │
│  Preview: 8 new handles will be added           │
│  (12 already in rules)                          │
│                                                 │
│  ☑ Add as: allow from @handle                   │
│  ☐ Add as: deny from @handle                    │
│                                                 │
│              [Cancel]  [Import Handles]         │
└─────────────────────────────────────────────────┘
```

### Visual Feedback

- Spinner during API calls
- Success toast: "Synced 5 handles with 'My Music People'"
- Error toast if API fails

## Implementation Components

### 1. API Layer (`src/api.js`)

New methods:
- `getLists()` - fetch user's lists
- `getListMembers(uri)` - fetch all members of a list (with pagination)
- `addToList(listUri, did)` - add member to list
- `createList(name, purpose)` - create new list

### 2. List Cache (new module or in `ItemHandler`)

- `ListCache` class with `get(listName)`, `refresh()`, `invalidate()`
- Stores resolved handles per list
- Auto-expires after configurable duration

### 3. Rules Parser Extension (`main.js`, `ItemHandler.js`)

- Add `list` as new rule type: `{ action, type: 'list', value: 'List Name' }`
- Add `&"List Name"` shorthand parsing
- Update `matchesRule()` to check list membership via cache

### 4. Sync UI (`ConfigModal.js`)

- Sync dropdown menu per category
- Push/Pull/Bidirectional dialogs
- Preview counts before sync
- Progress and result feedback

### 5. Config Options

- `listCacheDuration` (default: 5 minutes)
- No new required config - uses existing AT Protocol credentials

## AT Protocol API Reference

Relevant endpoints from the Bluesky API:

- `app.bsky.graph.getLists({ actor })` - get user's lists
- `app.bsky.graph.getList({ list: uri })` - get list members
- `app.bsky.graph.listitem` - record type for list membership

List types:
- `app.bsky.graph.defs#curatelist` - curation lists
- `app.bsky.graph.defs#modlist` - moderation lists

## Summary

| Feature | Description |
|---------|-------------|
| New syntax | `allow/deny from list "Name"` and `&"Name"` shorthand |
| Filtering | Check post author against cached list members |
| Push sync | Export category's `@handle` rules to a Bluesky list |
| Pull sync | Import list members as `@handle` rules |
| Bidirectional | Merge both directions (additive only) |
| Caching | 5-min memory cache, lazy fetch, manual refresh |
