# List Rules Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable filtering posts by Bluesky list membership and syncing rule categories with lists.

**Architecture:** Extend the existing rules system with a new `list` rule type. Add list API methods to `api.js`. Create a `ListCache` class for caching list members. Add sync UI to the ConfigModal Rules panel.

**Tech Stack:** JavaScript, jQuery, AT Protocol API (@atproto/api)

---

## Task 1: Add List API Methods

**Files:**
- Modify: `src/api.js`

**Step 1: Add getLists method**

Add after the `getProfile` method (around line 103):

```javascript
/**
 * Fetches all lists owned by an actor
 * @param {string} actor - Handle or DID (defaults to logged-in user)
 * @returns {Promise<Array>} Array of list objects with uri, name, purpose
 */
async getLists(actor = null) {
  const params = { actor: actor || this.agent.session?.did, limit: 100 };
  const lists = [];
  let cursor = null;

  do {
    if (cursor) params.cursor = cursor;
    const { data } = await this.agent.app.bsky.graph.getLists(params);
    lists.push(...data.lists);
    cursor = data.cursor;
  } while (cursor);

  return lists;
}
```

**Step 2: Add getListMembers method**

```javascript
/**
 * Fetches all members of a list
 * @param {string} listUri - AT URI of the list
 * @returns {Promise<Array>} Array of member objects with did, handle
 */
async getListMembers(listUri) {
  const params = { list: listUri, limit: 100 };
  const members = [];
  let cursor = null;

  do {
    if (cursor) params.cursor = cursor;
    const { data } = await this.agent.app.bsky.graph.getList(params);
    members.push(...data.items.map(item => ({
      did: item.subject.did,
      handle: item.subject.handle,
    })));
    cursor = data.cursor;
  } while (cursor);

  return members;
}
```

**Step 3: Add createList method**

```javascript
/**
 * Creates a new list
 * @param {string} name - Display name for the list
 * @param {string} purpose - 'curatelist' or 'modlist'
 * @param {string} description - Optional description
 * @returns {Promise<string>} URI of the created list
 */
async createList(name, purpose = 'app.bsky.graph.defs#curatelist', description = '') {
  const record = {
    $type: 'app.bsky.graph.list',
    name,
    purpose,
    description,
    createdAt: new Date().toISOString(),
  };
  const { data } = await this.agent.com.atproto.repo.createRecord({
    repo: this.agent.session.did,
    collection: 'app.bsky.graph.list',
    record,
  });
  return data.uri;
}
```

**Step 4: Add addToList method**

```javascript
/**
 * Adds a user to a list
 * @param {string} listUri - AT URI of the list
 * @param {string} subjectDid - DID of the user to add
 * @returns {Promise<string>} URI of the list item record
 */
async addToList(listUri, subjectDid) {
  const record = {
    $type: 'app.bsky.graph.listitem',
    list: listUri,
    subject: subjectDid,
    createdAt: new Date().toISOString(),
  };
  const { data } = await this.agent.com.atproto.repo.createRecord({
    repo: this.agent.session.did,
    collection: 'app.bsky.graph.listitem',
    record,
  });
  return data.uri;
}
```

**Step 5: Add resolveHandleToDid method**

```javascript
/**
 * Resolves a handle to a DID
 * @param {string} handle - User handle (with or without @)
 * @returns {Promise<string|null>} DID or null if not found
 */
async resolveHandleToDid(handle) {
  const cleanHandle = handle.replace(/^@/, '');
  try {
    const { data } = await this.agent.resolveHandle({ handle: cleanHandle });
    return data.did;
  } catch (error) {
    console.warn(`Failed to resolve handle ${cleanHandle}:`, error);
    return null;
  }
}
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 7: Commit**

```bash
git add src/api.js
git commit -m "feat: add list API methods for list-rules sync"
```

---

## Task 2: Create ListCache Class

**Files:**
- Create: `src/ListCache.js`

**Step 1: Create the ListCache module**

```javascript
// ListCache.js - Caches Bluesky list members for rule filtering

/**
 * Caches list members for efficient rule matching.
 * Lists are fetched lazily and cached for a configurable duration.
 */
