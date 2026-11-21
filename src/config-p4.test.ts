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
  const AGENT_KEYS = ["P4_LLM_MODE", "P4_NIGHTLY_PROVIDER", "LITELLM_BASE_URL", "LIBRECHAT_BASE_URL", "LIBRECHAT_MCP_PRODUCTS", "OPENCLAW_BASE_URL", "P4_STUB_API_BASE", "LIBRECHAT_MODELS", "OPENCLAW_RESPONSES_API", "OPENCLAW_CHANNEL_MOCK", "OPENCLAW_LOOP_DETECTION", "OPENCLAW_WEB_FETCH_ALLOWED_HOSTS", "OPENCLAW_WEB_FETCH_PRIVATE_NETWORK", "OPENCLAW_NIGHTLY_MODEL", "PRODUCTS_ROOT"];
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

  it("P4_NIGHTLY_PROVIDER: blank is gemma, deepseek is passed through, anything else throws without echoing", () => {
    assert.equal(loadProductConfig("litellm").nightlyProvider, "gemma");
    process.env.P4_NIGHTLY_PROVIDER = "deepseek";
    assert.equal(loadProductConfig("litellm").nightlyProvider, "deepseek");
    process.env.P4_NIGHTLY_PROVIDER = "ECHO-ME-NOT";
    assert.throws(() => loadProductConfig("litellm"), (err: Error) => {
      assert.match(err.message, /P4_NIGHTLY_PROVIDER/);
      assert.doesNotMatch(err.message, /ECHO-ME-NOT/);
      return true;
    });
  });

  it("keeps the agent hosts out of the fork-product cache", () => {
    assert.equal(P4_PRODUCT_IDS.some((id) => isForkProductId(id)), false);
    assert.equal(P4_PRODUCT_IDS.length, 7);
  });
});

describe("H2 config: P4_SECOND_IDENTITY is off by default and reaches the Nextcloud config", () => {
  it("is false when unset and true with exactly 1", () => {
    const saved = process.env.P4_SECOND_IDENTITY;
    try {
      delete process.env.P4_SECOND_IDENTITY;
      resetConfigCache();
      assert.equal(loadProductConfig("nextcloud").secondIdentity, false);
      process.env.P4_SECOND_IDENTITY = "1";
      resetConfigCache();
      assert.equal(loadProductConfig("nextcloud").secondIdentity, true);
    } finally {
      if (saved === undefined) delete process.env.P4_SECOND_IDENTITY;
      else process.env.P4_SECOND_IDENTITY = saved;
      resetConfigCache();
    }
  });
});

describe("H1 config: P4_MAIL is off by default, exactly 1 turns it on, and it reaches the Nextcloud config", () => {
  it("is false when unset, true with exactly 1, and throws without echoing any other value", () => {
    const saved = process.env.P4_MAIL;
    try {
      delete process.env.P4_MAIL;
      resetConfigCache();
      assert.equal(loadProductConfig("nextcloud").mail, false);
      process.env.P4_MAIL = "1";
      resetConfigCache();
      assert.equal(loadProductConfig("nextcloud").mail, true);
      process.env.P4_MAIL = "on-secret-x";
      resetConfigCache();
      assert.throws(() => loadProductConfig("nextcloud"), (error: Error) => {
        assert.match(error.message, /P4_MAIL_INVALID/);
        assert.equal(error.message.includes("on-secret-x"), false);
        return true;
      });
    } finally {
      if (saved === undefined) delete process.env.P4_MAIL;
      else process.env.P4_MAIL = saved;
      resetConfigCache();
    }
  });
});

describe("H3 config: LIBRECHAT_TOOL_APPROVAL is off by default and validated", () => {
  const KEYS_H3 = ["LIBRECHAT_TOOL_APPROVAL", "LIBRECHAT_TOOL_APPROVAL_MODE", "LIBRECHAT_TOOL_APPROVAL_ALLOW", "LIBRECHAT_TOOL_APPROVAL_DENY", "LIBRECHAT_TOOL_APPROVAL_ASK", "LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS"];
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = new Map<string, string | undefined>();
    for (const k of KEYS_H3) saved.set(k, process.env[k]);
    try {
      for (const k of KEYS_H3) delete process.env[k];
      for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
      resetConfigCache();
      fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetConfigCache();
    }
  };
  it("is null when unset", () => {
    withEnv({}, () => assert.equal(loadProductConfig("librechat").toolApproval, null));
  });
  it("builds the policy when on, with the rule lists", () => {
    withEnv(
      { LIBRECHAT_TOOL_APPROVAL: "1", LIBRECHAT_TOOL_APPROVAL_MODE: "dontAsk", LIBRECHAT_TOOL_APPROVAL_ASK: "mcp:twenty:*" },
      () => assert.deepEqual(loadProductConfig("librechat").toolApproval, { mode: "dontAsk", allow: [], deny: [], ask: ["mcp:twenty:*"], allowAlways: false }),
    );
  });
  it("allowAlways is false when unset and true only for exactly 1", () => {
    withEnv({ LIBRECHAT_TOOL_APPROVAL: "1" }, () => assert.equal(loadProductConfig("librechat").toolApproval?.allowAlways, false));
    withEnv({ LIBRECHAT_TOOL_APPROVAL: "1", LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: "1" }, () =>
      assert.equal(loadProductConfig("librechat").toolApproval?.allowAlways, true),
    );
  });
  it("rejects an invalid allowAlways value without echoing it", () => {
    withEnv({ LIBRECHAT_TOOL_APPROVAL: "1", LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: "zz-always" }, () =>
      assert.throws(
        () => loadProductConfig("librechat"),
        (error: Error) => {
          assert.match(error.message, /LIBRECHAT_TOOL_APPROVAL_INVALID/);
          assert.match(error.message, /LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS/);
          assert.equal(error.message.includes("zz-always"), false);
          return true;
        },
      ),
    );
  });
  it("refuses allowAlways when the flag is off, rather than ignoring it", () => {
    withEnv({ LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: "1" }, () =>
      assert.throws(() => loadProductConfig("librechat"), /LIBRECHAT_TOOL_APPROVAL_NEEDS_FLAG/),
    );
  });
  it("refuses allowAlways under mode dontAsk, where LibreChat ignores remembered choices", () => {
    withEnv({ LIBRECHAT_TOOL_APPROVAL: "1", LIBRECHAT_TOOL_APPROVAL_MODE: "dontAsk", LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: "1" }, () =>
      assert.throws(() => loadProductConfig("librechat"), /LIBRECHAT_TOOL_APPROVAL_INVALID: LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1 needs mode default or bypass/),
    );
  });
  it("refuses rules when the flag is off, rather than ignoring them", () => {
    withEnv({ LIBRECHAT_TOOL_APPROVAL_ASK: "mcp:*:*" }, () =>
      assert.throws(() => loadProductConfig("librechat"), /LIBRECHAT_TOOL_APPROVAL_NEEDS_FLAG/),
    );
  });
});

