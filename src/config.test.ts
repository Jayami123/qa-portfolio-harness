import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getAdapter } from "./adapters/registry.js";
import {
  documensoMailApiUrl,
  getProductConfig,
  loadConfig,
  resetConfigCache,
  resolveProductsRoot,
  twentyMailApiUrl,
} from "./config.js";
import { HARNESS_ROOT } from "./paths.js";

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

describe("resolveProductsRoot", () => {
  it("unset: resolves ../products next to the current directory", () => {
    assert.equal(resolveProductsRoot(undefined, "/tmp/ws/repo"), path.resolve("/tmp/ws/products"));
  });

  it("unset inside node_modules throws PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES", () => {
    assert.throws(
      () => resolveProductsRoot(undefined, "/tmp/ws/consumer/node_modules/qa-portfolio-harness"),
      /PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES/,
    );
  });

  it("unset: a segment that only contains node_modules does not match", () => {
    assert.equal(
      resolveProductsRoot(undefined, "/tmp/ws/my_node_modules/repo"),
      path.resolve("/tmp/ws/my_node_modules/products"),
    );
  });

  it("set: the value is used as given, even when the current directory is inside node_modules", () => {
    assert.equal(resolveProductsRoot("/abs/products", "/tmp/ws/consumer/node_modules/x"), "/abs/products");
  });

  it("set relative: resolved against process.cwd, not the cwd argument (today's behaviour)", () => {
    // Relative values keep today's behaviour: they resolve against process.cwd(), not the cwd argument.
    assert.equal(resolveProductsRoot("../p", "/tmp/ws/repo"), path.resolve("../p"));
  });
});

describe("loadConfig PRODUCTS_ROOT default", () => {
  const saved = new Map<string, string | undefined>();
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-products-"));
    for (const key of [...PRODUCT_DIR_KEYS, "PRODUCTS_ROOT"]) {
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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a blank PRODUCTS_ROOT uses the default ../products of the current directory", () => {
    process.env.PRODUCTS_ROOT = "";
    resetConfigCache();
    assert.equal(loadConfig().productsRoot, path.resolve(process.cwd(), "..", "products"));
  });

  it("a set PRODUCTS_ROOT is used as given", () => {
    process.env.PRODUCTS_ROOT = dir;
    resetConfigCache();
    assert.equal(loadConfig().productsRoot, dir);
  });
});

describe("documensoMailApiUrl", () => {
  it("points at the Inbucket host port published by docker/documenso.compose.yml", () => {
    const compose = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "documenso.compose.yml"), "utf8");
    const port = /"127\.0\.0\.1:(\d+):9000"/.exec(compose);
    assert.ok(port, "inbucket REST port mapping not found in documenso.compose.yml");
    assert.equal(documensoMailApiUrl, `http://127.0.0.1:${port[1]}/api/v1/mailbox`);
  });
});

describe("twentyMailApiUrl", () => {
  it("points at the Mailpit host port published by docker/twenty.compose.yml", () => {
    const compose = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "twenty.compose.yml"), "utf8");
    const port = /"(?:127\.0\.0\.1:)?(\d+):8025"/.exec(compose);
    assert.ok(port, "Mailpit UI port mapping (8025) not found in twenty.compose.yml");
    assert.equal(twentyMailApiUrl, `http://127.0.0.1:${port[1]}/api/v1`);
  });
});

describe("CAL_DB_URL default", () => {
  it("is the harness Cal Postgres on 127.0.0.1:5450 when unset", () => {
    const saved = process.env.CAL_DB_URL;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-cal-"));
    const keys = PRODUCT_DIR_KEYS.map((key) => [key, process.env[key]] as const);
    try {
      delete process.env.CAL_DB_URL;
      for (const key of PRODUCT_DIR_KEYS) {
        process.env[key] = dir;
      }
      resetConfigCache();
      assert.equal(loadConfig().cal.dbUrl, "postgresql://postgres:@127.0.0.1:5450/calendso");
    } finally {
      if (saved === undefined) {
        delete process.env.CAL_DB_URL;
      } else {
        process.env.CAL_DB_URL = saved;
      }
      for (const [key, value] of keys) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lazy product roots (getProductConfig, getAdapter)", () => {
  const saved = new Map<string, string | undefined>();
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lazy-roots-"));
    for (const key of [...PRODUCT_DIR_KEYS, "PRODUCTS_ROOT"]) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.PRODUCTS_ROOT = root;
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
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("only documenso exists: getProductConfig('documenso') returns its root", () => {
    fs.mkdirSync(path.join(root, "documenso"));
    assert.equal(getProductConfig("documenso").productRoot, path.resolve(root, "documenso"));
  });

  it("only documenso exists: getProductConfig('cal') throws the Cal root error", () => {
    fs.mkdirSync(path.join(root, "documenso"));
    assert.throws(() => getProductConfig("cal"), /Cal product root does not exist/);
  });

  it("only documenso exists: getAdapter('documenso') builds without the sibling roots", () => {
    fs.mkdirSync(path.join(root, "documenso"));
    assert.equal(getAdapter("documenso").id, "documenso");
  });

  it("only documenso exists: getAdapter('cal') throws the Cal root error", () => {
    fs.mkdirSync(path.join(root, "documenso"));
    assert.throws(() => getAdapter("cal"), /Cal product root does not exist/);
  });

  it("only cal exists: getProductConfig('cal') returns its root", () => {
    fs.mkdirSync(path.join(root, "cal"));
    assert.equal(getProductConfig("cal").productRoot, path.resolve(root, "cal"));
  });

  it("only cal exists: getProductConfig('documenso') throws the Documenso root error", () => {
    fs.mkdirSync(path.join(root, "cal"));
    assert.throws(() => getProductConfig("documenso"), /Documenso product root does not exist/);
  });

  it("only cal exists: getAdapter('cal') builds without the sibling roots", () => {
    fs.mkdirSync(path.join(root, "cal"));
    assert.equal(getAdapter("cal").id, "cal");
  });

  it("loadConfig() stays eager: with only documenso, it still throws the Cal root error", () => {
    fs.mkdirSync(path.join(root, "documenso"));
    assert.throws(() => loadConfig(), /Cal product root does not exist/);
  });
});