export class ListCache {
  /**
   * @param {BlueskyAPI} api - API instance for fetching lists
   * @param {number} cacheDurationMs - Cache duration in milliseconds (default 5 min)
   */
  constructor(api, cacheDurationMs = 5 * 60 * 1000) {
    this.api = api;
    this.cacheDurationMs = cacheDurationMs;

    // Map of list name -> { members: Set<handle>, fetchedAt: Date, uri: string }
    this.cache = new Map();

    // Map of list name -> URI (built from getLists call)
    this.listNameToUri = new Map();

    // Whether we've fetched the user's list metadata
    this.listsMetadataFetched = false;
  }

  /**
   * Ensures list metadata (name -> URI mapping) is loaded
   * @private
   */
  async ensureListsMetadata() {
    if (this.listsMetadataFetched || !this.api) return;

    try {
      const lists = await this.api.getLists();
      for (const list of lists) {
        this.listNameToUri.set(list.name.toLowerCase(), list.uri);
      }
      this.listsMetadataFetched = true;
    } catch (error) {
      console.warn('Failed to fetch lists metadata:', error);
    }
  }

  /**
   * Gets the cached members for a list, fetching if needed
   * @param {string} listName - Display name of the list
   * @returns {Promise<Set<string>|null>} Set of handles (lowercase) or null if list not found
   */
  async getMembers(listName) {
    const normalizedName = listName.toLowerCase();

    // Check cache first
    const cached = this.cache.get(normalizedName);
    if (cached && (Date.now() - cached.fetchedAt) < this.cacheDurationMs) {
      return cached.members;
    }

    // Ensure we have list metadata
    await this.ensureListsMetadata();

    // Get URI for list name
    const listUri = this.listNameToUri.get(normalizedName);
    if (!listUri) {
      console.warn(`List not found: ${listName}`);
      return null;
    }

    // Fetch members
    try {
      const members = await this.api.getListMembers(listUri);
      const handleSet = new Set(members.map(m => m.handle.toLowerCase()));

      this.cache.set(normalizedName, {
        members: handleSet,
        fetchedAt: Date.now(),
        uri: listUri,
      });

      return handleSet;
    } catch (error) {
      console.warn(`Failed to fetch list members for ${listName}:`, error);
      return null;
    }
  }

  /**
   * Checks if a handle is in a list
   * @param {string} handle - Handle to check (with or without @)
   * @param {string} listName - Display name of the list
   * @returns {Promise<boolean>} True if handle is in list
   */
  async isInList(handle, listName) {
    const members = await this.getMembers(listName);
    if (!members) return false;

    const normalizedHandle = handle.replace(/^@/, '').toLowerCase();
    return members.has(normalizedHandle);
  }

  /**
   * Invalidates cache for a specific list or all lists
   * @param {string} [listName] - List name to invalidate, or all if omitted
   */
  invalidate(listName = null) {
    if (listName) {
      this.cache.delete(listName.toLowerCase());
    } else {
      this.cache.clear();
      this.listNameToUri.clear();
      this.listsMetadataFetched = false;
    }
  }

  /**
   * Forces a refresh of a list's members
   * @param {string} listName - List name to refresh
   * @returns {Promise<Set<string>|null>} Refreshed member set
   */
  async refresh(listName) {
    this.invalidate(listName);
    return this.getMembers(listName);
  }

  /**
   * Gets the URI for a list by name
   * @param {string} listName - Display name of the list
   * @returns {Promise<string|null>} List URI or null
   */
  async getListUri(listName) {
    await this.ensureListsMetadata();
    return this.listNameToUri.get(listName.toLowerCase()) || null;
  }

  /**
   * Gets all known list names
   * @returns {Promise<string[]>} Array of list names
   */
  async getListNames() {
    await this.ensureListsMetadata();
    return Array.from(this.listNameToUri.keys());
  }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/ListCache.js
git commit -m "feat: add ListCache class for caching list members"
```

---

## Task 3: Extend Rules Parser for List Type

**Files:**
- Modify: `src/main.js` (parseRulesConfig function, around line 205)
- Modify: `src/handlers/ItemHandler.js` (parseRulesForState function, around line 4121)

**Step 1: Update parseRulesConfig in main.js**

Find the rule parsing section (around line 223-240) and update to handle list rules:

```javascript
// Match explicit allow/deny rules (including include and list types)
const ruleMatch = line.match(/(allow|deny) (all|from|content|include|list) "?([^"]+)"?/);
if (ruleMatch) {
  const [_, action, type, value] = ruleMatch;
  rules[rulesName].push({ action, type, value });
  continue;
}

