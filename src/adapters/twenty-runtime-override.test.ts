import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HARNESS_ROOT } from "../paths.js";
import { TWENTY_RESERVED_ENV, writeTwentyRuntimeOverride, type RuntimeOverrideFs } from "./twenty-runtime-override.js";

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

describe("writeTwentyRuntimeOverride with the opt-in canary", () => {
  const VALUE = "CANARY_TEST_VALUE_7f3a9c";
  const CANARY_ENV = { HARNESS_TWENTY_CANARY_NAME: "P5_CANARY_PROBE", HARNESS_TWENTY_CANARY_VALUE: VALUE };

  it("references the value by interpolation under server and worker, never the literal value", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({ env: CANARY_ENV, fs: fake });
    assert.equal(
      written.get(OVERRIDE_FILE),
      [
        "services:",
        "  server:",
        "    environment:",
        "      P5_CANARY_PROBE: ${HARNESS_TWENTY_CANARY_VALUE}",
        "  worker:",
        "    environment:",
        "      P5_CANARY_PROBE: ${HARNESS_TWENTY_CANARY_VALUE}",
        "",
      ].join("\n"),
    );
    assert.equal([...written.values()].join("").includes(VALUE), false);
  });

  it("writes a file when only the canary is set", () => {
    const { fake, calls } = fakeFs();
    assert.equal(writeTwentyRuntimeOverride({ env: CANARY_ENV, fs: fake }), OVERRIDE_FILE);
    assert.deepEqual(calls, [`mkdir ${path.dirname(OVERRIDE_FILE)}`, `write ${OVERRIDE_FILE}`]);
  });

  it("adds no canary key when the name is unset, even with a value", () => {
    const { fake, written } = fakeFs();
    assert.equal(writeTwentyRuntimeOverride({ env: { HARNESS_TWENTY_CANARY_VALUE: VALUE }, fs: fake }), undefined);
    assert.equal(written.size, 0);
  });

  it("makes zero fs calls for an invalid canary", () => {
    for (const env of [
      { HARNESS_TWENTY_CANARY_NAME: "bad-name", HARNESS_TWENTY_CANARY_VALUE: VALUE },
      { HARNESS_TWENTY_CANARY_NAME: "NODE_OPTIONS", HARNESS_TWENTY_CANARY_VALUE: VALUE },
      { HARNESS_TWENTY_CANARY_NAME: "P5_CANARY_PROBE" },
    ]) {
      const { fake, calls } = fakeFs();
      assert.throws(() => writeTwentyRuntimeOverride({ env, fs: fake }), /TWENTY_CANARY_/);
      assert.deepEqual(calls, []);
    }
  });

  it("refuses every harness-owned name as the canary name, with zero fs calls", () => {
    for (const name of ["OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS", "API_RATE_LIMITING_LONG_LIMIT", "NODE_OPTIONS", "HARNESS_EL_OUT", "HARNESS_EL_ROLE", "TWENTY_REQUIRE_FRESH", "HARNESS_TWENTY_CANARY_NAME", "HARNESS_TWENTY_CANARY_VALUE", "SERVER_URL", "EMAIL_DRIVER", "IS_EMAIL_VERIFICATION_REQUIRED"]) {
      assert.equal(TWENTY_RESERVED_ENV.has(name), true, name);
    }
    for (const name of TWENTY_RESERVED_ENV) {
      const { fake, calls } = fakeFs();
      assert.throws(
        () => writeTwentyRuntimeOverride({ env: { HARNESS_TWENTY_CANARY_NAME: name, HARNESS_TWENTY_CANARY_VALUE: VALUE }, fs: fake }),
        /TWENTY_CANARY_NAME_RESERVED/,
        name,
      );
      assert.deepEqual(calls, [], name);
    }
  });
});

describe("writeTwentyRuntimeOverride with LOGIC_FUNCTION_TYPE", () => {
  it("renders the bare key under server and worker when set to local", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({ env: { LOGIC_FUNCTION_TYPE: "local" }, fs: fake });
    assert.equal(
      written.get(OVERRIDE_FILE),
      [
        "services:",
        "  server:",
        "    environment:",
        "      LOGIC_FUNCTION_TYPE:",
        "  worker:",
        "    environment:",
        "      LOGIC_FUNCTION_TYPE:",
        "",
      ].join("\n"),
    );
  });

  it("renders no key when unset or blank", () => {
    for (const env of [{}, { LOGIC_FUNCTION_TYPE: "" }, { LOGIC_FUNCTION_TYPE: "   " }]) {
      const { fake, written } = fakeFs();
      assert.equal(writeTwentyRuntimeOverride({ env, fs: fake }), undefined);
      assert.equal(written.size, 0);
    }
  });

  it("accepts LOCAL and local alike", () => {
    for (const value of ["LOCAL", "local", "Lambda", "disabled"]) {
      const { fake, written } = fakeFs();
      writeTwentyRuntimeOverride({ env: { LOGIC_FUNCTION_TYPE: value }, fs: fake });
      assert.match(written.get(OVERRIDE_FILE) ?? "", /^ {6}LOGIC_FUNCTION_TYPE:$/m, value);
    }
  });

  it("does not trim a non-blank value: a padded local is refused with zero fs calls", () => {
    const { fake, calls } = fakeFs();
    assert.throws(
      () => writeTwentyRuntimeOverride({ env: { LOGIC_FUNCTION_TYPE: " local " }, fs: fake }),
      /TWENTY_LOGIC_FUNCTION_TYPE_INVALID/,
    );
    assert.deepEqual(calls, []);
  });

  it("throws TWENTY_LOGIC_FUNCTION_TYPE_INVALID before any file system call for a bogus value", () => {
    const { fake, calls } = fakeFs();
    assert.throws(
      () => writeTwentyRuntimeOverride({ env: { LOGIC_FUNCTION_TYPE: "bogus" }, fs: fake }),
      (err: unknown) =>
        err instanceof Error &&
        /^TWENTY_LOGIC_FUNCTION_TYPE_INVALID: LOGIC_FUNCTION_TYPE must be one of DISABLED, LAMBDA, LOCAL/.test(err.message),
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
