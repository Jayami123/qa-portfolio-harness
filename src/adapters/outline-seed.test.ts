import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authInfoRequest,
  maskOutlineApiKeys,
  ownerEmailMatches,
  parseAuthInfoEmail,
  parseOutlineSeedOutput,
} from "./outline-seed.js";

const KEY = "ol_api_" + "x".repeat(38);

describe("outline-seed", () => {
  it("masks an API key in a complete line and holds back an unfinished line", () => {
    const first = maskOutlineApiKeys(`{"apiKey":"${KEY}"`, "");
    assert.equal(first.text, "");
    assert.equal(first.carry, `{"apiKey":"${KEY}"`);
    const second = maskOutlineApiKeys(`,"teamId":"t"}\n`, first.carry);
    assert.equal(second.text.includes(KEY), false);
    assert.equal(second.text.includes("ol_api_***"), true);
    assert.equal(second.carry, "");
  });

  it("masks a key that arrives in the same chunk as other text", () => {
    const out = maskOutlineApiKeys(`noise\n${KEY}\nmore\n`, "");
    assert.equal(out.text.includes(KEY), false);
    assert.equal(out.carry, "");
  });

  it("reads the JSON line and skips other output", () => {
    const stdout = [
      "ExperimentalWarning: localStorage is not available",
      '{"label":"lifecycle","message":"noise"}',
      JSON.stringify({ apiKey: KEY, teamId: "team-1", userId: "user-1" }),
      "",
    ].join("\n");
    assert.deepEqual(parseOutlineSeedOutput(stdout), { apiKey: KEY, teamId: "team-1", userId: "user-1" });
  });

  it("rejects a key without the ol_api_ prefix, without echoing it", () => {
    const stdout = JSON.stringify({ apiKey: "not_a_key_SHOULD_NOT_APPEAR_IN_ERRORS_" + "y".repeat(20), teamId: "t", userId: "u" });
    assert.throws(
      () => parseOutlineSeedOutput(stdout),
      (e: Error) => e.message.startsWith("OUTLINE_SEED_OUTPUT_INVALID") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
  });

  it("reports a missing result line without echoing stdout", () => {
    assert.throws(
      () => parseOutlineSeedOutput("some text only SHOULD_NOT_APPEAR"),
      (e: Error) => e.message.startsWith("OUTLINE_SEED_OUTPUT_MISSING") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
  });

  it("builds auth.info with a bearer key and an empty JSON body", () => {
    const req = authInfoRequest("http://127.0.0.1:3011", `Bearer ${KEY}`);
    assert.equal(req.url, "http://127.0.0.1:3011/api/auth.info");
    assert.equal(req.init.method, "POST");
    assert.equal(req.init.body, "{}");
    assert.equal((req.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  });

  it("reads the owner email from auth.info and rejects a reply without one", () => {
    assert.equal(parseAuthInfoEmail({ data: { user: { email: "qa-owner@p4.test" } } }), "qa-owner@p4.test");
    assert.throws(() => parseAuthInfoEmail({ data: {} }), /OUTLINE_AUTH_INFO_MISSING/);
    assert.equal(ownerEmailMatches("qa-owner@p4.test"), true);
    assert.equal(ownerEmailMatches("someone@else.test"), false);
  });
});
