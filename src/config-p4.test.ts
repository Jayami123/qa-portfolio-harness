import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig, loadProductConfig, resetConfigCache } from "./config.js";
import { HARNESS_ROOT } from "./paths.js";
import { isForkProductId, P4_PRODUCT_IDS } from "./types.js";

const KEYS = [
  "PRODUCTS_ROOT",
  "CAL_PRODUCT_DIR",
  "DOCUMENSO_PRODUCT_DIR",
  "MEDUSA_PRODUCT_DIR",
  "TWENTY_PRODUCT_DIR",
  "NEXTCLOUD_BASE_URL",
  "OUTLINE_BASE_URL",
  "PENPOT_BASE_URL",
  "MATTERMOST_BASE_URL",
];

describe("P4 config and the fork split (ADR 0006, D1 and D2)", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    resetConfigCache();
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    saved.clear();
    resetConfigCache();
  });

  it("resolves a P4 product when PRODUCTS_ROOT does not exist", () => {
    process.env.PRODUCTS_ROOT = path.join(os.tmpdir(), `p4-missing-${process.pid}-${Date.now()}`);
    const cfg = loadProductConfig("nextcloud");
    assert.equal(cfg.baseUrl, "http://127.0.0.1:8080");
    assert.equal(cfg.productRoot, path.join(HARNESS_ROOT, ".harness", "nextcloud"));
  });

  it("P4 product roots do not depend on PRODUCTS_ROOT", () => {
    const expected = path.join(HARNESS_ROOT, ".harness", "penpot");
    process.env.PRODUCTS_ROOT = path.join(os.tmpdir(), "p4-root-a");
    assert.equal(loadProductConfig("penpot").productRoot, expected);
    process.env.PRODUCTS_ROOT = path.join(os.tmpdir(), "p4-root-b");
    assert.equal(loadProductConfig("penpot").productRoot, expected);
  });

  it("Outline MCP is the app origin plus /mcp", () => {
    assert.equal(loadProductConfig("outline").mcpUrl, "http://127.0.0.1:3011/mcp");
  });

  it("P4 defaults carry no database password (CLAUDE.md: no passwords in committed files)", () => {
    for (const id of P4_PRODUCT_IDS) {
      const url = new URL(loadProductConfig(id).dbUrl);
      assert.equal(url.password, "", `${id} dbUrl must not contain a password`);
    }
  });

  it("the four fork products still resolve exactly as before (D1 regression)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-forks-"));
    try {
      for (const name of ["cal", "documenso", "medusa-dtc-starter", "twenty-CRM"]) {
        fs.mkdirSync(path.join(dir, name));
      }
      process.env.PRODUCTS_ROOT = dir;
      const cfg = loadConfig();
      assert.equal(cfg.cal.productRoot, path.join(dir, "cal"));
      assert.equal(cfg.documenso.productRoot, path.join(dir, "documenso"));
      assert.equal(cfg.medusa.productRoot, path.join(dir, "medusa-dtc-starter"));
      assert.equal(cfg.twenty.productRoot, path.join(dir, "twenty-CRM"));
      assert.deepEqual(Object.keys(cfg).sort(), ["cal", "documenso", "medusa", "productsRoot", "twenty"]);
      assert.equal(cfg.twenty.baseUrl, "http://127.0.0.1:3002");
      assert.equal(cfg.medusa.baseUrl, "http://127.0.0.1:9000");
      assert.equal(cfg.cal.baseUrl, "http://127.0.0.1:3000");
      assert.equal(cfg.documenso.baseUrl, "http://127.0.0.1:3001");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isForkProductId separates the fork products from the P4 products", () => {
    for (const id of ["cal", "documenso", "medusa", "twenty"] as const) {
      assert.equal(isForkProductId(id), true, id);
    }
    for (const id of P4_PRODUCT_IDS) {
      assert.equal(isForkProductId(id), false, id);
    }
  });
});