// **Shortcut Parsing**
if (line.startsWith('$')) {
  // Interpret "$category" as "allow include category"
  rules[rulesName].push({ action: 'allow', type: 'include', value: line.substring(1) });
} else if (line.startsWith('&')) {
  // Interpret "&listname" or '&"list name"' as "allow list listname"
  const listMatch = line.match(/^&"?([^"]+)"?$/);
  if (listMatch) {
    rules[rulesName].push({ action: 'allow', type: 'list', value: listMatch[1] });
  }
} else if (line.startsWith('@')) {
  // Interpret "@foo" as "allow author 'foo'"
  rules[rulesName].push({ action: 'allow', type: 'from', value: line });
} else {
  // Any other string is interpreted as "allow content 'foobar'"
  rules[rulesName].push({ action: 'allow', type: 'content', value: line });
}
```

**Step 2: Update parseRulesForState in ItemHandler.js**

Apply the same changes to the duplicate parser (around line 4141-4154):

```javascript
// Match explicit allow/deny rules (including include and list types)
const ruleMatch = line.match(/(allow|deny) (all|from|content|include|list) "?([^"]+)"?/);
if (ruleMatch) {
  const [_, action, type, value] = ruleMatch;
  rules[rulesName].push({ action, type, value });
  continue;
}

