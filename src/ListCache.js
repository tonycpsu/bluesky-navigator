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
   * Normalizes a handle by adding .bsky.social suffix if missing
   * @param {string} handle - Handle to normalize
   * @returns {string} Normalized handle
   * @private
   */
  normalizeHandle(handle) {
    let normalized = handle.replace(/^@/, '').toLowerCase();
    // Add .bsky.social suffix for short handles without a domain
    if (!normalized.includes('.')) {
      normalized = `${normalized}.bsky.social`;
    }
    return normalized;
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

    const normalizedHandle = this.normalizeHandle(handle);
    return members.has(normalizedHandle);
  }

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

    const normalizedHandle = this.normalizeHandle(handle);
    return cached.members.has(normalizedHandle);
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
