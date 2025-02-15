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
        const res = await agent.getPostThread({uri: 'at://...'})
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
            return null;
        }

        const handle = match[1]; // The user's handle (e.g., "alice.bsky.social")
        const postId = match[2]; // The post ID (e.g., "xyz123")

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

    async getPost(uri) {
        const res = await this.agent.getPostThread({uri: uri});
        const { thread } = res.data;
        // console.log(thread);
        // debugger;
        return thread.post;
    }
}
