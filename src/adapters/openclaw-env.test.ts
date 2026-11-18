import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOpenClawPinIsRelease,
  generateOpenClawGatewayToken,
  OPENCLAW_ENV_NAMES,
  OPENCLAW_IMAGE,
  openClawComposeFiles,
  openClawConfig,
  openClawEnvText,
  parseOpenClawResponsesFlag,
} from "./openclaw-env.js";

describe("openclaw-env (ADR 0007, D18, D19; review answer 0.5)", () => {
  it("pins a dated release tag by digest", () => {
    assert.match(OPENCLAW_IMAGE, /^ghcr\.io\/openclaw\/openclaw:2026\.10\.33-slim@sha256:[0-9a-f]{64}$/);
    assert.doesNotThrow(() => assertOpenClawPinIsRelease(OPENCLAW_IMAGE));
  });

  it("refuses main, latest and untagged pins", () => {
    const digest = "@sha256:" + "a".repeat(64);
    assert.throws(() => assertOpenClawPinIsRelease(`ghcr.io/openclaw/openclaw:main-slim${digest}`), /OPENCLAW_PIN_NOT_RELEASE/);
    assert.throws(() => assertOpenClawPinIsRelease(`ghcr.io/openclaw/openclaw:latest${digest}`), /OPENCLAW_PIN_NOT_RELEASE/);
    assert.throws(() => assertOpenClawPinIsRelease(`ghcr.io/openclaw/openclaw${digest}`), /OPENCLAW_PIN_NOT_RELEASE/);
  });

  it("writes a config that uses placeholders and no secret value", () => {
    const text = JSON.stringify(openClawConfig());
    assert.match(text, /"\$\{OPENCLAW_GATEWAY_TOKEN\}"/);
    assert.match(text, /"\$\{P4_LITELLM_API_KEY\}"/);
    assert.doesNotMatch(text, /[0-9a-f]{32,}|Bearer |sk-/);
  });

  it("sets local mode, lan bind inside the container, token auth, approvals on, one provider, no channel", () => {
    const c = openClawConfig() as Record<string, any>;
    assert.equal(c.gateway.mode, "local");
    assert.equal(c.gateway.bind, "lan");
    assert.equal(c.gateway.auth.mode, "token");
    assert.equal(c.tools.exec.ask, "always");
    assert.equal(c.approvals.exec.enabled, true);
    assert.equal(c.models.providers["p4-litellm"].baseUrl, "http://litellm:4000/v1");
    assert.equal(c.agents.defaults.model.primary, "p4-litellm/p4-stub");
    assert.deepEqual(c.channels, {});
  });

  it("writes the env file as NAME=value lines with the three names the config reads", () => {
    const text = openClawEnvText({ gatewayToken: "tok-A", liteLlmKey: "key-B" });
    const names = text.split("\n").filter(Boolean).map((line) => line.split("=")[0]);
    assert.deepEqual(names, [...OPENCLAW_ENV_NAMES]);
    assert.match(text, /^OPENCLAW_GATEWAY_TOKEN=tok-A$/m);
  });

  it("generates a url-safe gateway token that differs per call", () => {
    const fixed = (n: number) => Buffer.alloc(n, 0xab);
    assert.equal(generateOpenClawGatewayToken(fixed), generateOpenClawGatewayToken(fixed));
    const real = generateOpenClawGatewayToken();
    assert.match(real, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(real, generateOpenClawGatewayToken());
  });

  it("lists one compose file", () => {
    assert.equal(openClawComposeFiles().length, 1);
  });

  it("enables POST /v1/responses only when asked, and keeps the default config unchanged", () => {
    const off = openClawConfig() as Record<string, any>;
    assert.equal(off.gateway.http, undefined);
    assert.deepEqual(openClawConfig({ responsesApi: false }), openClawConfig());
    const on = openClawConfig({ responsesApi: true }) as Record<string, any>;
    assert.deepEqual(on.gateway.http, { endpoints: { responses: { enabled: true } } });
    assert.equal(on.gateway.auth.mode, "token", "token auth stays on");
    assert.equal(on.tools.exec.ask, "always", "approvals stay on");
    assert.equal(on.gateway.bind, "lan");
  });

  it("parses OPENCLAW_RESPONSES_API: blank is off, exactly 1 is on, anything else throws", () => {
    assert.equal(parseOpenClawResponsesFlag(undefined), false);
    assert.equal(parseOpenClawResponsesFlag(" "), false);
    assert.equal(parseOpenClawResponsesFlag("1"), true);
    for (const bad of ["0", "true", "yes"]) {
      assert.throws(() => parseOpenClawResponsesFlag(bad), (err: Error) => {
        assert.match(err.message, /OPENCLAW_RESPONSES_API_INVALID/);
        assert.doesNotMatch(err.message, new RegExp(`"${bad}"`));
        return true;
      });
    }
  });
});
