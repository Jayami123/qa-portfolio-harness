/**
 * H7: posts seeded by the second identity in Mattermost. `P4_SECOND_POSTS=1` (exact value; off by default) makes the
 * second member (qa-agent-b, from H2) post a fixed set of messages in town-square of the harness team. It needs
 * `P4_SECOND_IDENTITY=1`. Builders and parsers only: no I/O, so every function is unit tested.
 */
import { parseSecondIdentityFlag } from "./p4-second-identity.js";
export const MATTERMOST_POSTS_INVALID = "MATTERMOST_POSTS_INVALID";
export const MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY = "MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY";
/** Every seeded message starts with this, so the seed and the live check find only its own posts. */
export const SEED_POST_PREFIX = "p4-h7: ";
export const SEED_POST_COUNT = 3;
export const SEED_CHANNEL_NAME = "town-square";
/**
 * P4_SECOND_POSTS: "" is off, exactly "1" is on, anything else throws without echoing the value. On needs P4_SECOND_IDENTITY
 * to be on too: the posts are written by the second identity, so there is no author without it.
 */
export function mattermostPostsOption(postsRaw, identityRaw) {
    if (postsRaw === "") {
        return false;
    }
    if (postsRaw !== "1") {
        throw new Error(`${MATTERMOST_POSTS_INVALID}: P4_SECOND_POSTS must be exactly "1" or unset (value not printed)`);
    }
    if (!parseSecondIdentityFlag(identityRaw)) {
        throw new Error(`${MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY}: P4_SECOND_POSTS=1 needs P4_SECOND_IDENTITY=1`);
    }
    return true;
}
/** The fixed messages, in order: "p4-h7: post 1 of 3" and so on. */
export function seedPostMessages(count = SEED_POST_COUNT) {
    return Array.from({ length: count }, (_, i) => `${SEED_POST_PREFIX}post ${i + 1} of ${count}`);
}
/** The messages still to post, given the messages already in the channel. A kept volume posts only what is missing. */
export function missingPostMessages(existingMessages, count = SEED_POST_COUNT) {
    const have = new Set(existingMessages);
    return seedPostMessages(count).filter((message) => !have.has(message));
}
/** GET /api/v4/teams/name/{team}/channels/name/{channel}. Returns the channel id. */
export function channelByNameRequest(baseUrl, bearerToken, team, channel) {
    return {
        url: `${baseUrl}/api/v4/teams/name/${encodeURIComponent(team)}/channels/name/${encodeURIComponent(channel)}`,
        init: { method: "GET", headers: { authorization: `Bearer ${bearerToken}` } },
    };
}
/** GET /api/v4/channels/{id}/posts. A harness channel holds a few posts, so one page of 200 is enough. */
export function channelPostsRequest(baseUrl, bearerToken, channelId) {
    return {
        url: `${baseUrl}/api/v4/channels/${encodeURIComponent(channelId)}/posts?per_page=200`,
        init: { method: "GET", headers: { authorization: `Bearer ${bearerToken}` } },
    };
}
/** POST /api/v4/posts. The author is the token's user; no user id is sent. */
export function createPostRequest(baseUrl, bearerToken, channelId, message) {
    return {
        url: `${baseUrl}/api/v4/posts`,
        init: {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${bearerToken}` },
            body: JSON.stringify({ channel_id: channelId, message }),
        },
    };
}
/** Reads the channel id from a channel-by-name reply. Throws a fixed message and never echoes the body. */
export function parseChannelId(body) {
    const id = body?.id;
    if (typeof id !== "string" || id === "") {
        throw new Error("MATTERMOST_CHANNEL_MISSING: the channel reply had no id (body not printed)");
    }
    return id;
}
/**
 * Reads posts from a channel-posts reply: { order, posts: { [id]: { id, message, user_id } } }. Only the fields the
 * harness uses are kept. Anything malformed throws a fixed message.
 */
export function parseChannelPosts(body) {
    const posts = body?.posts;
    if (posts === null || typeof posts !== "object") {
        throw new Error("MATTERMOST_POSTS_REPLY_INVALID: the channel posts reply had no posts object (body not printed)");
    }
    const out = [];
    for (const post of Object.values(posts)) {
        const p = post;
        if (!p || typeof p.id !== "string" || typeof p.message !== "string" || typeof p.user_id !== "string") {
            throw new Error("MATTERMOST_POSTS_REPLY_INVALID: a post had no id, message or user_id (body not printed)");
        }
        out.push({ id: p.id, message: p.message, userId: p.user_id });
    }
    return out;
}
/** The seeded posts only (by prefix), so an unrelated post in the channel is never counted. */
export function seededPosts(posts) {
    return posts.filter((post) => post.message.startsWith(SEED_POST_PREFIX));
}
//# sourceMappingURL=mattermost-posts.js.map