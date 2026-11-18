import assert from "node:assert/strict";
import fs from "node:fs";
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
  parseStubApiBase,
} from "./litellm-env.js";

type LiteLlmParams = Record<string, string | number>;
interface LiteLlmModel {
  model_name: string;
  litellm_params: LiteLlmParams;
}

/** Reads the model_list entries of the generated config. Comments are skipped; values are numbers or unquoted strings. */
function parseLiteLlmModelList(yaml: string): LiteLlmModel[] {
  const models: LiteLlmModel[] = [];
  let current: LiteLlmModel | undefined;
  for (const line of yaml.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const head = /^ {2}- model_name: (\S+)$/.exec(line);
    if (head?.[1] !== undefined) {
      current = { model_name: head[1], litellm_params: {} };
      models.push(current);
      continue;
    }
    if (/^\S/.test(line)) {
      current = undefined;
      continue;
    }
    const param = /^ {6}([a-z_]+): (.+)$/.exec(line);
    if (current !== undefined && param?.[1] !== undefined && param[2] !== undefined) {
      const raw = param[2].replace(/^"(.*)"$/, "$1");
      current.litellm_params[param[1]] = /^\d+$/.test(raw) ? Number(raw) : raw;
    }
  }
  return models;
}

describe("litellm-env (ADR 0007, D13 to D15)", () => {
  it("parses the generated model_list: p4-nightly carries rpm 30, tpm 16000 and num_retries, with no fallbacks", () => {
    const yaml = liteLlmConfigYaml();
    const models = parseLiteLlmModelList(yaml);
    assert.deepEqual(
      models.map((m) => m.model_name),
      ["p4-stub", "p4-nightly"],
    );

    const nightly = models.find((m) => m.model_name === "p4-nightly")?.litellm_params;
    assert.ok(nightly, "p4-nightly is in model_list");
    assert.equal(nightly.model, "gemini/gemma-4-31b-it");
    assert.equal(nightly.rpm, 30);
    assert.equal(nightly.tpm, 16000);
    assert.equal(typeof nightly.num_retries, "number");
    assert.ok((nightly.num_retries as number) > 0, "num_retries is a positive count");
    assert.equal(nightly.fallbacks, undefined, "p4-nightly has no fallbacks key");

    const uncommented = yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(uncommented, /fallback/i, "no fallback anywhere in the config");
  });

  it("leaves p4-stub unchanged: no rate limits and no retries", () => {
    const stub = parseLiteLlmModelList(liteLlmConfigYaml()).find((m) => m.model_name === "p4-stub")?.litellm_params;
    assert.deepEqual(stub, { model: "openai/stub-upstream-model", mock_response: "stub-ok" });
  });

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

  describe("P4_STUB_API_BASE (optional p4-stub upstream)", () => {
    const BASE = "http://host.docker.internal:8787/v1";

    it("unset: p4-stub keeps mock_response, no api_base and no header forwarding", () => {
      const y = liteLlmConfigYaml({});
      assert.equal(y, liteLlmConfigYaml());
      const stub = parseLiteLlmModelList(y).find((m) => m.model_name === "p4-stub")?.litellm_params;
      assert.deepEqual(stub, { model: "openai/stub-upstream-model", mock_response: "stub-ok" });
      assert.doesNotMatch(y, /api_base|forward_client_headers/);
    });

    it("set: p4-stub routes to the stub with api_base, drops mock_response, and forwards x- headers", () => {
      const y = liteLlmConfigYaml({ stubApiBase: BASE });
      const models = parseLiteLlmModelList(y);
      assert.deepEqual(models.map((m) => m.model_name), ["p4-stub", "p4-nightly"]);
      const stub = models.find((m) => m.model_name === "p4-stub")?.litellm_params;
      assert.equal(stub?.api_base, BASE);
      assert.equal(stub?.model, "openai/stub-upstream-model");
      assert.equal(stub?.mock_response, undefined);
      assert.match(y, /^ {2}forward_client_headers_to_llm_api: true$/m);
      assert.match(y, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
    });

    it("set: p4-nightly is unchanged and api_base never leaks onto it", () => {
      const a = parseLiteLlmModelList(liteLlmConfigYaml()).find((m) => m.model_name === "p4-nightly");
      const b = parseLiteLlmModelList(liteLlmConfigYaml({ stubApiBase: BASE })).find((m) => m.model_name === "p4-nightly");
      assert.deepEqual(b, a);
    });

    it("parses: blank is unset, a trailing slash is removed, bad values throw without echoing", () => {
      assert.equal(parseStubApiBase(undefined), undefined);
      assert.equal(parseStubApiBase("  "), undefined);
      assert.equal(parseStubApiBase(`${BASE}/`), BASE);
      for (const bad of ["not a url", "ftp://h/x", "http://user:pw@h/v1", "http://h/v1?k=SECRETVAL", "http://h/v1#frag"]) {
        assert.throws(() => parseStubApiBase(bad), (err: Error) => {
          assert.match(err.message, /P4_STUB_API_BASE_INVALID/);
          assert.doesNotMatch(err.message, /SECRETVAL|pw@/);
          return true;
        });
      }
    });

    it("the compose file maps host.docker.internal and still publishes only on 127.0.0.1", () => {
      const text = fs.readFileSync(litellmComposeFiles()[0] ?? "", "utf8");
      assert.match(text, /host\.docker\.internal:host-gateway/);
      assert.match(text, /"127\.0\.0\.1:4000:4000"/);
    });
  });
});
