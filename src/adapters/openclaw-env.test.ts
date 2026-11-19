import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOpenClawPinIsRelease,
  generateOpenClawMockChannelToken,
  OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV,
  parseOpenClawChannelMockFlag,
  parseOpenClawLoopDetectionFlag,
  parseOpenClawNightlyModelFlag,
  parseOpenClawWebFetchHosts,
  parseOpenClawWebFetchPrivateNetworkFlag,
  resolveOpenClawNightlyModel,
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

  it("writes tools.toolSearch: false only with the responses API on (docs/tools/tool-search.md at 2026.10.33)", () => {
    const off = openClawConfig() as Record<string, any>;
    assert.equal("toolSearch" in off.tools, false, "unset keeps the upstream default");
    assert.equal("toolSearch" in (openClawConfig({ responsesApi: false }) as Record<string, any>).tools, false);
    const on = openClawConfig({ responsesApi: true }) as Record<string, any>;
    assert.equal(on.tools.toolSearch, false);
    assert.deepEqual(on.tools.exec, { ask: "always", security: "allowlist" }, "approvals stay on");
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
  describe("v0.6.4 L4 primitives: every option is off by default", () => {
    const LOCK = { ask: "always", security: "allowlist" };

    it("H1/H4/H5 unset or false leaves the config deep-equal to 0.6.3 (no channel, no commands, no extra tools keys)", () => {
      const base = openClawConfig() as Record<string, any>;
      const explicitOff = openClawConfig({
        channelMock: false,
        loopDetection: false,
        webFetchAllowedHosts: [],
        webFetchPrivateNetwork: false,
        nightlyModel: false,
      });
      assert.deepEqual(explicitOff, base);
      assert.deepEqual(base.channels, {});
      assert.equal("commands" in base, false);
      assert.deepEqual(base.tools, { exec: LOCK });
      assert.equal(base.agents.defaults.model.primary, "p4-litellm/p4-stub");
      assert.deepEqual(base.models.providers["p4-litellm"].models, [{ id: "p4-stub", name: "p4-stub" }]);
    });

    it("H1 writes the mock telegram channel and commands.ownerAllowFrom, with a placeholder token (docs/channels/telegram*.md)", () => {
      const c = openClawConfig({ channelMock: true }) as Record<string, any>;
      assert.deepEqual(c.channels.telegram, {
        enabled: true,
        botToken: "${OPENCLAW_MOCK_TELEGRAM_TOKEN}",
        apiRoot: "http://p4-mock-channel:8788",
        dmPolicy: "pairing",
        allowFrom: ["1001"],
        groupPolicy: "allowlist",
        groupAllowFrom: ["1001"],
        groups: { "-100777": {} },
      });
      assert.deepEqual(c.commands, { ownerAllowFrom: ["telegram:1001"] });
      assert.equal(OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV, "OPENCLAW_MOCK_TELEGRAM_TOKEN");
      assert.doesNotMatch(JSON.stringify(c), /\d{5,}:[A-Za-z0-9_-]{30,}/, "no token value in the config");
      for (const id of c.channels.telegram.groupAllowFrom) {
        assert.match(id, /^\d+$/, "groupAllowFrom holds numeric user ids only, never a negative chat id");
      }
      assert.deepEqual(c.tools.exec, LOCK);
      assert.equal(c.gateway.auth.mode, "token");
    });

    it("H1 token has the telegram shape, differs per call, and the env file carries the extra name only when given", () => {
      assert.match(generateOpenClawMockChannelToken(), /^7770001:[A-Za-z0-9_-]{35}$/);
      assert.notEqual(generateOpenClawMockChannelToken(), generateOpenClawMockChannelToken());
      const off = openClawEnvText({ gatewayToken: "t", liteLlmKey: "k" });
      assert.deepEqual(off.split("\n").filter(Boolean).map((l) => l.split("=")[0]), [...OPENCLAW_ENV_NAMES]);
      const on = openClawEnvText({ gatewayToken: "t", liteLlmKey: "k", mockChannelToken: "7770001:x" });
      assert.match(on, /^OPENCLAW_MOCK_TELEGRAM_TOKEN=7770001:x$/m);
      assert.deepEqual(OPENCLAW_ENV_NAMES, ["OPENCLAW_GATEWAY_TOKEN", "P4_LITELLM_API_KEY", "OPENCLAW_CONFIG_PATH"], "the base name list is unchanged");
    });

    it("H4 each option writes only its own key (docs/tools/loop-detection.md, docs/tools/web-fetch.md)", () => {
      const loop = openClawConfig({ loopDetection: true }) as Record<string, any>;
      assert.deepEqual(loop.tools, { exec: LOCK, loopDetection: { enabled: true } });
      const hosts = openClawConfig({ webFetchAllowedHosts: ["p4-fixtures", "pages.internal"] }) as Record<string, any>;
      assert.deepEqual(hosts.tools.web, { fetch: { ssrfPolicy: { allowedHostnames: ["p4-fixtures", "pages.internal"] } } });
      const broad = openClawConfig({ webFetchPrivateNetwork: true }) as Record<string, any>;
      assert.deepEqual(broad.tools.web, { fetch: { ssrfPolicy: { dangerouslyAllowPrivateNetwork: true } } });
      assert.equal("loopDetection" in hosts.tools, false);
    });

    it("the tools.exec ask/allowlist lock is identical under every option combination", () => {
      for (let mask = 0; mask < 64; mask++) {
        const c = openClawConfig({
          responsesApi: (mask & 1) !== 0,
          channelMock: (mask & 2) !== 0,
          loopDetection: (mask & 4) !== 0,
          webFetchAllowedHosts: (mask & 8) !== 0 ? ["p4-fixtures"] : [],
          webFetchPrivateNetwork: (mask & 16) !== 0,
          nightlyModel: (mask & 32) !== 0,
        }) as Record<string, any>;
        assert.deepEqual(c.tools.exec, LOCK, `mask ${mask}`);
        assert.deepEqual(c.approvals, { exec: { enabled: true, mode: "session" } }, `mask ${mask}`);
      }
    });

    it("H5 nightlyModel makes p4-nightly the primary and lists it; the default stays p4-stub", () => {
      const c = openClawConfig({ nightlyModel: true }) as Record<string, any>;
      assert.equal(c.agents.defaults.model.primary, "p4-litellm/p4-nightly");
      assert.deepEqual(c.models.providers["p4-litellm"].models.map((m: { id: string }) => m.id), ["p4-stub", "p4-nightly"]);
      assert.equal(c.models.providers["p4-litellm"].baseUrl, "http://litellm:4000/v1", "still LiteLLM only");
    });

    it("H5 flag resolves only in nightly mode; stub mode throws", () => {
      assert.equal(resolveOpenClawNightlyModel(false, "stub"), false);
      assert.equal(resolveOpenClawNightlyModel(false, "nightly"), false);
      assert.equal(resolveOpenClawNightlyModel(true, "nightly"), true);
      assert.throws(() => resolveOpenClawNightlyModel(true, "stub"), /OPENCLAW_NIGHTLY_MODEL_NEEDS_NIGHTLY/);
    });

    it("the four new flags: blank off, exactly 1 on, anything else throws without echoing", () => {
      const flags: Array<[(raw: string | undefined) => boolean, string]> = [
        [parseOpenClawChannelMockFlag, "OPENCLAW_CHANNEL_MOCK"],
        [parseOpenClawLoopDetectionFlag, "OPENCLAW_LOOP_DETECTION"],
        [parseOpenClawWebFetchPrivateNetworkFlag, "OPENCLAW_WEB_FETCH_PRIVATE_NETWORK"],
        [parseOpenClawNightlyModelFlag, "OPENCLAW_NIGHTLY_MODEL"],
      ];
      for (const [parse, name] of flags) {
        assert.equal(parse(undefined), false);
        assert.equal(parse("  "), false);
        assert.equal(parse("1"), true);
        assert.throws(() => parse("secret-ish-value"), (err: Error) => {
          assert.match(err.message, new RegExp(`${name}_INVALID`));
          assert.doesNotMatch(err.message, /secret-ish-value/);
          return true;
        });
      }
    });

    it("OPENCLAW_WEB_FETCH_ALLOWED_HOSTS takes exact hostnames only, lowercases and de-duplicates, and never echoes a bad entry", () => {
      assert.deepEqual(parseOpenClawWebFetchHosts(undefined), []);
      assert.deepEqual(parseOpenClawWebFetchHosts(" , "), []);
      assert.deepEqual(parseOpenClawWebFetchHosts("P4-Fixtures, pages.internal ,p4-fixtures"), ["p4-fixtures", "pages.internal"]);
      for (const bad of ["http://x", "x:80", "*.x", "x/y", "-x", "a b"]) {
        assert.throws(() => parseOpenClawWebFetchHosts(`ok,${bad}`), (err: Error) => {
          assert.match(err.message, /OPENCLAW_WEB_FETCH_HOSTS_INVALID/);
          assert.equal(err.message.includes(bad), false);
          return true;
        });
      }
    });
  });
});
