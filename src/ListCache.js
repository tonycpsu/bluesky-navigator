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

    // Map of list name -> { members: Map<handle, { uri }>, fetchedAt: Date, uri: string }
    this.cache = new Map();

    // Map of list name (lowercase) -> URI (built from getLists call)
    this.listNameToUri = new Map();

    // Map of list name (lowercase) -> original display name
    this.listDisplayNames = new Map();

    // Whether we've fetched the user's list metadata
    this.listsMetadataFetched = false;
    this.listsMetadataFetchedAt = null;

    // Track in-flight requests to avoid duplicate fetches
    this.pendingMetadataFetch = null;
    this.pendingMemberFetches = new Map(); // list name -> Promise

    // Track auth failures to avoid repeated retries
    this.authFailedAt = null;
    this.authFailureCooldownMs = 60 * 1000; // Wait 1 minute before retrying after auth failure
  }

  /**
   * Ensures list metadata (name -> URI mapping) is loaded
   * @param {boolean} forceRefresh - Force refresh even if cached
   * @private
   */
  async ensureListsMetadata(forceRefresh = false) {
    if (!this.api) return;

    // Ensure API is logged in before making requests
    if (!this.api.agent?.session) {
      try {
        await this.api.login();
      } catch (error) {
        this.authFailedAt = Date.now();
        console.warn('List cache: Login failed, will retry in 1 minute');
        return;
      }
    }

    // Check if we're in auth failure cooldown
    if (this.authFailedAt && (Date.now() - this.authFailedAt) < this.authFailureCooldownMs) {
      return; // Don't retry during cooldown
    }

    // If force refresh and there's a pending fetch, wait for it first
    if (forceRefresh && this.pendingMetadataFetch) {
      await this.pendingMetadataFetch;
    }

    // Check if cache is still valid (5 minute expiry for metadata)
    const metadataCacheMs = 5 * 60 * 1000;
    const cacheExpired = this.listsMetadataFetchedAt &&
      (Date.now() - this.listsMetadataFetchedAt) >= metadataCacheMs;

    if (this.listsMetadataFetched && !forceRefresh && !cacheExpired) {
      return;
    }

    // Reuse pending fetch if one is in progress (non-force case)
    if (this.pendingMetadataFetch) {
      return this.pendingMetadataFetch;
    }

    this.pendingMetadataFetch = (async () => {
      try {
        const lists = await this.api.getLists();
        // Only clear and repopulate after successful fetch
        const newNameToUri = new Map();
        const newDisplayNames = new Map();
        for (const list of lists) {
          const normalizedName = list.name.toLowerCase();
          newNameToUri.set(normalizedName, list.uri);
          newDisplayNames.set(normalizedName, list.name);
        }
        // Swap in the new data atomically
        this.listNameToUri = newNameToUri;
        this.listDisplayNames = newDisplayNames;
        this.listsMetadataFetched = true;
        this.listsMetadataFetchedAt = Date.now();
        this.authFailedAt = null; // Clear auth failure on success
      } catch (error) {
        // Check if this is an auth error
        const isAuthError = error.message?.includes('Authentication') ||
          error.status === 401;
        if (isAuthError) {
          this.authFailedAt = Date.now();
          console.warn('List cache: Authentication failed, will retry in 1 minute');
        } else {
          console.warn('Failed to fetch lists metadata:', error);
        }
        // Keep existing data on error rather than clearing
      } finally {
        this.pendingMetadataFetch = null;
      }
    })();

    return this.pendingMetadataFetch;
  }

  /**
   * Gets the cached members for a list, fetching if needed
   * @param {string} listName - Display name of the list
   * @returns {Promise<Map<string, { uri: string }>|null>} Map of handles (lowercase) to { uri } or null if list not found
   */
  async getMembers(listName) {
    const normalizedName = listName.toLowerCase();

    // Check cache first
    const cached = this.cache.get(normalizedName);
    if (cached && (Date.now() - cached.fetchedAt) < this.cacheDurationMs) {
      return cached.members;
    }

    // Reuse pending fetch if one is in progress for this list
    if (this.pendingMemberFetches.has(normalizedName)) {
      return this.pendingMemberFetches.get(normalizedName);
    }

    // Create and track the fetch promise
    const fetchPromise = (async () => {
      try {
        // Ensure we have list metadata
        await this.ensureListsMetadata();

        // Get URI for list name
        const listUri = this.listNameToUri.get(normalizedName);
        if (!listUri) {
          // Only warn if we're not in auth failure cooldown (in which case we just don't have the data)
          if (!this.authFailedAt) {
            console.warn(`List not found: ${listName}`);
          }
          return null;
        }

        // Fetch members with their listitem URIs
        const members = await this.api.getListMembers(listUri);
        const memberMap = new Map();
        for (const m of members) {
          memberMap.set(m.handle.toLowerCase(), { uri: m.uri });
        }

        this.cache.set(normalizedName, {
          members: memberMap,
          fetchedAt: Date.now(),
          uri: listUri,
        });

        return memberMap;
      } catch (error) {
        console.warn(`Failed to fetch list members for ${listName}:`, error);
        return null;
      } finally {
        this.pendingMemberFetches.delete(normalizedName);
      }
    })();

    this.pendingMemberFetches.set(normalizedName, fetchPromise);
    return fetchPromise;
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
   * Gets the listitem URI for a handle in a list (for deletion)
   * @param {string} handle - Handle to look up
   * @param {string} listName - List name
   * @returns {Promise<string|null>} Listitem URI or null if not found
   */
  async getMemberUri(handle, listName) {
    const members = await this.getMembers(listName);
    if (!members) return null;

    const normalizedHandle = this.normalizeHandle(handle);
    const member = members.get(normalizedHandle);
    return member?.uri || null;
  }

  /**
   * Optimistically adds a handle to the cached members for a list.
   * Use after successfully adding via API to avoid waiting for eventual consistency.
   * @param {string} handle - Handle to add
   * @param {string} listName - List name
   * @param {string} [listitemUri] - Optional listitem URI (for future deletion)
   */
  addMemberToCache(handle, listName, listitemUri = null) {
    const normalizedName = listName.toLowerCase();
    const normalizedHandle = this.normalizeHandle(handle);

    let cached = this.cache.get(normalizedName);
    if (!cached) {
      // Create a new cache entry if none exists
      cached = {
        members: new Map(),
        fetchedAt: Date.now(),
        uri: null,
      };
      this.cache.set(normalizedName, cached);
    }

    cached.members.set(normalizedHandle, { uri: listitemUri });
  }

  /**
   * Optimistically removes a handle from the cached members for a list.
   * Use after successfully removing via API to avoid waiting for eventual consistency.
   * @param {string} handle - Handle to remove
   * @param {string} listName - List name
   */
  removeMemberFromCache(handle, listName) {
    const normalizedName = listName.toLowerCase();
    const normalizedHandle = this.normalizeHandle(handle);

    const cached = this.cache.get(normalizedName);
    if (cached?.members) {
      cached.members.delete(normalizedHandle);
    }
  }

  /**
   * Invalidates cache for a specific list or all lists
   * @param {string} [listName] - List name to invalidate, or all if omitted
   */
  invalidate(listName = null) {
    if (listName) {
      const normalizedName = listName.toLowerCase();
      this.cache.delete(normalizedName);
      this.pendingMemberFetches.delete(normalizedName);
    } else {
      this.cache.clear();
      this.listNameToUri.clear();
      this.listDisplayNames.clear();
      this.listsMetadataFetched = false;
      this.listsMetadataFetchedAt = null;
      this.pendingMetadataFetch = null;
      this.pendingMemberFetches.clear();
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
   * Gets all known list names (with original case)
   * @param {boolean} forceRefresh - Force refresh from API
   * @returns {Promise<string[]>} Array of list names with original case
   */
  async getListNames(forceRefresh = false) {
    await this.ensureListsMetadata(forceRefresh);
    return Array.from(this.listDisplayNames.values());
  }
}
