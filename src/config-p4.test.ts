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
