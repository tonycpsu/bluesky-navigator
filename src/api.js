import { BskyAgent } from '@atproto/api';

export class BlueskyAPI {
  constructor(service = 'https://bsky.social', identifier, password) {
    this.service = service;
    this.identifier = identifier;
    this.password = password;
    this.agent = new BskyAgent({ service: this.service });

    // Rate limit tracking
    this.rateLimitedAt = null;
    this.rateLimitCooldownMs = 60 * 1000; // 1 minute cooldown after 429
  }

  /**
   * Check if we're currently rate limited
   * @returns {boolean} True if in rate limit cooldown period
   */
  isRateLimited() {
    if (!this.rateLimitedAt) return false;
    const elapsed = Date.now() - this.rateLimitedAt;
    if (elapsed >= this.rateLimitCooldownMs) {
      this.rateLimitedAt = null; // Cooldown expired
      return false;
    }
    return true;
  }

  /**
   * Get remaining cooldown time in seconds
   * @returns {number} Seconds until rate limit expires, or 0 if not limited
   */
  getRateLimitRemaining() {
    if (!this.rateLimitedAt) return 0;
    const remaining = this.rateLimitCooldownMs - (Date.now() - this.rateLimitedAt);
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  /**
   * Handle API errors, detecting rate limits
   * @param {Error} error - The error to check
   * @throws {Error} Re-throws the error after handling
   */
  handleApiError(error) {
    // Check for rate limit (429) - check status and message
    const isRateLimit = error.status === 429 ||
      error.message?.includes('429') ||
      error.message?.toLowerCase().includes('rate limit') ||
      error.error?.includes('RateLimitExceeded');

    if (isRateLimit) {
      this.rateLimitedAt = Date.now();
      const cooldownSecs = Math.ceil(this.rateLimitCooldownMs / 1000);
      console.warn(`API rate limited (429). Cooling down for ${cooldownSecs} seconds.`);
    }

    throw error;
  }

  /**
   * Check rate limit before making a request
   * @throws {Error} If currently rate limited
   */
  checkRateLimit() {
    if (this.isRateLimited()) {
      const remaining = this.getRateLimitRemaining();
      const error = new Error(`Rate limited. Please wait ${remaining} seconds.`);
      error.status = 429;
      error.isRateLimitCooldown = true;
      throw error;
    }
  }

  async login() {
    return this.agent.login({
      identifier: this.identifier,
      password: this.password,
    });
  }

  async getPost(_uri) {
    // TODO: implement this method
    const _res = await this.agent.getPostThread({ uri: 'at://...' });
  }

  async getTimeline(cursor = null, limit = 100) {
    this.checkRateLimit();

    try {
      const params = { limit };
      if (cursor) {
        params.cursor = cursor;
      }
      const { data } = await this.agent.getTimeline(params);
      return data;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Fetches timeline and extracts repost timestamps.
   * Returns a map of post ID -> repost timestamp (indexedAt from reason)
   * Post ID is extracted from the URI (last segment after app.bsky.feed.post/)
   */
  async getRepostTimestamps(cursor = null, limit = 100) {
    const data = await this.getTimeline(cursor, limit);
    const repostTimestamps = {};
    const reposterProfiles = {};

    for (const item of data.feed) {
      // Check if this is a repost (has reason with $type containing 'repost')
      if (item.reason && item.reason.$type?.includes('reasonRepost')) {
        const postUri = item.post.uri;
        const repostTime = item.reason.indexedAt;
        if (postUri && repostTime) {
          // Extract post ID from URI: at://did:plc:xxx/app.bsky.feed.post/POST_ID
          const postId = postUri.split('/').pop();
          repostTimestamps[postId] = new Date(repostTime);

          // Extract reposter profile info (including avatar)
          if (item.reason.by) {
            reposterProfiles[postId] = {
              handle: item.reason.by.handle,
              displayName: item.reason.by.displayName,
              avatar: item.reason.by.avatar,
            };
          }
        }
      }
    }

    return {
      timestamps: repostTimestamps,
      reposterProfiles: reposterProfiles,
      cursor: data.cursor,
    };
  }

  async getAtprotoUri(postUrl) {
    // debugger;
    // Parse the URL to extract the handle and post ID
    const match = postUrl.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/]+)/);
    if (!match) {
      console.error('Invalid Bluesky post URL format.');
      return null;
    }

    const handle = match[1]; // The user's handle (e.g., "alice.bsky.social")
    const postId = match[2]; // The post ID (e.g., "xyz123")

    if (handle.startsWith('did:')) {
      return null;
    }
    try {
      // Resolve the handle to a DID
      const { data } = await this.agent.resolveHandle({ handle });
      const did = data.did; // Extract the DID

      // Construct the atproto URI
      const atprotoUri = `at://${did}/app.bsky.feed.post/${postId}`;
      return atprotoUri;
    } catch (error) {
      console.error('Failed to resolve handle:', error);
      return null;
    }
  }

