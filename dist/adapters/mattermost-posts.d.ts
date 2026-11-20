export declare const MATTERMOST_POSTS_INVALID = "MATTERMOST_POSTS_INVALID";
export declare const MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY = "MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY";
/** Every seeded message starts with this, so the seed and the live check find only its own posts. */
export declare const SEED_POST_PREFIX = "p4-h7: ";
export declare const SEED_POST_COUNT = 3;
export declare const SEED_CHANNEL_NAME = "town-square";
/**
 * P4_SECOND_POSTS: "" is off, exactly "1" is on, anything else throws without echoing the value. On needs P4_SECOND_IDENTITY
 * to be on too: the posts are written by the second identity, so there is no author without it.
 */
export declare function mattermostPostsOption(postsRaw: string, identityRaw: string): boolean;
/** The fixed messages, in order: "p4-h7: post 1 of 3" and so on. */
export declare function seedPostMessages(count?: number): string[];
/** The messages still to post, given the messages already in the channel. A kept volume posts only what is missing. */
export declare function missingPostMessages(existingMessages: string[], count?: number): string[];
export interface ChannelPost {
    id: string;
    message: string;
    userId: string;
}
/** GET /api/v4/teams/name/{team}/channels/name/{channel}. Returns the channel id. */
export declare function channelByNameRequest(baseUrl: string, bearerToken: string, team: string, channel: string): {
    url: string;
    init: RequestInit;
};
/** GET /api/v4/channels/{id}/posts. A harness channel holds a few posts, so one page of 200 is enough. */
export declare function channelPostsRequest(baseUrl: string, bearerToken: string, channelId: string): {
    url: string;
    init: RequestInit;
};
/** POST /api/v4/posts. The author is the token's user; no user id is sent. */
export declare function createPostRequest(baseUrl: string, bearerToken: string, channelId: string, message: string): {
    url: string;
    init: RequestInit;
};
/** Reads the channel id from a channel-by-name reply. Throws a fixed message and never echoes the body. */
export declare function parseChannelId(body: unknown): string;
/**
 * Reads posts from a channel-posts reply: { order, posts: { [id]: { id, message, user_id } } }. Only the fields the
 * harness uses are kept. Anything malformed throws a fixed message.
 */
export declare function parseChannelPosts(body: unknown): ChannelPost[];
/** The seeded posts only (by prefix), so an unrelated post in the channel is never counted. */
export declare function seededPosts(posts: ChannelPost[]): ChannelPost[];
/** What the H7 live probe reports: counts and the second author's username. No token or message body. */
export interface SeededPostsProbe {
    product: string;
    channel: string;
    expected: number;
    found: number;
    missing: number;
    duplicates: number;
    authoredBySecond: number;
    secondAuthor: string;
}
//# sourceMappingURL=mattermost-posts.d.ts.map