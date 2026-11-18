import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateLiteLlmMasterKey,
  LITELLM_ALIASES,
  LITELLM_IMAGE,
  litellmComposeFiles,
  litellmSecretsFromText,
  liteLlmComposeEnv,
  liteLlmConfigYaml,
  parseP4LlmMode,
} from "./litellm-env.js";

describe("litellm-env (ADR 0007, D13 to D15)", () => {
  it("pins the image by digest, not by a moving tag", () => {
    assert.match(LITELLM_IMAGE, /^ghcr\.io\/berriai\/litellm:v1\.110\.0@sha256:[0-9a-f]{64}$/);
  });

  it("parses the mode: blank and stub are stub, nightly is nightly, others throw", () => {
    assert.equal(parseP4LlmMode(undefined), "stub");
    assert.equal(parseP4LlmMode(" "), "stub");
    assert.equal(parseP4LlmMode("nightly"), "nightly");
    assert.throws(() => parseP4LlmMode("live"));
  });

  it("writes exactly the two aliases, in order, and nothing else", () => {
    assert.deepEqual([...LITELLM_ALIASES], ["p4-stub", "p4-nightly"]);
    const y = liteLlmConfigYaml();
    assert.equal((y.match(/- model_name: /g) ?? []).length, 2);
    assert.match(y, /- model_name: p4-stub/);
    assert.match(y, /- model_name: p4-nightly/);
  });

  it("has no fallback keys and no api_base for the stub (review answer 0.9)", () => {
    const y = liteLlmConfigYaml();
    assert.doesNotMatch(y, /fallback/i);
    assert.doesNotMatch(y, /api_base/);
    assert.match(y, /mock_response: "stub-ok"/);
  });

  it("reads the master key and the Gemma key from the environment, never from the file", () => {
    const y = liteLlmConfigYaml();
    assert.match(y, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
    assert.match(y, /api_key: os\.environ\/GEMINI_API_KEY/);
    assert.doesNotMatch(y, /AIza|sk-p4-/);
  });

  it("passes GEMINI_API_KEY only in nightly mode, and blanks it in stub mode", () => {
    const base = { PATH: "/usr/bin", GEMINI_API_KEY: "should-not-leak" };
    assert.equal(liteLlmComposeEnv(base, { mode: "stub", masterKey: "sk-x", configFile: "/c" }).GEMINI_API_KEY, "");
    assert.equal(
      liteLlmComposeEnv(base, { mode: "nightly", masterKey: "sk-x", configFile: "/c" }).GEMINI_API_KEY,
      "should-not-leak",
    );
    assert.equal("LITELLM_MASTER_KEY" in base, false, "the base env is not mutated");
  });

  it("generates an sk- master key that differs per call, from an injected source", () => {
    const fixed = (n: number) => Buffer.alloc(n, 0xab);
    assert.equal(generateLiteLlmMasterKey(fixed), generateLiteLlmMasterKey(fixed));
    const real = generateLiteLlmMasterKey();
    assert.match(real, /^sk-p4-[A-Za-z0-9_-]+$/);
    assert.notEqual(real, generateLiteLlmMasterKey());
  });

  it("reuses a saved key and replaces a damaged or non-sk key", () => {
    const made = () => ({ masterKey: "sk-new" });
    assert.deepEqual(litellmSecretsFromText(JSON.stringify({ masterKey: "sk-kept" })), { masterKey: "sk-kept" });
    assert.deepEqual(litellmSecretsFromText("not json", made), { masterKey: "sk-new" });
    assert.deepEqual(litellmSecretsFromText('{"masterKey":"nope"}', made), { masterKey: "sk-new" });
    assert.deepEqual(litellmSecretsFromText(undefined, made), { masterKey: "sk-new" });
  });

  it("lists one compose file", () => {
    assert.equal(litellmComposeFiles().length, 1);
    assert.match(litellmComposeFiles()[0] ?? "", /litellm\.compose\.yml$/);
  });
});
