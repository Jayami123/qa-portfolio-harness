import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseP4LlmMode } from "./litellm-env.js";

describe("parseP4LlmMode (ADR 0007, D14)", () => {
  it("treats unset and blank as stub", () => {
    assert.equal(parseP4LlmMode(undefined), "stub");
    assert.equal(parseP4LlmMode(""), "stub");
    assert.equal(parseP4LlmMode("   "), "stub");
  });

  it("accepts stub and nightly, trimmed", () => {
    assert.equal(parseP4LlmMode("stub"), "stub");
    assert.equal(parseP4LlmMode(" nightly "), "nightly");
  });

  it("throws on any other value and does not echo it", () => {
    assert.throws(() => parseP4LlmMode("live"), (err: Error) => {
      assert.match(err.message, /P4_LLM_MODE/);
      assert.doesNotMatch(err.message, /live/);
      return true;
    });
  });
});
