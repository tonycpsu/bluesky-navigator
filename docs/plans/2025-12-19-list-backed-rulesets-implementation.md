# List-Backed Rule Sets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Enable rule sets to be optionally backed by Bluesky lists, with automatic filtering based on list membership.

**Architecture:** Extend header parsing to extract backing list, check list membership during rule matching, add UI for configuring backing list and choosing add destination.

**Tech Stack:** JavaScript, existing ListCache, ConfigModal visual editor

---

### Task 1: Update Header Parsing for Backing List

**Files:**
- Modify: `src/main.js:206-251` (parseRulesConfig function)
- Modify: `src/handlers/ItemHandler.js:4232-4272` (parseRulesForState function)
- Modify: `src/components/ConfigModal.js:1114-1173` (parseRules function)

**Step 1: Update the header regex in main.js parseRulesConfig**

Change the section match to extract optional backing list:

```javascript
// Parse "[category]" or "[category -> List Name]" or "[category → List Name]"
const sectionMatch = line.match(/^\[([^\]→-]+?)(?:\s*(?:->|→)\s*(.+?))?\]$/);
if (sectionMatch) {
  rulesName = sectionMatch[1].trim();
  const backingList = sectionMatch[2]?.trim() || null;
  rules[rulesName] = [];
  // Store backing list in a separate map
  if (!rules._backingLists) rules._backingLists = {};
  if (backingList) rules._backingLists[rulesName] = backingList;
  continue;
}
```

**Step 2: Apply the same change to ItemHandler.js parseRulesForState**

Same regex pattern update.

**Step 3: Update ConfigModal.js parseRules to store backingList on category object**

```javascript
const sectionMatch = line.match(/^\[([^\]→-]+?)(?:\s*(?:->|→)\s*(.+?))?\]$/);
if (sectionMatch) {
  currentCategory = {
    name: sectionMatch[1].trim(),
    backingList: sectionMatch[2]?.trim() || null,
    rules: []
  };
  categories.push(currentCategory);
  continue;
}
```

