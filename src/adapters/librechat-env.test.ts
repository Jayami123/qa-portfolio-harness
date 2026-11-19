import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedDomainsFor,
  LIBRECHAT_CONFIG_VERSION,
  LIBRECHAT_IMAGE,
  LIBRECHAT_MONGO_IMAGE,
  librechatComposeFiles,
  librechatEnvText,
  librechatMcpServerFor,
  librechatSecretValues,
  librechatYaml,
  resolveLibreChatModels,
} from "./librechat-env.js";

const FIVE = ["nextcloud", "outline", "twenty", "penpot", "mattermost"];

describe("librechat-env (ADR 0007, review answers 0.1, 0.6, 0.7)", () => {
  it("pins the app and mongo images by digest", () => {
    assert.match(LIBRECHAT_IMAGE, /^ghcr\.io\/librechat-ai\/librechat:v0\.8\.9@sha256:[0-9a-f]{64}$/);
    assert.match(LIBRECHAT_MONGO_IMAGE, /@sha256:[0-9a-f]{64}$/);
  });

  it("maps the five Part A products to their alias URLs, not 127.0.0.1", () => {
    for (const p of FIVE) {
      const s = librechatMcpServerFor(p);
      assert.match(s.url, /^http:\/\/[a-z-]+:\d+\/mcp$/, `${p} must use an alias`);
      assert.doesNotMatch(s.url, /127\.0\.0\.1|localhost/);
    }
    assert.equal(librechatMcpServerFor("nextcloud").url, "http://nextcloud-mcp:8000/mcp");
    assert.equal(librechatMcpServerFor("outline").url, "http://outline:3000/mcp");
    assert.equal(librechatMcpServerFor("twenty").url, "http://twenty-server:3000/mcp");
    assert.equal(librechatMcpServerFor("penpot").url, "http://penpot-mcp:4401/mcp");
    assert.equal(librechatMcpServerFor("mattermost").url, "http://mattermost-mcp:8066/mcp");
    // H5: the attack-lab entry. No credential, so the env builder never reads run state for it.
    assert.equal(librechatMcpServerFor("lab").url, "http://p4-attack-lab:9010/mcp");
    assert.equal(librechatMcpServerFor("lab").authEnv, null);
  });

  it("rejects a product that has no MCP server", () => {
    assert.throws(() => librechatMcpServerFor("cal"), /LIBRECHAT_MCP_UNKNOWN/);
  });

  it("builds the allowlist from the server hosts plus the LiteLLM alias", () => {
    const servers = FIVE.map(librechatMcpServerFor);
    assert.deepEqual(allowedDomainsFor(servers), [
      "nextcloud-mcp",
      "outline",
      "twenty-server",
      "penpot-mcp",
      "mattermost-mcp",
      "litellm",
    ]);
  });

  it("writes the pinned config version, the allowlist, five servers and the LiteLLM endpoint", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: FIVE.map(librechatMcpServerFor) });
    assert.equal(LIBRECHAT_CONFIG_VERSION, "1.3.19");
    assert.match(y, /^version: 1\.3\.19$/m);
    assert.match(y, /allowedDomains:\n {4}- "nextcloud-mcp"/);
    assert.equal((y.match(/type: streamable-http/g) ?? []).length, 5);
    assert.match(y, /baseURL: "http:\/\/litellm:4000\/v1"/);
    assert.match(y, /default: \["p4-stub"\]/);
  });

  it("puts no secret in the yaml: only ${VAR} placeholders, and no bearer literal", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: FIVE.map(librechatMcpServerFor) });
    assert.doesNotMatch(y, /Bearer |Basic |[0-9a-f]{32,}/);
    assert.match(y, /\$\{P4_NEXTCLOUD_MCP_AUTHORIZATION\}/);
    assert.match(y, /\$\{P4_LITELLM_API_KEY\}/);
  });

  it("writes mcpServers in the configured order", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: FIVE.map(librechatMcpServerFor) });
    const block = y.slice(y.indexOf("mcpServers:"), y.indexOf("endpoints:"));
    assert.deepEqual(
      [...block.matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]),
      FIVE,
    );
  });

  it("sets requiresOAuth: false on every mcpServers entry, so LibreChat skips OAuth detection", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: FIVE.map(librechatMcpServerFor) });
    const block = y.slice(y.indexOf("mcpServers:"), y.indexOf("endpoints:"));
    const entries = block.split(/\n(?= {2}[a-z]+:\n)/).slice(1);
    assert.equal(entries.length, 5);
    for (const entry of entries) {
      assert.match(entry, /^ {4}requiresOAuth: false$/m, entry.split("\n")[0]);
    }
    assert.equal((y.match(/requiresOAuth/g) ?? []).length, 5);
  });

  it("gives Penpot no headers block (single-user, no token)", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: [librechatMcpServerFor("penpot")] });
    assert.doesNotMatch(y, /headers:/);
  });

  it("writes the env text as NAME=value lines", () => {
    assert.equal(librechatEnvText({ A: "1", B: "2" }), "A=1\nB=2\n");
  });

  it("makes secrets of the right shape that differ per call", () => {
    const s = librechatSecretValues();
    assert.match(s.credsKey, /^[0-9a-f]{64}$/);
    assert.match(s.credsIv, /^[0-9a-f]{32}$/);
    assert.notEqual(librechatSecretValues().jwtSecret, s.jwtSecret);
  });

  it("lists one compose file", () => {
    assert.equal(librechatComposeFiles().length, 1);
  });

  describe("model list from config (stub default, p4-nightly only in nightly mode)", () => {
    it("defaults to [p4-stub] in stub mode and [p4-stub, p4-nightly] in nightly mode", () => {
      assert.deepEqual(resolveLibreChatModels(undefined, "stub"), ["p4-stub"]);
      assert.deepEqual(resolveLibreChatModels("", "stub"), ["p4-stub"]);
      assert.deepEqual(resolveLibreChatModels(undefined, "nightly"), ["p4-stub", "p4-nightly"]);
    });

    it("accepts an explicit list, trimmed and de-duplicated, in order", () => {
      assert.deepEqual(resolveLibreChatModels(" p4-nightly , p4-stub,p4-stub", "nightly"), ["p4-nightly", "p4-stub"]);
    });

    it("refuses p4-nightly in stub mode and any non-alias model", () => {
      assert.throws(() => resolveLibreChatModels("p4-nightly", "stub"), /LIBRECHAT_MODEL_NOT_ALLOWED/);
      assert.throws(() => resolveLibreChatModels("gpt-4o", "nightly"), /LIBRECHAT_MODEL_UNKNOWN/);
    });

    it("writes every listed model into the custom endpoint, first model first, and keeps fetch off", () => {
      const y = librechatYaml({ models: ["p4-stub", "p4-nightly"], servers: [librechatMcpServerFor("twenty")] });
      assert.match(y, /default: \["p4-stub", "p4-nightly"\]/);
      assert.match(y, /fetch: false/);
      assert.match(y, /baseURL: "http:\/\/litellm:4000\/v1"/);
      const stubOnly = librechatYaml({ models: ["p4-stub"], servers: [librechatMcpServerFor("twenty")] });
      assert.match(stubOnly, /default: \["p4-stub"\]/);
      assert.doesNotMatch(stubOnly, /p4-nightly/);
    });

    it("never carries the Gemini key: the yaml has none, and the env file builder refuses a GEMINI name", () => {
      const y = librechatYaml({ models: ["p4-stub", "p4-nightly"], servers: FIVE.map(librechatMcpServerFor) });
      assert.doesNotMatch(y, /GEMINI|AIza/i);
      assert.match(y, /apiKey: "\$\{P4_LITELLM_API_KEY\}"/);
      assert.throws(() => librechatEnvText({ GEMINI_API_KEY: "x" }), /LIBRECHAT_ENV_GEMINI_REFUSED/);
      assert.throws(() => librechatEnvText({ gemini_api_key: "x" }), /LIBRECHAT_ENV_GEMINI_REFUSED/);
      assert.doesNotThrow(() => librechatEnvText({ P4_LITELLM_API_KEY: "sk-x" }));
    });
  });
});