describe("agent hosts config (ADR 0007, D11; review answers 0.1 and 0.9)", () => {
  const AGENT_KEYS = ["P4_LLM_MODE", "LITELLM_BASE_URL", "LIBRECHAT_BASE_URL", "LIBRECHAT_MCP_PRODUCTS", "OPENCLAW_BASE_URL", "P4_STUB_API_BASE", "LIBRECHAT_MODELS", "OPENCLAW_RESPONSES_API", "OPENCLAW_CHANNEL_MOCK", "OPENCLAW_LOOP_DETECTION", "OPENCLAW_WEB_FETCH_ALLOWED_HOSTS", "OPENCLAW_WEB_FETCH_PRIVATE_NETWORK", "OPENCLAW_NIGHTLY_MODEL", "PRODUCTS_ROOT"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of AGENT_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetConfigCache();
  });

  afterEach(() => {
    for (const k of AGENT_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetConfigCache();
  });

  function fakeProductsRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p4-agent-config-"));
    for (const d of ["cal", "documenso", "medusa-dtc-starter", "twenty-CRM"]) fs.mkdirSync(path.join(root, d));
    return root;
  }

  it("keeps loadConfig() to the four fork products (regression, D2)", () => {
    process.env.PRODUCTS_ROOT = fakeProductsRoot();
    const keys = Object.keys(loadConfig()).filter((k) => k !== "productsRoot").sort();
    assert.deepEqual(keys, ["cal", "documenso", "medusa", "twenty"]);
  });

  it("loads each agent host under .harness/<id> without needing PRODUCTS_ROOT to exist", () => {
    process.env.PRODUCTS_ROOT = path.join(os.tmpdir(), "definitely-not-a-products-root");
    for (const id of ["litellm", "librechat", "openclaw"] as const) {
      assert.equal(loadProductConfig(id).productRoot, path.join(HARNESS_ROOT, ".harness", id));
    }
  });

  it("defaults the LLM mode to stub and rejects other values without echoing them", () => {
    assert.equal(loadProductConfig("litellm").mode, "stub");
    process.env.P4_LLM_MODE = "live";
    assert.throws(() => loadProductConfig("litellm"), (err: Error) => {
      assert.match(err.message, /P4_LLM_MODE/);
      assert.doesNotMatch(err.message, /live/);
      return true;
    });
  });

  it("uses loopback base URLs by default", () => {
    assert.equal(loadProductConfig("litellm").baseUrl, "http://127.0.0.1:4000");
    assert.equal(loadProductConfig("librechat").baseUrl, "http://127.0.0.1:3080");
    assert.equal(loadProductConfig("openclaw").baseUrl, "http://127.0.0.1:18789");
  });

  it("reads the LibreChat MCP product list from the env, trimmed", () => {
    process.env.LIBRECHAT_MCP_PRODUCTS = " nextcloud, outline ,";
    assert.deepEqual(loadProductConfig("librechat").mcpProducts, ["nextcloud", "outline"]);
  });

  it("reads P4_STUB_API_BASE for LiteLLM: unset keeps mock_response, a bad value throws without echoing it", () => {
    assert.equal(loadProductConfig("litellm").stubApiBase, undefined);
    process.env.P4_STUB_API_BASE = " http://host.docker.internal:8787/v1/ ";
    assert.equal(loadProductConfig("litellm").stubApiBase, "http://host.docker.internal:8787/v1");
    process.env.P4_STUB_API_BASE = "ftp://secret-host/x";
    assert.throws(() => loadProductConfig("litellm"), (err: Error) => {
      assert.match(err.message, /P4_STUB_API_BASE_INVALID/);
      assert.doesNotMatch(err.message, /secret-host/);
      return true;
    });
  });

  it("lists LibreChat models: p4-stub by default, plus p4-nightly in nightly mode, p4-nightly refused in stub mode", () => {
    assert.deepEqual(loadProductConfig("librechat").models, ["p4-stub"]);
    process.env.P4_LLM_MODE = "nightly";
    assert.deepEqual(loadProductConfig("librechat").models, ["p4-stub", "p4-nightly"]);
    process.env.LIBRECHAT_MODELS = "p4-nightly";
    assert.deepEqual(loadProductConfig("librechat").models, ["p4-nightly"]);
    process.env.P4_LLM_MODE = "stub";
    assert.throws(() => loadProductConfig("librechat"), /LIBRECHAT_MODEL_NOT_ALLOWED/);
  });

  it("reads OPENCLAW_RESPONSES_API: off by default, exactly 1 turns it on, anything else throws", () => {
    assert.equal(loadProductConfig("openclaw").responsesApi, false);
    process.env.OPENCLAW_RESPONSES_API = "1";
    assert.equal(loadProductConfig("openclaw").responsesApi, true);
    process.env.OPENCLAW_RESPONSES_API = "true";
    assert.throws(() => loadProductConfig("openclaw"), /OPENCLAW_RESPONSES_API_INVALID/);
  });

  it("reads the v0.6.4 OpenClaw options: all off by default, set through the environment", () => {
    const off = loadProductConfig("openclaw");
    assert.deepEqual(
      [off.channelMock, off.loopDetection, off.webFetchAllowedHosts, off.webFetchPrivateNetwork, off.nightlyModel],
      [false, false, [], false, false],
    );
    process.env.OPENCLAW_CHANNEL_MOCK = "1";
    process.env.OPENCLAW_LOOP_DETECTION = "1";
    process.env.OPENCLAW_WEB_FETCH_ALLOWED_HOSTS = "p4-fixtures, pages.internal";
    process.env.OPENCLAW_WEB_FETCH_PRIVATE_NETWORK = "1";
    const on = loadProductConfig("openclaw");
    assert.deepEqual(
      [on.channelMock, on.loopDetection, on.webFetchAllowedHosts, on.webFetchPrivateNetwork, on.nightlyModel],
      [true, true, ["p4-fixtures", "pages.internal"], true, false],
    );
    process.env.OPENCLAW_CHANNEL_MOCK = "yes";
    assert.throws(() => loadProductConfig("openclaw"), /OPENCLAW_CHANNEL_MOCK_INVALID/);
  });

  it("OPENCLAW_NIGHTLY_MODEL needs P4_LLM_MODE=nightly", () => {
    process.env.OPENCLAW_NIGHTLY_MODEL = "1";
    assert.throws(() => loadProductConfig("openclaw"), /OPENCLAW_NIGHTLY_MODEL_NEEDS_NIGHTLY/);
    process.env.P4_LLM_MODE = "nightly";
    assert.equal(loadProductConfig("openclaw").nightlyModel, true);
  });

  it("keeps the agent hosts out of the fork-product cache", () => {
    assert.equal(P4_PRODUCT_IDS.some((id) => isForkProductId(id)), false);
    assert.equal(P4_PRODUCT_IDS.length, 7);
  });
});