if (line.startsWith('$')) {
  rules[rulesName].push({ action: 'allow', type: 'include', value: line.substring(1) });
} else if (line.startsWith('&')) {
  // Interpret "&listname" or '&"list name"' as "allow list listname"
  const listMatch = line.match(/^&"?([^"]+)"?$/);
  if (listMatch) {
    rules[rulesName].push({ action: 'allow', type: 'list', value: listMatch[1] });
  }
} else if (line.startsWith('@')) {
  rules[rulesName].push({ action: 'allow', type: 'from', value: line });
} else {
  rules[rulesName].push({ action: 'allow', type: 'content', value: line });
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main.js src/handlers/ItemHandler.js
git commit -m "feat: extend rules parser to support list type"
```

---

## Task 4: Initialize ListCache in Main

**Files:**
- Modify: `src/main.js`

**Step 1: Import ListCache**

Add import at top of file (around line 10):

```javascript
import { ListCache } from './ListCache.js';
```

**Step 2: Create listCache instance**

In the `onStateInit` function (around line 830), after API is initialized, add:

```javascript
// Initialize list cache for rule filtering
let listCache = null;
if (api) {
  listCache = new ListCache(api);
}

// Store in state for access by handlers
state.listCache = listCache;
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: initialize ListCache in main when API is available"
```

---

## Task 5: Implement List Rule Evaluation in Filter

**Files:**
- Modify: `src/handlers/FeedItemHandler.js`

**Step 1: Update evaluateFilterRule to handle list type**

Find the `evaluateFilterRule` method (around line 1533) and add list rule handling.

First, find where `$` rules (category rules) are evaluated. Add similar handling for list rules after it:

```javascript
// Handle list rules - check if author is in the specified list
if (rule.matchType === '&' || (configRule && configRule.type === 'list')) {
  const listName = rule.query || configRule?.value;
  const listCache = this.state.listCache;

  if (!listCache) {
    console.warn('List rules require AT Protocol agent to be configured');
    return rule.invert ? true : false; // Skip rule if no cache
  }

  // Get author handle from item
  const authorHandle = this.getAuthorHandle(item);
  if (!authorHandle) {
    return rule.invert ? true : false;
  }

  // Check list membership (async - need to handle this)
  // For now, use cached result if available, otherwise skip
  // Full async implementation in Task 6
  const isInList = listCache.isInListSync?.(authorHandle, listName);
  if (isInList === undefined) {
    // Not cached yet - trigger async fetch for next time
    listCache.getMembers(listName);
    return rule.invert ? true : false; // Default to not matching until cached
  }

  allowed = isInList;
}
```

**Step 2: Add getAuthorHandle helper method**

Add this method to FeedItemHandler class:

```javascript
/**
 * Extracts the author handle from a feed item
 * @param {Element} item - The feed item element
 * @returns {string|null} Author handle or null
 */
getAuthorHandle(item) {
  // Try data-testid first (feedItem-by-handle.domain)
  const testId = $(item).attr('data-testid') || '';
  const handleMatch = testId.match(/feedItem-by-(.+)$/);
  if (handleMatch) {
    return handleMatch[1];
  }

  // Fallback to profile link
  const profileLink = $(item).find('a[href^="/profile/"]').first();
  if (profileLink.length) {
    const href = profileLink.attr('href');
    const match = href.match(/\/profile\/([^/]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}
```

**Step 3: Add isInListSync to ListCache**

Add to ListCache.js:

```javascript
/**
 * Synchronously checks if a handle is in a list (from cache only)
 * @param {string} handle - Handle to check
 * @param {string} listName - List name
 * @returns {boolean|undefined} True/false if cached, undefined if not cached
 */
isInListSync(handle, listName) {
  const normalizedName = listName.toLowerCase();
  const cached = this.cache.get(normalizedName);

  if (!cached || (Date.now() - cached.fetchedAt) >= this.cacheDurationMs) {
    return undefined; // Not cached or expired
  }

  const normalizedHandle = handle.replace(/^@/, '').toLowerCase();
  return cached.members.has(normalizedHandle);
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/handlers/FeedItemHandler.js src/ListCache.js
git commit -m "feat: implement list rule evaluation in filter"
```

---

## Task 6: Add List Rule to Visual Editor

**Files:**
- Modify: `src/components/ConfigModal.js`

**Step 1: Update rule type options in visual editor**

Find where rule types are defined for the dropdown (search for `from`, `content`, `include`). Add `list` option:

```javascript
const ruleTypes = [
  { value: 'from', label: 'Author (@handle)' },
  { value: 'content', label: 'Content (phrase)' },
  { value: 'include', label: 'Include ($category)' },
  { value: 'list', label: 'List (&name)' },
];
```

**Step 2: Update serializeRules to handle list type**

Find the `serializeRules` method and add list type handling:

```javascript
case 'list':
  lines.push(`${rule.action} list "${rule.value}"`);
  break;
```

**Step 3: Update parseRules to handle list type**

Find the `parseRules` method and ensure it handles list rules (should already work with the main parser changes, but verify).

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/ConfigModal.js
git commit -m "feat: add list rule type to visual editor"
```

---

## Task 7: Add Sync UI to ConfigModal

**Files:**
- Modify: `src/components/ConfigModal.js`
- Modify: `src/assets/css/style.css`

**Step 1: Add sync button to category headers**

In the `renderVisualEditor` method, add a sync button after each category name:

```javascript
<div class="rules-category-header">
  <span class="rules-category-name">${this.escapeHtml(category)}</span>
  <button class="rules-sync-btn" data-category="${this.escapeHtml(category)}"
          title="Sync with Bluesky list" ${!this.hasApiAccess() ? 'disabled' : ''}>
    ⟳
  </button>
  <!-- existing delete button -->
</div>
```

**Step 2: Add hasApiAccess helper**

```javascript
/**
 * Checks if AT Protocol API is available
 */
hasApiAccess() {
  return !!(window.blueskyNavigatorState?.listCache?.api);
}
```

**Step 3: Add sync button click handler**

In the event setup section:

```javascript
// Sync button click - show sync menu
this.modalEl.querySelectorAll('.rules-sync-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const category = btn.dataset.category;
    this.showSyncMenu(btn, category);
  });
});
```

**Step 4: Add showSyncMenu method**

```javascript
/**
 * Shows the sync options menu
 */
showSyncMenu(anchorEl, category) {
  // Remove any existing menu
  this.modalEl.querySelectorAll('.rules-sync-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'rules-sync-menu';
  menu.innerHTML = `
    <button class="sync-menu-item" data-action="push">Push to List...</button>
    <button class="sync-menu-item" data-action="pull">Pull from List...</button>
    <button class="sync-menu-item" data-action="bidirectional">Bidirectional Sync...</button>
  `;

  // Position near button
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + 5}px`;
  menu.style.left = `${rect.left}px`;

  menu.querySelectorAll('.sync-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      menu.remove();
      this.showSyncDialog(category, item.dataset.action);
    });
  });

  // Close on click outside
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);

  this.modalEl.querySelector('.config-modal-body').appendChild(menu);
}
```

**Step 5: Add CSS for sync UI**

Add to style.css:

```css
/* Rules sync UI */
.rules-sync-btn {
  background: none;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 8px;
}

