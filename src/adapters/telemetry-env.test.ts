import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import { calHeapEnv, calNodeHeapEnv } from "./cal.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { parseMedusaEnvFile } from "./medusa-env.js";
import {
  appendNodeOptions,
  documensoAppEnvWithPreload,
  elPreloadFromEnv,
  serverProcessEnv,
} from "./telemetry-env.js";

let tmp: string;
let preload: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-env-"));
  preload = path.join(tmp, "preload.cjs");
  fs.writeFileSync(preload, "// test preload\n");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("elPreloadFromEnv", () => {
  it("reads no preload when HARNESS_EL_PRELOAD is unset, blank or empty", () => {
    assert.equal(elPreloadFromEnv({}), undefined);
    assert.equal(elPreloadFromEnv({ HARNESS_EL_PRELOAD: "" }), undefined);
    assert.equal(elPreloadFromEnv({ HARNESS_EL_PRELOAD: "   " }), undefined);
  });

  it("throws for a bad preload or out path, and creates the out directory for a good one", () => {
    const out = path.join(tmp, "out");
    assert.throws(
      () => elPreloadFromEnv({ HARNESS_EL_PRELOAD: "preload.cjs", HARNESS_EL_OUT: out }),
      /^Error: HARNESS_EL_PRELOAD must be an absolute path to a readable file \(got "preload\.cjs"\)$/,
    );
    const missing = path.join(tmp, "missing.cjs");
    assert.throws(
      () => elPreloadFromEnv({ HARNESS_EL_PRELOAD: missing, HARNESS_EL_OUT: out }),
      /HARNESS_EL_PRELOAD must be an absolute path to a readable file/,
    );
    assert.throws(
      () => elPreloadFromEnv({ HARNESS_EL_PRELOAD: tmp, HARNESS_EL_OUT: out }),
      /HARNESS_EL_PRELOAD must be an absolute path to a readable file/,
    );
    const spaced = path.join(tmp, "with space.cjs");
    fs.writeFileSync(spaced, "");
    assert.throws(
      () => elPreloadFromEnv({ HARNESS_EL_PRELOAD: spaced, HARNESS_EL_OUT: out }),
      /HARNESS_EL_PRELOAD must not contain whitespace/,
    );
    assert.throws(
      () => elPreloadFromEnv({ HARNESS_EL_PRELOAD: preload }),
      /^Error: HARNESS_EL_OUT must be an absolute path when HARNESS_EL_PRELOAD is set$/,
    );
    const nested = path.join(tmp, "nested", "out");
    assert.deepEqual(elPreloadFromEnv({ HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: nested }), {
      preload,
      out: nested,
    });
    assert.equal(fs.statSync(nested).isDirectory(), true);
  });
});

describe("appendNodeOptions", () => {
  it("keeps the base flags and appends --require", () => {
    assert.equal(appendNodeOptions("--max-old-space-size=8192", "/p/el.cjs"), "--max-old-space-size=8192 --require=/p/el.cjs");
    assert.equal(appendNodeOptions(undefined, "/p/el.cjs"), "--require=/p/el.cjs");
    assert.equal(appendNodeOptions("  ", "/p/el.cjs"), "--require=/p/el.cjs");
  });
});

describe("Cal web env", () => {
  it("is byte-identical when off, and only the web server env carries the preload", () => {
    const heap = calHeapEnv({});
    assert.deepEqual(heap, { NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=8192" });
    assert.deepEqual(calNodeHeapEnv({}), heap);

    const out = path.join(tmp, "cal-out");
    const web = calNodeHeapEnv({ HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: out });
    assert.deepEqual(web, {
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: `--max-old-space-size=8192 --require=${preload}`,
      HARNESS_EL_OUT: out,
      HARNESS_EL_ROLE: "server",
    });
    // The other Cal callers keep the heap-only env, whatever the flag says.
    assert.equal(calHeapEnv({ HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: out }).HARNESS_EL_OUT, undefined);
  });
});

describe("serverProcessEnv", () => {
  it("returns the base env unchanged when off, and adds the keys for each Medusa backend when on", () => {
    const base = { DATABASE_URL: "postgres://medusa", NODE_OPTIONS: "--max-old-space-size=4096" };
    assert.equal(serverProcessEnv(base, "server", undefined), base);

    const out = path.join(tmp, "medusa-out");
    const el = { preload, out };
    assert.deepEqual(serverProcessEnv(base, "server", el), {
      DATABASE_URL: "postgres://medusa",
      NODE_OPTIONS: `--max-old-space-size=4096 --require=${preload}`,
      HARNESS_EL_OUT: out,
      HARNESS_EL_ROLE: "server",
    });
    assert.equal(serverProcessEnv(base, "server-2", el).HARNESS_EL_ROLE, "server-2");
  });
});

describe("documensoAppEnvWithPreload", () => {
  it("is byte-identical when off, and adds the preload keys when on", () => {
    const base = { PORT: "3001", NEXT_PUBLIC_WEBAPP_URL: "http://127.0.0.1:3001" };
    assert.equal(documensoAppEnvWithPreload(base, {}), base);

    const out = path.join(tmp, "documenso-out");
    assert.deepEqual(documensoAppEnvWithPreload(base, { HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: out }), {
      PORT: "3001",
      NEXT_PUBLIC_WEBAPP_URL: "http://127.0.0.1:3001",
      NODE_OPTIONS: `--require=${preload}`,
      HARNESS_EL_OUT: out,
      HARNESS_EL_ROLE: "server",
    });
  });
});

describe("Medusa pnpm env", () => {
  it("carries no --require when the preload flag is on: the pnpm runs take the backend .env only", () => {
    const productRoot = path.join(tmp, "medusa-dtc-starter");
    const backend = path.join(productRoot, "apps", "backend");
    fs.mkdirSync(backend, { recursive: true });
    const envText = "DATABASE_URL=postgres://medusa\nNODE_OPTIONS=--max-old-space-size=4096\n";
    fs.writeFileSync(path.join(backend, ".env"), envText);

    const saved = { HARNESS_EL_PRELOAD: process.env.HARNESS_EL_PRELOAD, HARNESS_EL_OUT: process.env.HARNESS_EL_OUT };
    process.env.HARNESS_EL_PRELOAD = preload;
    process.env.HARNESS_EL_OUT = path.join(tmp, "medusa-pnpm-out");
    try {
      const adapter = new MedusaAdapter({ baseUrl: "http://127.0.0.1:9000", productRoot } as MedusaConfig);
      const env = (adapter as unknown as { backendProcessEnv: () => Record<string, string> }).backendProcessEnv();
      assert.deepEqual(env, parseMedusaEnvFile(envText));
      assert.equal(env.NODE_OPTIONS, "--max-old-space-size=4096");
      assert.equal(
        Object.values(env).some((value) => value.includes("--require")),
        false,
      );
    } finally {
      for (const key of ["HARNESS_EL_PRELOAD", "HARNESS_EL_OUT"] as const) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    }
  });
});