  async getThread(uri) {
    this.checkRateLimit();

    try {
      const res = await this.agent.getPostThread({ uri: uri });
      const { thread } = res.data;
      return thread;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Fetches a user's profile by handle or DID
   * @param {string} actor - Handle (e.g., "alice.bsky.social") or DID
   * @returns {Promise<Object>} Profile data including displayName, description, avatar, followersCount, etc.
   */
  async getProfile(actor) {
    this.checkRateLimit();

    try {
      const { data } = await this.agent.getProfile({ actor });
      return data;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Fetches all lists owned by an actor
   * @param {string} actor - Handle or DID (defaults to logged-in user)
   * @returns {Promise<Array>} Array of list objects with uri, name, purpose
   */
  async getLists(actor = null) {
    this.checkRateLimit();

    const params = { actor: actor || this.agent.session?.did, limit: 100 };
    const lists = [];
    let cursor = null;

    try {
      do {
        if (cursor) params.cursor = cursor;
        const { data } = await this.agent.app.bsky.graph.getLists(params);
        lists.push(...data.lists);
        cursor = data.cursor;
      } while (cursor);

      return lists;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Fetches all members of a list
   * @param {string} listUri - AT URI of the list
   * @returns {Promise<Array>} Array of member objects with did, handle, uri (listitem record URI)
   */
  async getListMembers(listUri) {
    this.checkRateLimit();

    const params = { list: listUri, limit: 100 };
    const members = [];
    let cursor = null;

    try {
      do {
        if (cursor) params.cursor = cursor;
        const { data } = await this.agent.app.bsky.graph.getList(params);
        members.push(...data.items.map(item => ({
          did: item.subject.did,
          handle: item.subject.handle,
          uri: item.uri, // listitem record URI for deletion
        })));
        cursor = data.cursor;
      } while (cursor);

      return members;
    } catch (error) {
      this.handleApiError(error);
    }
  }

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

  /**
   * Removes a user from a list
   * @param {string} listitemUri - AT URI of the listitem record to delete
   * @returns {Promise<void>}
   */
  async removeFromList(listitemUri) {
    // Parse the URI to extract repo and rkey
    // Format: at://did:plc:xxx/app.bsky.graph.listitem/rkey
    const match = listitemUri.match(/at:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid listitem URI: ${listitemUri}`);
    }
    const [, repo, collection, rkey] = match;

    await this.agent.com.atproto.repo.deleteRecord({
      repo,
      collection,
      rkey,
    });
  }

  /**
   * Resolves a handle to a DID
   * @param {string} handle - User handle (with or without @)
   * @returns {Promise<string|null>} DID or null if not found
   */
  async resolveHandleToDid(handle) {
    this.checkRateLimit();

    let cleanHandle = handle.replace(/^@/, '');
    // Add .bsky.social suffix for short handles without a domain
    if (!cleanHandle.includes('.')) {
      cleanHandle = `${cleanHandle}.bsky.social`;
    }
    try {
      const { data } = await this.agent.resolveHandle({ handle: cleanHandle });
      return data.did;
    } catch (error) {
      // Let rate limit errors propagate
      if (error.status === 429 || error.isRateLimitCooldown) {
        this.handleApiError(error);
      }
      console.warn(`Failed to resolve handle ${cleanHandle}:`, error);
      return null;
    }
  }

  async getReplies(uri) {
    const thread = this.getThread(uri);
    return thread.replies.map((i, reply) => {
      return reply.post.record.text;
    });
  }

  /**
   * Fetches notifications from the API
   * @param {number} limit - Maximum number of notifications to fetch
   * @param {string} cursor - Pagination cursor
   * @returns {Promise<{notifications: Array, cursor: string, seenAt: string}>}
   */
  async getNotifications(limit = 20, cursor = null) {
    this.checkRateLimit();

    try {
      const params = { limit };
      if (cursor) {
        params.cursor = cursor;
      }
      const { data } = await this.agent.listNotifications(params);
      return {
        notifications: data.notifications,
        cursor: data.cursor,
        seenAt: data.seenAt,
      };
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Mark notifications as seen up to the current time
   */
  async markNotificationsSeen() {
    await this.agent.updateSeenNotifications({ seenAt: new Date().toISOString() });
  }

  /**
   * Follow a user by DID
   * @param {string} did - The DID of the user to follow
   * @returns {Promise<{uri: string, cid: string}>} The follow record info
   */
  async follow(did) {
    const { uri, cid } = await this.agent.follow(did);
    return { uri, cid };
  }

  /**
   * Unfollow a user by deleting the follow record
   * @param {string} followUri - The URI of the follow record to delete
   * @returns {Promise<void>}
   */
  async unfollow(followUri) {
    await this.agent.deleteFollow(followUri);
  }

  /**
   * Get a user's profile to check follow status
   * @param {string} actor - Handle or DID
   * @returns {Promise<{did: string, following: string|null}>} Profile with follow URI if following
   */
  async getFollowStatus(actor) {
    const profile = await this.getProfile(actor);
    return {
      did: profile.did,
      followUri: profile.viewer?.following || null,
    };
  }

  async unrollThread(thread) {
    const originalAuthor = thread.post.author.did;

    /**
     * Recursively collects all posts in a thread by the original author.
     * @param {Object} threadNode - The current thread node being processed
     * @param {string} parentAuthorDid - DID of the parent post's author
     * @param {Array} posts - Accumulated posts array
     * @returns {Promise<Array>} Array of posts by the original author
     */
    const collectPosts = async (threadNode, parentAuthorDid, posts = []) => {
      if (!threadNode.post) {
        return [];
      }
      if (threadNode.post.author.did === originalAuthor && parentAuthorDid === originalAuthor) {
        posts.push(threadNode.post);
      }
      if (threadNode.post.replyCount && !threadNode.replies) {
        threadNode.replies = (await this.getThread(threadNode.post.uri)).replies;
      }
      if (threadNode.replies) {
        for (const reply of threadNode.replies) {
          await collectPosts(reply, threadNode.post.author.did, posts);
        }
      }
      return posts;
    };

    const allPosts = await collectPosts(thread, originalAuthor);
    return allPosts;
  }
}