.rules-sync-btn:hover:not(:disabled) {
  background: var(--hover-bg, #f0f0f0);
}

.rules-sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rules-sync-menu {
  background: var(--background-color, white);
  border: 1px solid var(--border-color, #ccc);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10001;
  min-width: 180px;
}

.sync-menu-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
}

.sync-menu-item:hover {
  background: var(--hover-bg, #f0f0f0);
}

.sync-menu-item:first-child {
  border-radius: 8px 8px 0 0;
}

.sync-menu-item:last-child {
  border-radius: 0 0 8px 8px;
}
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add src/components/ConfigModal.js src/assets/css/style.css
git commit -m "feat: add sync button and menu to rules categories"
```

---

## Task 8: Implement Sync Dialogs

**Files:**
- Modify: `src/components/ConfigModal.js`

**Step 1: Add showSyncDialog method**

```javascript
/**
 * Shows the sync dialog for a category
 */
async showSyncDialog(category, action) {
  const listCache = window.blueskyNavigatorState?.listCache;
  if (!listCache) {
    alert('AT Protocol agent not configured. Please set up your app password in settings.');
    return;
  }

  // Get available lists
  const listNames = await listCache.getListNames();

  // Get handles from this category's rules
  const categoryRules = this.parsedRules[category] || [];
  const handles = categoryRules
    .filter(r => r.type === 'from' && r.value.startsWith('@'))
    .map(r => r.value.replace(/^@/, ''));

  const dialog = document.createElement('div');
  dialog.className = 'sync-dialog-overlay';

  if (action === 'push') {
    dialog.innerHTML = this.renderPushDialog(category, listNames, handles);
  } else if (action === 'pull') {
    dialog.innerHTML = this.renderPullDialog(category, listNames);
  } else {
    dialog.innerHTML = this.renderBidirectionalDialog(category, listNames, handles);
  }

  this.setupSyncDialogEvents(dialog, category, action, listCache);
  document.body.appendChild(dialog);
}
```

**Step 2: Add renderPushDialog method**

```javascript
renderPushDialog(category, listNames, handles) {
  const listOptions = listNames.map(name =>
    `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`
  ).join('');

  return `
    <div class="sync-dialog">
      <div class="sync-dialog-header">
        <h3>Push "${this.escapeHtml(category)}" to Bluesky List</h3>
        <button class="sync-dialog-close">&times;</button>
      </div>
      <div class="sync-dialog-body">
        <div class="sync-option">
          <label>
            <input type="radio" name="listChoice" value="new" checked>
            Create new list:
          </label>
          <input type="text" class="sync-new-list-name" placeholder="List name">
        </div>
        <div class="sync-option">
          <label>
            <input type="radio" name="listChoice" value="existing">
            Existing list:
          </label>
          <select class="sync-existing-list">
            <option value="">Select a list...</option>
            ${listOptions}
          </select>
        </div>
        <div class="sync-preview">
          <strong>${handles.length}</strong> handles will be synced
        </div>
      </div>
      <div class="sync-dialog-footer">
        <button class="sync-cancel">Cancel</button>
        <button class="sync-confirm" data-action="push">Push to List</button>
      </div>
    </div>
  `;
}
```

**Step 3: Add renderPullDialog method**

```javascript
renderPullDialog(category, listNames) {
  const listOptions = listNames.map(name =>
    `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`
  ).join('');

  return `
    <div class="sync-dialog">
      <div class="sync-dialog-header">
        <h3>Pull from Bluesky List to "${this.escapeHtml(category)}"</h3>
        <button class="sync-dialog-close">&times;</button>
      </div>
      <div class="sync-dialog-body">
        <div class="sync-option">
          <label>Select source list:</label>
          <select class="sync-existing-list">
            <option value="">Select a list...</option>
            ${listOptions}
          </select>
        </div>
        <div class="sync-option">
          <label>
            <input type="radio" name="ruleAction" value="allow" checked> Add as: allow from @handle
          </label>
          <label>
            <input type="radio" name="ruleAction" value="deny"> Add as: deny from @handle
          </label>
        </div>
        <div class="sync-preview"></div>
      </div>
      <div class="sync-dialog-footer">
        <button class="sync-cancel">Cancel</button>
        <button class="sync-confirm" data-action="pull">Import Handles</button>
      </div>
    </div>
  `;
}
```

**Step 4: Add setupSyncDialogEvents method**

```javascript
setupSyncDialogEvents(dialog, category, action, listCache) {
  // Close button
  dialog.querySelector('.sync-dialog-close').addEventListener('click', () => dialog.remove());
  dialog.querySelector('.sync-cancel').addEventListener('click', () => dialog.remove());

  // Click outside to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });

  // Preview updates for pull
  if (action === 'pull') {
    const select = dialog.querySelector('.sync-existing-list');
    select.addEventListener('change', async () => {
      const listName = select.value;
      if (!listName) return;

      const members = await listCache.getMembers(listName);
      const existingHandles = new Set(
        (this.parsedRules[category] || [])
          .filter(r => r.type === 'from')
          .map(r => r.value.replace(/^@/, '').toLowerCase())
      );

      const newHandles = members ? [...members].filter(h => !existingHandles.has(h)) : [];
      dialog.querySelector('.sync-preview').innerHTML =
        `<strong>${newHandles.length}</strong> new handles will be added`;
    });
  }

  // Confirm button
  dialog.querySelector('.sync-confirm').addEventListener('click', async () => {
    await this.executeSyncAction(dialog, category, action, listCache);
  });
}
```

**Step 5: Add executeSyncAction method**

```javascript
async executeSyncAction(dialog, category, action, listCache) {
  const confirmBtn = dialog.querySelector('.sync-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Syncing...';

  try {
    if (action === 'push') {
      await this.executePushSync(dialog, category, listCache);
    } else if (action === 'pull') {
      await this.executePullSync(dialog, category, listCache);
    } else {
      await this.executePushSync(dialog, category, listCache);
      await this.executePullSync(dialog, category, listCache);
    }

    dialog.remove();
    this.showSyncSuccess('Sync completed successfully');
  } catch (error) {
    console.error('Sync failed:', error);
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Retry';
    alert(`Sync failed: ${error.message}`);
  }
}
```

**Step 6: Add CSS for sync dialog**

Add to style.css:

```css
.sync-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10002;
}

.sync-dialog {
  background: var(--background-color, white);
  border-radius: 12px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.sync-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.sync-dialog-header h3 {
  margin: 0;
  font-size: 16px;
}

.sync-dialog-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.sync-dialog-body {
  padding: 20px;
}

.sync-option {
  margin-bottom: 16px;
}

.sync-option label {
  display: block;
  margin-bottom: 8px;
}

.sync-option input[type="text"],
.sync-option select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  font-size: 14px;
}

.sync-preview {
  padding: 12px;
  background: var(--hover-bg, #f5f5f5);
  border-radius: 6px;
  font-size: 14px;
}

.sync-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #eee);
}

.sync-cancel,
.sync-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.sync-cancel {
  background: none;
  border: 1px solid var(--border-color, #ccc);
}

.sync-confirm {
  background: var(--accent-color, #0085ff);
  color: white;
  border: none;
}

.sync-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

**Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/components/ConfigModal.js src/assets/css/style.css
git commit -m "feat: implement sync dialogs for push/pull operations"
```

---

## Task 9: Implement Push Sync Logic

**Files:**
- Modify: `src/components/ConfigModal.js`

**Step 1: Add executePushSync method**

```javascript
async executePushSync(dialog, category, listCache) {
  const api = listCache.api;
  const isNewList = dialog.querySelector('input[name="listChoice"][value="new"]').checked;

  let listUri;
  let listName;

  if (isNewList) {
    listName = dialog.querySelector('.sync-new-list-name').value.trim();
    if (!listName) throw new Error('Please enter a list name');
    listUri = await api.createList(listName);
  } else {
    listName = dialog.querySelector('.sync-existing-list').value;
    if (!listName) throw new Error('Please select a list');
    listUri = await listCache.getListUri(listName);
  }

  // Get existing list members
  const existingMembers = await api.getListMembers(listUri);
  const existingDids = new Set(existingMembers.map(m => m.did));

  // Get handles from rules
  const categoryRules = this.parsedRules[category] || [];
  const handles = categoryRules
    .filter(r => r.type === 'from' && r.value.startsWith('@'))
    .map(r => r.value.replace(/^@/, ''));

  // Add each handle to list if not already present
  let added = 0;
  for (const handle of handles) {
    const did = await api.resolveHandleToDid(handle);
    if (did && !existingDids.has(did)) {
      await api.addToList(listUri, did);
      added++;
    }
  }

  // Invalidate cache
  listCache.invalidate(listName);

  console.log(`Push sync: added ${added} members to ${listName}`);
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/ConfigModal.js
git commit -m "feat: implement push sync logic"
```

---

## Task 10: Implement Pull Sync Logic

**Files:**
- Modify: `src/components/ConfigModal.js`

**Step 1: Add executePullSync method**

```javascript
async executePullSync(dialog, category, listCache) {
  const listName = dialog.querySelector('.sync-existing-list').value;
  if (!listName) throw new Error('Please select a list');

  const ruleAction = dialog.querySelector('input[name="ruleAction"]:checked')?.value || 'allow';

  // Get list members
  const members = await listCache.getMembers(listName);
  if (!members || members.size === 0) {
    throw new Error('List is empty or could not be fetched');
  }

  // Get existing handles in category
  const existingHandles = new Set(
    (this.parsedRules[category] || [])
      .filter(r => r.type === 'from')
      .map(r => r.value.replace(/^@/, '').toLowerCase())
  );

  // Add new handles to rules
  let added = 0;
  for (const handle of members) {
    if (!existingHandles.has(handle.toLowerCase())) {
      if (!this.parsedRules[category]) {
        this.parsedRules[category] = [];
      }
      this.parsedRules[category].push({
        action: ruleAction,
        type: 'from',
        value: `@${handle}`,
      });
      added++;
    }
  }

  // Update UI and save
  this.syncRulesToRaw();
  this.refreshVisualEditor();

  console.log(`Pull sync: added ${added} handles to ${category}`);
}
```

**Step 2: Add showSyncSuccess helper**

```javascript
showSyncSuccess(message) {
  // Create toast notification
  const toast = document.createElement('div');
  toast.className = 'sync-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('sync-toast-hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
```

**Step 3: Add toast CSS**

Add to style.css:

```css
.sync-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  z-index: 10003;
  animation: syncToastIn 0.3s ease;
}

.sync-toast-hiding {
  animation: syncToastOut 0.3s ease forwards;
}

@keyframes syncToastIn {
  from { opacity: 0; transform: translateX(-50%) translateY(20px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes syncToastOut {
  from { opacity: 1; transform: translateX(-50%) translateY(0); }
  to { opacity: 0; transform: translateX(-50%) translateY(20px); }
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/ConfigModal.js src/assets/css/style.css
git commit -m "feat: implement pull sync logic"
```

---

## Task 11: Update Documentation

**Files:**
- Modify: `README.md`

**Step 1: Add List Rules section to README**

Add after the existing Dynamic Post Filtering section:

```markdown
### List-Based Filtering

Filter posts based on Bluesky list membership:

```ini
[favorites]
allow from list "My Favorites"      # show posts from list members
deny from list "Muted"              # hide posts from list members
&"Close Friends"                    # shorthand for: allow from list

[combined]
$favorites                          # include the favorites category
allow from @special.bsky.social    # plus individual authors
```

**Syncing with Lists:**

The Rules tab includes sync buttons next to each category. Use these to:
- **Push to List**: Export all `@handle` rules to a Bluesky list
- **Pull from List**: Import list members as rules
- **Bidirectional**: Sync both directions (additive only)

Note: List-based filtering requires the AT Protocol agent to be configured.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add list-based filtering documentation"
```

---

## Task 12: Final Integration Test

**Step 1: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Manual testing checklist**

1. Open extension preferences (Alt+.)
2. Go to Rules tab
3. Verify sync button appears next to category names
4. Click sync button - menu should appear
5. Test "Pull from List" with an existing list
6. Verify handles are added to rules
7. Test filtering with `&"List Name"` syntax
8. Verify posts from list members are shown/hidden

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete list-rules sync feature implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add list API methods | api.js |
| 2 | Create ListCache class | ListCache.js |
| 3 | Extend rules parser | main.js, ItemHandler.js |
| 4 | Initialize ListCache | main.js |
| 5 | Implement list rule evaluation | FeedItemHandler.js, ListCache.js |
| 6 | Add list to visual editor | ConfigModal.js |
| 7 | Add sync UI | ConfigModal.js, style.css |
| 8 | Implement sync dialogs | ConfigModal.js, style.css |
| 9 | Implement push sync | ConfigModal.js |
| 10 | Implement pull sync | ConfigModal.js, style.css |
| 11 | Update documentation | README.md |
| 12 | Final integration test | - |
