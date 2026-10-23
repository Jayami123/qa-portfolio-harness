import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadConfig, resetConfigCache } from "./config.js";

const PRODUCT_DIR_KEYS = ["CAL_PRODUCT_DIR", "DOCUMENSO_PRODUCT_DIR", "MEDUSA_PRODUCT_DIR", "TWENTY_PRODUCT_DIR"];
const KEYS = [...PRODUCT_DIR_KEYS, "MEDUSA_SECOND_BASE_URL"];

describe("loadConfig second Medusa backend", () => {
  const saved = new Map<string, string | undefined>();
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-"));
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
    }
    for (const key of PRODUCT_DIR_KEYS) {
      process.env[key] = dir;
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
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("loads as unset when MEDUSA_SECOND_BASE_URL is blank", () => {
    process.env.MEDUSA_SECOND_BASE_URL = "";
    resetConfigCache();
    assert.equal(loadConfig().medusa.secondBaseUrl, undefined);
  });

  it("loads as unset when MEDUSA_SECOND_BASE_URL is not in env", () => {
    delete process.env.MEDUSA_SECOND_BASE_URL;
    resetConfigCache();
    assert.equal(loadConfig().medusa.secondBaseUrl, undefined);
  });

  it("keeps a set second URL without a trailing slash", () => {
    process.env.MEDUSA_SECOND_BASE_URL = "http://127.0.0.1:9001/";
    resetConfigCache();
    assert.equal(loadConfig().medusa.secondBaseUrl, "http://127.0.0.1:9001");
  });
});
