import { BskyAgent } from '@atproto/api';

export class BlueskyAPI {
  constructor(service = 'https://bsky.social', identifier, password) {
    this.service = service;
    this.identifier = identifier;
    this.password = password;
    this.agent = new BskyAgent({ service: this.service });
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
    const params = { limit };
    if (cursor) {
      params.cursor = cursor;
    }
    const { data } = await this.agent.getTimeline(params);
    return data;
  }

  /**
   * Fetches timeline and extracts repost timestamps.
   * Returns a map of post ID -> repost timestamp (indexedAt from reason)
   * Post ID is extracted from the URI (last segment after app.bsky.feed.post/)
   */
  async getRepostTimestamps(cursor = null, limit = 100) {
    const data = await this.getTimeline(cursor, limit);
    const repostTimestamps = {};

    for (const item of data.feed) {
      // Check if this is a repost (has reason with $type containing 'repost')
      if (item.reason && item.reason.$type?.includes('reasonRepost')) {
        const postUri = item.post.uri;
        const repostTime = item.reason.indexedAt;
        if (postUri && repostTime) {
          // Extract post ID from URI: at://did:plc:xxx/app.bsky.feed.post/POST_ID
          const postId = postUri.split('/').pop();
          repostTimestamps[postId] = new Date(repostTime);
        }
      }
    }

    return {
      timestamps: repostTimestamps,
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
    const res = await this.agent.getPostThread({ uri: uri });
    const { thread } = res.data;
    return thread;
  }

  /**
   * Fetches a user's profile by handle or DID
   * @param {string} actor - Handle (e.g., "alice.bsky.social") or DID
   * @returns {Promise<Object>} Profile data including displayName, description, avatar, followersCount, etc.
   */
  async getProfile(actor) {
    const { data } = await this.agent.getProfile({ actor });
    return data;
  }

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
  }

  /**
   * Mark notifications as seen up to the current time
   */
  async markNotificationsSeen() {
    await this.agent.updateSeenNotifications({ seenAt: new Date().toISOString() });
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
