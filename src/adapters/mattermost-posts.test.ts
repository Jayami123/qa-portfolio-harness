import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  channelByNameRequest,
  channelPostsRequest,
  createPostRequest,
  MATTERMOST_POSTS_INVALID,
  MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY,
  missingPostMessages,
  mattermostPostsOption,
  parseChannelId,
  parseChannelPosts,
  SEED_CHANNEL_NAME,
  SEED_POST_PREFIX,
  seededPosts,
  seedPostMessages,
} from "./mattermost-posts.js";

describe("H7 flag: off by default, exact \"1\" only, and it needs the second identity", () => {
  it("is off when unset", () => {
    assert.equal(mattermostPostsOption("", ""), false);
    assert.equal(mattermostPostsOption("", "1"), false);
  });
  it("is on only for exactly 1 together with the second identity", () => {
    assert.equal(mattermostPostsOption("1", "1"), true);
  });
  it("needs P4_SECOND_IDENTITY=1", () => {
    assert.throws(() => mattermostPostsOption("1", ""), (err: Error) => err.message.startsWith(MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY));
  });
  it("rejects every other value without echoing it", () => {
    for (const bad of ["zz-value-0", "true", "yes", " 1", "1 "]) {
      assert.throws(
        () => mattermostPostsOption(bad, "1"),
        (err: Error) => err.message.startsWith(MATTERMOST_POSTS_INVALID) && !err.message.includes("zz-"),
        `value ${JSON.stringify(bad)}`,
      );
    }
  });
});

describe("H7 messages: fixed, prefixed, and only the missing ones are posted", () => {
  it("builds the fixed messages in order with the prefix", () => {
    assert.deepEqual(seedPostMessages(3), [`${SEED_POST_PREFIX}post 1 of 3`, `${SEED_POST_PREFIX}post 2 of 3`, `${SEED_POST_PREFIX}post 3 of 3`]);
  });
  it("posts all of them into an empty channel", () => {
    assert.deepEqual(missingPostMessages([]), seedPostMessages());
  });
  it("posts only the missing ones on a kept volume, and ignores unrelated posts", () => {
    const all = seedPostMessages();
    const existing = [all[0] as string, "an unrelated post"];
    assert.deepEqual(missingPostMessages(existing), all.slice(1));
  });
  it("posts nothing when every message is there", () => {
    assert.deepEqual(missingPostMessages(seedPostMessages()), []);
  });
});

describe("H7 requests and parsers", () => {
  it("looks up town-square by team and channel name, with the token in the header only", () => {
    const req = channelByNameRequest("http://127.0.0.1:8065", "tok-1", "qa", SEED_CHANNEL_NAME);
    assert.equal(req.url, "http://127.0.0.1:8065/api/v4/teams/name/qa/channels/name/town-square");
    assert.equal((req.init.headers as Record<string, string>).authorization, "Bearer tok-1");
    assert.ok(!req.url.includes("tok-1"));
  });
  it("lists the channel's posts with one page", () => {
    const req = channelPostsRequest("http://127.0.0.1:8065", "tok-1", "chan-1");
    assert.equal(req.url, "http://127.0.0.1:8065/api/v4/channels/chan-1/posts?per_page=200");
  });
  it("creates a post with the channel id and message in the body, the token in the header", () => {
    const req = createPostRequest("http://127.0.0.1:8065", "tok-1", "chan-1", "hello");
    assert.equal(req.url, "http://127.0.0.1:8065/api/v4/posts");
    assert.equal(req.init.method, "POST");
    assert.deepEqual(JSON.parse(String(req.init.body)), { channel_id: "chan-1", message: "hello" });
    assert.ok(!String(req.init.body).includes("tok-1"));
  });
  it("reads the channel id and rejects a reply without one", () => {
    assert.equal(parseChannelId({ id: "chan-1" }), "chan-1");
    assert.throws(() => parseChannelId({}), /MATTERMOST_CHANNEL_MISSING/);
  });
  it("reads posts and keeps only the seeded ones", () => {
    const body = {
      order: ["p1", "p2"],
      posts: {
        p1: { id: "p1", message: `${SEED_POST_PREFIX}post 1 of 3`, user_id: "u-b" },
        p2: { id: "p2", message: "not ours", user_id: "u-a" },
      },
    };
    const posts = parseChannelPosts(body);
    assert.equal(posts.length, 2);
    assert.deepEqual(seededPosts(posts).map((p) => p.id), ["p1"]);
  });
  it("rejects a malformed post with a fixed message that never echoes the body", () => {
    assert.throws(
      () => parseChannelPosts({ posts: { p1: { id: "p1", user_id: "u-b" } } }),
      (err: Error) => err.message.startsWith("MATTERMOST_POSTS_REPLY_INVALID") && !err.message.includes("u-b"),
    );
    assert.throws(() => parseChannelPosts({}), /MATTERMOST_POSTS_REPLY_INVALID/);
  });
});
