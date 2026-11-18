import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedDomainsFor,
  experimentMcpServerOrder,
  LIBRECHAT_CONFIG_VERSION,
  LIBRECHAT_IMAGE,
  LIBRECHAT_MONGO_IMAGE,
  librechatComposeFiles,
  librechatEnvText,
  librechatMcpServerFor,
  librechatSecretValues,
  librechatYaml,
} from "./librechat-env.js";

const FIVE = ["nextcloud", "outline", "twenty", "penpot", "mattermost"];

describe("librechat-env (ADR 0007, review answers 0.1, 0.6, 0.7)", () => {
  it("pins the app and mongo images by digest", () => {
    assert.match(LIBRECHAT_IMAGE, /^ghcr\.io\/librechat-ai\/librechat:v0\.8\.7@sha256:[0-9a-f]{64}$/);
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
    const y = librechatYaml({ defaultModel: "p4-stub", servers: FIVE.map(librechatMcpServerFor) });
    assert.equal(LIBRECHAT_CONFIG_VERSION, "1.3.13");
    assert.match(y, /^version: 1\.3\.13$/m);
    assert.match(y, /allowedDomains:\n {4}- "nextcloud-mcp"/);
    assert.equal((y.match(/type: streamable-http/g) ?? []).length, 5);
    assert.match(y, /baseURL: "http:\/\/litellm:4000\/v1"/);
    assert.match(y, /default: \["p4-stub"\]/);
  });

  it("puts no secret in the yaml: only ${VAR} placeholders, and no bearer literal", () => {
    const y = librechatYaml({ defaultModel: "p4-stub", servers: FIVE.map(librechatMcpServerFor) });
    assert.doesNotMatch(y, /Bearer |Basic |[0-9a-f]{32,}/);
    assert.match(y, /\$\{P4_NEXTCLOUD_MCP_AUTHORIZATION\}/);
    assert.match(y, /\$\{P4_LITELLM_API_KEY\}/);
  });

  it("EXPERIMENT: writes mattermost first in mcpServers, keeps all five, and leaves allowedDomains in order", () => {
    const servers = FIVE.map(librechatMcpServerFor);
    assert.deepEqual(
      experimentMcpServerOrder(servers).map((s) => s.name),
      ["mattermost", "nextcloud", "outline", "twenty", "penpot"],
    );
    const y = librechatYaml({ defaultModel: "p4-stub", servers });
    const block = y.slice(y.indexOf("mcpServers:"), y.indexOf("endpoints:"));
    assert.deepEqual(
      [...block.matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]),
      ["mattermost", "nextcloud", "outline", "twenty", "penpot"],
    );
    assert.match(y, /allowedDomains:\n {4}- "nextcloud-mcp"/);
  });

  it("gives Penpot no headers block (single-user, no token)", () => {
    const y = librechatYaml({ defaultModel: "p4-stub", servers: [librechatMcpServerFor("penpot")] });
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
});