**Step 4: Run build to verify no syntax errors**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/main.js src/handlers/ItemHandler.js src/components/ConfigModal.js
git commit -m "feat: Parse backing list from rule set header syntax"
```

---

### Task 2: Update serializeRules to Output Backing List

**Files:**
- Modify: `src/components/ConfigModal.js:1178-1210` (serializeRules function)

**Step 1: Update header serialization to include backing list**

```javascript
serializeRules(categories) {
  const lines = [];

  for (const category of categories) {
    if (lines.length > 0) lines.push(''); // Blank line between categories

    // Include backing list in header if present
    if (category.backingList) {
      lines.push(`[${category.name} -> ${category.backingList}]`);
    } else {
      lines.push(`[${category.name}]`);
    }
    // ... rest of serialization unchanged
```

**Step 2: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/ConfigModal.js
git commit -m "feat: Serialize backing list in rule set header"
```

---

### Task 3: Add Backing List Check to handleMatchesCategory

**Files:**
- Modify: `src/handlers/ItemHandler.js:4283-4317` (handleMatchesCategory function)

**Step 1: Add backing list membership check at start of function**

After getting the rules, check if category has a backing list:

```javascript
handleMatchesCategory(normalizedHandle, categoryName, visited = new Set()) {
  if (visited.has(categoryName)) {
    return false;
  }

  const rules = this.state.rules?.[categoryName];
  if (!rules) return false;

  visited.add(categoryName);

  // Check backing list membership first
  const backingList = this.state.rules._backingLists?.[categoryName];
  if (backingList && this.state.listCache) {
    const result = this.state.listCache.isInListSync(normalizedHandle, backingList);
    if (result === true) {
      return true;
    }
    // Trigger async fetch if not cached
    if (result === undefined) {
      this.state.listCache.getMembers(backingList).then(() => {
        this.scheduleHighlightRefresh();
      });
    }
  }

  // Continue with existing rule checks...
  for (const rule of rules) {
    // ... existing code
  }
  return false;
}
```

**Step 2: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/handlers/ItemHandler.js
git commit -m "feat: Check backing list membership in handleMatchesCategory"
```

---

### Task 4: Add Backing List Dropdown to Visual Editor

**Files:**
- Modify: `src/components/ConfigModal.js:1273-1318` (renderVisualEditor - category header section)

**Step 1: Add backing list dropdown after category name input**

In the `renderVisualEditor` function, add a backing list dropdown:

```javascript
// After the category name input, add:
<select class="rules-backing-list" data-category="${catIndex}"
        title="Backing list (authors in list are automatically matched)"
        ${!this.hasApiAccess() ? 'disabled' : ''}>
  <option value="">No backing list</option>
  ${(this.cachedListNames || []).map(name => `
    <option value="${this.escapeHtml(name)}"
            ${category.backingList === name ? 'selected' : ''}>
      ${this.escapeHtml(name)}
    </option>
  `).join('')}
  ${category.backingList && !(this.cachedListNames || []).includes(category.backingList) ? `
    <option value="${this.escapeHtml(category.backingList)}" selected>
      ${this.escapeHtml(category.backingList)}
    </option>
  ` : ''}
</select>
```

**Step 2: Add event listener for backing list changes in attachRulesEventListeners**

```javascript
// Handle backing list selection
this.modalEl.querySelectorAll('.rules-backing-list').forEach(select => {
  select.addEventListener('change', (e) => {
    const catIndex = parseInt(e.target.dataset.category);
    const listName = e.target.value || null;
    this.parsedRules[catIndex].backingList = listName;
    this.syncVisualToRaw();
  });
});
```

**Step 3: Add CSS for the dropdown in style.css**

```css
.rules-backing-list {
  margin-left: 8px;
  padding: 2px 4px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 3px;
  max-width: 150px;
}
```

**Step 4: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/ConfigModal.js src/assets/css/style.css
git commit -m "feat: Add backing list dropdown to visual editor"
```

---

### Task 5: Update Add-Rule Popup for List-Backed Categories

**Files:**
- Modify: `src/handlers/ItemHandler.js` (showAddRulePopup and related functions)

**Step 1: Find the add-rule popup rendering code**

Search for `showAddRulePopup` or the popup HTML rendering.

**Step 2: Check if category has backing list and show two buttons**

When rendering the popup for a category with a backing list, show:
- "Add to List" (primary button)
- "Add to Rules Only" (secondary button)

```javascript
// In the popup rendering, check for backing list
const backingList = this.state.rules._backingLists?.[categoryName];
const hasBackingList = !!backingList;

// Render different buttons based on backing list
if (hasBackingList) {
  // Two buttons
  buttonsHtml = `
    <button type="button" class="add-rule-btn add-rule-to-list primary"
            data-category="${categoryName}" data-list="${backingList}">
      Add to List
    </button>
    <button type="button" class="add-rule-btn add-rule-to-rules-only secondary"
            data-category="${categoryName}">
      Add to Rules Only
    </button>
  `;
} else {
  // Single Add button (existing behavior)
  buttonsHtml = `
    <button type="button" class="add-rule-btn add-rule-confirm primary"
            data-category="${categoryName}">
      Add
    </button>
  `;
}
```

**Step 3: Handle "Add to List" button click**

When "Add to List" is clicked:
1. Resolve handle to DID
2. Call api.addToList(listUri, did)
3. Invalidate list cache
4. Show success notification

```javascript
async handleAddToList(handle, listName) {
  try {
    // Get list URI
    const listUri = await this.state.listCache.getListUri(listName);
    if (!listUri) {
      this.showNotification(`List "${listName}" not found`, 'error');
      return false;
    }

    // Resolve handle to DID
    const did = await this.api.resolveHandleToDid(handle);
    if (!did) {
      this.showNotification(`Could not resolve handle: ${handle}`, 'error');
      return false;
    }

    // Add to list
    await this.api.addToList(listUri, did);

    // Invalidate cache to pick up the new member
    this.state.listCache.invalidate(listName);

    this.showNotification(`Added ${handle} to list "${listName}"`, 'success');
    return true;
  } catch (error) {
    console.warn('Failed to add to list:', error);
    this.showNotification(`Failed to add to list: ${error.message}`, 'error');
    return false;
  }
}
```

**Step 4: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/handlers/ItemHandler.js
git commit -m "feat: Two-button add UI for list-backed categories"
```

---

### Task 6: Implement Remove from Wherever Author Exists

**Files:**
- Modify: `src/handlers/ItemHandler.js` (removeRule or similar function)

**Step 1: Find the remove rule/author function**

Search for functions that handle removing authors from categories.

**Step 2: Update removal to check both list and local rules**

```javascript
async removeAuthorFromCategory(handle, categoryName) {
  const backingList = this.state.rules._backingLists?.[categoryName];
  let removedFromList = false;
  let removedFromRules = false;

  // Check if in backing list and remove
  if (backingList && this.state.listCache && this.api) {
    const isInList = await this.state.listCache.isInList(handle, backingList);
    if (isInList) {
      // Need to remove from list - requires getting the listitem record URI
      // This is more complex as we need to find and delete the listitem
      try {
        await this.removeFromList(handle, backingList);
        removedFromList = true;
      } catch (error) {
        console.warn('Failed to remove from list:', error);
      }
    }
  }

  // Check if in local rules and remove
  const rules = this.state.rules[categoryName];
  if (rules) {
    const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;
    const ruleIndex = rules.findIndex(r =>
      r.type === 'from' && r.value.toLowerCase() === normalizedHandle.toLowerCase()
    );
    if (ruleIndex !== -1) {
      rules.splice(ruleIndex, 1);
      removedFromRules = true;
      // Update config
      this.updateRulesConfig();
    }
  }

  if (removedFromList || removedFromRules) {
    this.showNotification(`Removed ${handle} from "${categoryName}"`, 'success');
  }

  return removedFromList || removedFromRules;
}
```

**Step 3: Add removeFromList helper**

This requires finding the listitem record and deleting it:

```javascript
async removeFromList(handle, listName) {
  const listUri = await this.state.listCache.getListUri(listName);
  if (!listUri) return;

  const did = await this.api.resolveHandleToDid(handle);
  if (!did) return;

  // Need to find the listitem record for this member
  // This requires fetching list members with their record URIs
  // For now, invalidate cache - full removal implementation TBD
  this.state.listCache.invalidate(listName);
}
```

**Note:** Full list item removal requires additional API work to find and delete the specific listitem record. For v1, we can show a notification directing user to remove from Bluesky directly.

**Step 4: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/handlers/ItemHandler.js
git commit -m "feat: Remove authors from both list and local rules"
```

---

### Task 7: Add List Validation

**Files:**
- Modify: `src/components/ConfigModal.js` (backing list dropdown change handler)

**Step 1: Validate that selected list exists**

When user selects a backing list, verify it exists:

```javascript
// In backing list change handler
select.addEventListener('change', async (e) => {
  const catIndex = parseInt(e.target.dataset.category);
  const listName = e.target.value || null;

  if (listName) {
    // Verify list exists
    const listUri = await this.getListUri(listName);
    if (!listUri) {
      this.showNotification(`List "${listName}" not found`, 'error');
      e.target.value = this.parsedRules[catIndex].backingList || '';
      return;
    }
  }

  this.parsedRules[catIndex].backingList = listName;
  this.syncVisualToRaw();
});
```

**Step 2: Add getListUri helper method**

```javascript
async getListUri(listName) {
  const listCache = unsafeWindow.blueskyNavigatorState?.listCache;
  if (!listCache) return null;
  return await listCache.getListUri(listName);
}
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/ConfigModal.js
git commit -m "feat: Validate backing list exists on selection"
```

---

### Task 8: Final Integration Testing

**Step 1: Test backing list parsing**

1. Add a rule set with backing list syntax: `[friends -> My Friends List]`
2. Verify it parses correctly and list members are matched

**Step 2: Test visual editor**

1. Open config modal
2. Verify backing list dropdown shows available lists
3. Change backing list selection
4. Verify header updates correctly

**Step 3: Test add-rule popup**

1. Select a post by someone not in a list-backed category
2. Open add-rule popup
3. Verify two buttons appear for list-backed categories
4. Test "Add to List" button
5. Test "Add to Rules Only" button

**Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: Integration fixes for list-backed rule sets"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Update header parsing for `[name -> List]` syntax |
| 2 | Update serialization to output backing list |
| 3 | Add backing list check to handleMatchesCategory |
| 4 | Add backing list dropdown to visual editor |
| 5 | Two-button add UI for list-backed categories |
| 6 | Remove from wherever author exists |
| 7 | Validate backing list exists |
| 8 | Integration testing |
