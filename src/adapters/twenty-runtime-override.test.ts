import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HARNESS_ROOT } from "../paths.js";
import { writeTwentyRuntimeOverride, type RuntimeOverrideFs } from "./twenty-runtime-override.js";

const OVERRIDE_FILE = path.join(HARNESS_ROOT, ".harness", "twenty.runtime.compose.yml");

function fakeFs() {
  const calls: string[] = [];
  const written = new Map<string, string>();
  const fake: RuntimeOverrideFs = {
    writeFileSync(file, text) {
      calls.push(`write ${file}`);
      written.set(file, text);
    },
    rmSync(file) {
      calls.push(`rm ${file}`);
    },
    mkdirSync(dir) {
      calls.push(`mkdir ${dir}`);
    },
    chmodSync(dir, mode) {
      calls.push(`chmod ${dir} ${mode.toString(8)}`);
    },
  };
  return { fake, calls, written };
}

describe("writeTwentyRuntimeOverride", () => {
  it("writes nothing and removes a stale file when no key is needed", () => {
    for (const env of [{}, { API_RATE_LIMITING_SHORT_LIMIT: "" }, { API_RATE_LIMITING_SHORT_LIMIT: "  " }]) {
      const { fake, calls, written } = fakeFs();
      assert.equal(writeTwentyRuntimeOverride({ env, fs: fake }), undefined);
      assert.deepEqual(calls, [`rm ${OVERRIDE_FILE}`]);
      assert.equal(written.size, 0);
    }
  });

  it("writes the server and worker limits with exact values", () => {
    const { fake, calls, written } = fakeFs();
    const file = writeTwentyRuntimeOverride({
      env: { API_RATE_LIMITING_SHORT_LIMIT: "500", APPLICATION_API_RATE_LIMITING_LIMIT: "700" },
      fs: fake,
    });
    assert.equal(file, OVERRIDE_FILE);
    assert.deepEqual(calls, [`mkdir ${path.dirname(OVERRIDE_FILE)}`, `write ${OVERRIDE_FILE}`]);
    assert.equal(
      written.get(OVERRIDE_FILE),
      [
        "services:",
        "  server:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        '      APPLICATION_API_RATE_LIMITING_LIMIT: "700"',
        "  worker:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        '      APPLICATION_API_RATE_LIMITING_LIMIT: "700"',
        "",
      ].join("\n"),
    );
  });

  it("throws before any write when a value is invalid", () => {
    const { fake, calls } = fakeFs();
    assert.throws(
      () => writeTwentyRuntimeOverride({ env: { API_RATE_LIMITING_LONG_LIMIT: "0" }, fs: fake }),
      /^Error: TWENTY_RATE_LIMIT_NOT_INTEGER: API_RATE_LIMITING_LONG_LIMIT must be/,
    );
    assert.deepEqual(calls, []);
  });
});

describe("writeTwentyRuntimeOverride with the event-loop preload", () => {
  let tmp: string;
  let preload: string;
  let out: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-override-"));
    preload = path.join(tmp, "preload.cjs");
    fs.writeFileSync(preload, "// test preload\n");
    out = path.join(tmp, "el-out");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("mounts the preload read-only and the out directory read-write for server and worker", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({
      env: { HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: out },
      fs: fake,
    });
    assert.equal(
      written.get(OVERRIDE_FILE),
      [
        "services:",
        "  server:",
        "    environment:",
        '      NODE_OPTIONS: "--require=/harness/el/preload.cjs"',
        '      HARNESS_EL_OUT: "/harness/el-out"',
        '      HARNESS_EL_ROLE: "server"',
        "    volumes:",
        `      - '${preload}:/harness/el/preload.cjs:ro'`,
        `      - '${out}:/harness/el-out'`,
        "  worker:",
        "    environment:",
        '      NODE_OPTIONS: "--require=/harness/el/preload.cjs"',
        '      HARNESS_EL_OUT: "/harness/el-out"',
        '      HARNESS_EL_ROLE: "worker"',
        "    volumes:",
        `      - '${preload}:/harness/el/preload.cjs:ro'`,
        `      - '${out}:/harness/el-out'`,
        "",
      ].join("\n"),
    );
  });

  it("makes the out directory mode 0777 before the override is written", () => {
    const { fake, calls } = fakeFs();
    writeTwentyRuntimeOverride({
      env: { HARNESS_EL_PRELOAD: preload, HARNESS_EL_OUT: out },
      fs: fake,
    });
    assert.deepEqual(calls, [
      `mkdir ${path.dirname(OVERRIDE_FILE)}`,
      `chmod ${out} 777`,
      `write ${OVERRIDE_FILE}`,
    ]);
  });
});
