# Rule Builder UI Design

## Overview

Add a visual rule builder UI to the Rules section of the config modal. The builder provides a user-friendly way to create and edit filter rules while maintaining the existing text format as the source of truth.

## Structure

The Rules tab contains two sub-tabs:

- **Visual**: Structured editor with accordion categories and inline rule editing
- **Raw**: Existing textarea for direct text editing

### Sync Behavior

- Visual → Raw: Every change in Visual immediately regenerates the raw text
- Raw → Visual: Switching to Visual tab parses the current raw text fresh
- Comments in raw text are lost when editing via Visual (acceptable trade-off)

## Visual Editor UI

### Category Accordion

```
[▼] Category Name                    [✏️] [🗑]
├── [Allow ▼] [From ▼] [@handle___] [🗑]
├── [Deny  ▼] [All  ▼] [disabled  ] [🗑]
└── [+ Add Rule]

[+ Add Category]
```

- Header row with collapse toggle, editable name, delete button
- Rule rows with action dropdown, type dropdown, value input, delete button
- Add buttons for rules (per category) and categories (global)

### Rule Row Controls

- **Action dropdown**: "Allow" | "Deny"
- **Type dropdown**: "From (author)" | "Content (text)" | "All"
- **Value input**: Text field with contextual placeholder, disabled for "All" type

### Empty States

- No categories: "No filter rules defined. Click 'Add Category' to create one."
- Empty category: "No rules in this category. Click 'Add Rule' to create one."

## Parsing & Serialization

### Parse (Raw → Visual)

```javascript
// Input:
[politics]
@aoc
trump
deny from all

// Output:
[{
  name: "politics",
  rules: [
    { action: "allow", type: "from", value: "@aoc" },
    { action: "allow", type: "content", value: "trump" },
    { action: "deny", type: "all", value: "" }
  ]
}]
```

### Serialize (Visual → Raw)

- Use shortcut format when possible (`@handle`, `keyword`)
- Use explicit format for deny rules and "all" type
- One blank line between categories

## Files to Modify

1. `src/components/ConfigModal.js` - Add RuleBuilder, sub-tabs, parse/serialize logic
2. `src/assets/css/style.css` - Styles for sub-tabs, accordions, rule rows, dark mode

## Files Unchanged

- `main.js` - Parsing logic stays there, rulesConfig format unchanged
- `ConfigWrapper.js` - Just stores the string
- Handler files - Consume parsed rules as before
