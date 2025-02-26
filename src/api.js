import { BskyAgent } from '@atproto/api';

export class BlueskyAPI {

    constructor(service = 'https://bsky.social', identifier, password) {
        this.service = service;
        this.identifier = identifier;
        this.password = password;
        this.agent = new BskyAgent({service: this.service});
    }

    async login() {
        return this.agent.login({
            identifier: this.identifier,
            password: this.password
        })
    }

    async getPost(uri) {
        const res = await this.agent.getPostThread({uri: 'at://...'})
    }

    async getTimeline() {
        const { data } = await this.agent.getTimeline({
            // cursor: '',
            limit: 30
        });
        console.log(data);
        // debugger;
    }

    async getAtprotoUri(postUrl) {
        // debugger;
        // Parse the URL to extract the handle and post ID
        const match = postUrl.match(/bsky\.app\/profile\/([^\/]+)\/post\/([^\/]+)/);
        if (!match) {
            console.error("Invalid Bluesky post URL format.");
            debugger;
            return null;
        }

        const handle = match[1]; // The user's handle (e.g., "alice.bsky.social")
        const postId = match[2]; // The post ID (e.g., "xyz123")

        if(handle.startsWith("did:")) {
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
            console.error("Failed to resolve handle:", error);
            return null;
        }
    }

    async getThread(uri) {
        const res = await this.agent.getPostThread({uri: uri});
        const { thread } = res.data;
        return thread;
    }

    async getReplies(uri) {
        const thread = this.getThread(uri);
        return thread.replies.map(
            (i, reply) => {
                return reply.post.record.text;
            }
        )
    }

    async unrollThread(thread) {

        const originalAuthor = thread.post.author.did;

        async function collectPosts(threadNode, posts = []) {
            if(!threadNode.post) {
                return [];
            }
            if (threadNode.post.author.did === originalAuthor) {
                posts.push(threadNode.post);
            }
            if(threadNode.post.replyCount && !threadNode.replies) {
                threadNode.replies = (await this.getThread(threadNode.post.uri)).replies;
            }
            if (threadNode.replies) {
                for (const reply of threadNode.replies) {
                    await collectPosts(reply, posts);
                }
            }
            return posts;
        }
        collectPosts = collectPosts.bind(this);

        const allPosts = await collectPosts(thread);
        // allPosts.sort((a, b) => new Date(a.indexedAt) - new Date(b.indexedAt));
        console.log(allPosts.length);
        return allPosts;
    }

}