describe("H2 config: P4_SECOND_IDENTITY reaches Outline, Penpot, Mattermost and Twenty (off by default)", () => {
  it("is false when unset and true with exactly 1, for each product", () => {
    const saved = process.env.P4_SECOND_IDENTITY;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p4-h2-twenty-"));
    const savedTwenty = process.env.TWENTY_PRODUCT_DIR;
    try {
      process.env.TWENTY_PRODUCT_DIR = tmp;
      for (const product of ["outline", "penpot", "mattermost", "twenty"] as const) {
        delete process.env.P4_SECOND_IDENTITY;
        resetConfigCache();
        assert.equal((loadProductConfig(product) as unknown as { secondIdentity: boolean }).secondIdentity, false, `${product} unset`);
        process.env.P4_SECOND_IDENTITY = "1";
        resetConfigCache();
        assert.equal((loadProductConfig(product) as unknown as { secondIdentity: boolean }).secondIdentity, true, `${product} on`);
      }
      process.env.P4_SECOND_IDENTITY = "true";
      resetConfigCache();
      assert.throws(() => loadProductConfig("outline"), /P4_SECOND_IDENTITY_INVALID/);
    } finally {
      if (saved === undefined) delete process.env.P4_SECOND_IDENTITY;
      else process.env.P4_SECOND_IDENTITY = saved;
      if (savedTwenty === undefined) delete process.env.TWENTY_PRODUCT_DIR;
      else process.env.TWENTY_PRODUCT_DIR = savedTwenty;
      fs.rmSync(tmp, { recursive: true, force: true });
      resetConfigCache();
    }
  });
});

describe("H7 config: P4_SECOND_POSTS is off by default and needs P4_SECOND_IDENTITY", () => {
  it("is false when unset, true with 1 and the identity on, and throws without the identity", () => {
    const savedPosts = process.env.P4_SECOND_POSTS;
    const savedIdentity = process.env.P4_SECOND_IDENTITY;
    try {
      delete process.env.P4_SECOND_POSTS;
      delete process.env.P4_SECOND_IDENTITY;
      resetConfigCache();
      assert.equal((loadProductConfig("mattermost") as unknown as { secondPosts: boolean }).secondPosts, false);
      process.env.P4_SECOND_IDENTITY = "1";
      process.env.P4_SECOND_POSTS = "1";
      resetConfigCache();
      assert.equal((loadProductConfig("mattermost") as unknown as { secondPosts: boolean }).secondPosts, true);
      delete process.env.P4_SECOND_IDENTITY;
      resetConfigCache();
      assert.throws(() => loadProductConfig("mattermost"), /MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY/);
    } finally {
      if (savedPosts === undefined) delete process.env.P4_SECOND_POSTS;
      else process.env.P4_SECOND_POSTS = savedPosts;
      if (savedIdentity === undefined) delete process.env.P4_SECOND_IDENTITY;
      else process.env.P4_SECOND_IDENTITY = savedIdentity;
      resetConfigCache();
    }
  });
});

describe("H9 config: LIBRECHAT_MCP_RECORDING is off by default and validated", () => {
  const KEYS_H9 = ["LIBRECHAT_MCP_RECORDING"];
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = new Map<string, string | undefined>();
    for (const k of KEYS_H9) saved.set(k, process.env[k]);
    try {
      for (const k of KEYS_H9) delete process.env[k];
      for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
      resetConfigCache();
      fn();
    } finally {
      for (const k of KEYS_H9) {
        const prev = saved.get(k);
        if (prev === undefined) delete process.env[k];
        else process.env[k] = prev;
      }
      resetConfigCache();
    }
  };
  it("is off when unset, and on only for exactly 1", () => {
    withEnv({}, () => assert.equal(loadProductConfig("librechat").mcpRecording, false));
    withEnv({ LIBRECHAT_MCP_RECORDING: "1" }, () => assert.equal(loadProductConfig("librechat").mcpRecording, true));
  });
  it("rejects another value without echoing it", () => {
    withEnv({ LIBRECHAT_MCP_RECORDING: "zz-recording" }, () =>
      assert.throws(
        () => loadProductConfig("librechat"),
        (error: Error) => {
          assert.match(error.message, /LIBRECHAT_MCP_RECORDING_INVALID/);
          assert.equal(error.message.includes("zz-recording"), false);
          return true;
        },
      ),
    );
  });
});
