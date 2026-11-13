import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { twentyRuntimeOverrideYaml, TWENTY_RESERVED_ENV, writeTwentyRuntimeOverride, type RuntimeOverrideFs } from "./twenty-runtime-override.js";
import {
  assertTwentyBooleanPassthrough,
  readTwentyPassthroughNames,
  TWENTY_BOOLEAN_PASSTHROUGH,
  TWENTY_PASSTHROUGH_ENV,
} from "./twenty-passthrough.js";
import { CANARY_NAME_ENV, CANARY_VALUE_ENV, readTwentyCanary } from "./twenty-canary.js";

function fakeFs(): { fake: RuntimeOverrideFs; calls: string[]; written: Map<string, string> } {
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
    chmodSync(dir) {
      calls.push(`chmod ${dir}`);
    },
  };
  return { fake, calls, written };
}

describe("TWENTY_PASSTHROUGH_ENV", () => {
  it("lists each forwarded name once, in the confirmed order", () => {
    assert.deepEqual(TWENTY_PASSTHROUGH_ENV, [
      "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS",
      "IS_BILLING_ENABLED",
      "IS_MULTIWORKSPACE_ENABLED",
      "BILLING_STRIPE_API_KEY",
      "BILLING_STRIPE_WEBHOOK_SECRET",
      "BILLING_STRIPE_PUBLISHABLE_KEY",
      "LOGIC_FUNCTION_TYPE",
      "IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS",
      "IS_CONFIG_VARIABLES_IN_DB_ENABLED",
    ]);
    assert.equal(new Set(TWENTY_PASSTHROUGH_ENV).size, TWENTY_PASSTHROUGH_ENV.length);
  });
});

describe("readTwentyPassthroughNames", () => {
  it("returns nothing when unset, empty or whitespace", () => {
    assert.deepEqual(readTwentyPassthroughNames({}), []);
    assert.deepEqual(
      readTwentyPassthroughNames({ IS_BILLING_ENABLED: "", BILLING_STRIPE_API_KEY: "   " }),
      [],
    );
  });

  it("returns set names in allowlist order, not env order", () => {
    assert.deepEqual(
      readTwentyPassthroughNames({
        BILLING_STRIPE_WEBHOOK_SECRET: "x",
        OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS: "host.docker.internal",
      }),
      ["OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS", "BILLING_STRIPE_WEBHOOK_SECRET"],
    );
  });
});

describe("twentyRuntimeOverrideYaml byte-identical default", () => {
  it("is undefined with no limits, no preload and no pass-through names (v0.2.18 output)", () => {
    assert.equal(twentyRuntimeOverrideYaml({}, undefined), undefined);
    assert.equal(twentyRuntimeOverrideYaml({}, undefined, []), undefined);
  });

  it("keeps the v0.2.18 rate-limit output exactly when no pass-through name is set", () => {
    assert.equal(
      twentyRuntimeOverrideYaml({ API_RATE_LIMITING_SHORT_LIMIT: "500" }, undefined, []),
      [
        "services:",
        "  server:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        "  worker:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        "",
      ].join("\n"),
    );
  });
});

describe("writeTwentyRuntimeOverride with pass-through names", () => {
  it("writes nothing and removes a stale file when none of the names are set", () => {
    const { fake, calls, written } = fakeFs();
    assert.equal(writeTwentyRuntimeOverride({ env: { IS_BILLING_ENABLED: "" }, fs: fake }), undefined);
    assert.equal(written.size, 0);
    assert.equal(calls.filter((c) => c.startsWith("write")).length, 0);
  });

  it("lists the name without any value, for server and worker", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({
      env: { OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS: "host.docker.internal,172.18.0.1" },
      fs: fake,
    });
    const yaml = [...written.values()][0] ?? "";
    assert.equal(
      yaml,
      [
        "services:",
        "  server:",
        "    environment:",
        "      OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS:",
        "  worker:",
        "    environment:",
        "      OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS:",
        "",
      ].join("\n"),
    );
  });

  it("never writes a secret value to the override file", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({
      env: { BILLING_STRIPE_API_KEY: "sk_test_FAKE_SECRET_123", BILLING_STRIPE_WEBHOOK_SECRET: "whsec_FAKE_SECRET_456" },
      fs: fake,
    });
    const yaml = [...written.values()][0] ?? "";
    assert.equal(yaml.includes("FAKE_SECRET"), false);
    assert.equal(yaml.includes("sk_test"), false);
    assert.equal(yaml.includes("BILLING_STRIPE_API_KEY:"), true);
  });
});

describe("twentyRuntimeOverrideYaml snapshot with rate limits and pass-through", () => {
  it("writes the rate limit and the pass-through names, in order, with no value for the names", () => {
    assert.equal(
      twentyRuntimeOverrideYaml({ API_RATE_LIMITING_SHORT_LIMIT: "500" }, undefined, ["IS_BILLING_ENABLED", "BILLING_STRIPE_API_KEY"]),
      [
        "services:",
        "  server:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        "      IS_BILLING_ENABLED:",
        "      BILLING_STRIPE_API_KEY:",
        "  worker:",
        "    environment:",
        '      API_RATE_LIMITING_SHORT_LIMIT: "500"',
        "      IS_BILLING_ENABLED:",
        "      BILLING_STRIPE_API_KEY:",
        "",
      ].join("\n"),
    );
  });
});

describe("IS_MULTIWORKSPACE_ENABLED passthrough", () => {
  it("is forwarded only when set to a non-blank value", () => {
    assert.deepEqual(readTwentyPassthroughNames({ IS_MULTIWORKSPACE_ENABLED: "true" }), ["IS_MULTIWORKSPACE_ENABLED"]);
    assert.deepEqual(readTwentyPassthroughNames({ IS_MULTIWORKSPACE_ENABLED: "   " }), []);
    assert.deepEqual(readTwentyPassthroughNames({}), []);
  });
});

const NEW_FLAGS = ["IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS", "IS_CONFIG_VARIABLES_IN_DB_ENABLED"] as const;

describe("workspace-creation and config-db flag passthroughs", () => {
  it("are forwarded only when set to a non-blank value (set, blank, unset)", () => {
    for (const name of NEW_FLAGS) {
      assert.deepEqual(readTwentyPassthroughNames({ [name]: "false" }), [name]);
      assert.deepEqual(readTwentyPassthroughNames({ [name]: "   " }), []);
      assert.deepEqual(readTwentyPassthroughNames({}), []);
    }
  });

  it("are the only boolean passthroughs, and both are in the allowlist", () => {
    assert.deepEqual([...TWENTY_BOOLEAN_PASSTHROUGH], [...NEW_FLAGS]);
    for (const name of NEW_FLAGS) {
      assert.ok(TWENTY_PASSTHROUGH_ENV.includes(name));
    }
  });

  it("accept exactly true and false", () => {
    for (const name of NEW_FLAGS) {
      for (const ok of ["true", "false"]) {
        assert.doesNotThrow(() => assertTwentyBooleanPassthrough({ [name]: ok }));
      }
    }
    assert.doesNotThrow(() => assertTwentyBooleanPassthrough({}));
    assert.doesNotThrow(() => assertTwentyBooleanPassthrough({ IS_CONFIG_VARIABLES_IN_DB_ENABLED: "" }));
  });

  for (const bad of ["False", "1", "maybe"]) {
    it(`throws TWENTY_FLAG_INVALID, naming the variable and not the value, for ${JSON.stringify(bad)}`, () => {
      for (const name of NEW_FLAGS) {
        assert.throws(
          () => assertTwentyBooleanPassthrough({ [name]: bad }),
          (err: Error) =>
            err.message.startsWith("TWENTY_FLAG_INVALID") &&
            err.message.includes(name) &&
            !err.message.includes(bad),
        );
      }
    });
  }

  // The message text contains "true", so a value check cannot tell an echoed value from the template for these two.
  // They are checked by name only; they still throw because the raw value is not exactly "true".
  for (const bad of [" true", "true "]) {
    it(`throws TWENTY_FLAG_INVALID, naming the variable, for ${JSON.stringify(bad)} (raw value, no trim)`, () => {
      for (const name of NEW_FLAGS) {
        assert.throws(
          () => assertTwentyBooleanPassthrough({ [name]: bad }),
          (err: Error) => err.message.startsWith("TWENTY_FLAG_INVALID") && err.message.includes(name),
        );
      }
    });
  }

  it("writes nothing when a boolean flag is invalid (up stops before any file is touched)", () => {
    const { fake, calls, written } = fakeFs();
    assert.throws(
      () =>
        writeTwentyRuntimeOverride({
          env: { IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: "maybe" },
          fs: fake,
        }),
      /TWENTY_FLAG_INVALID/,
    );
    assert.equal(calls.length, 0);
    assert.equal(written.size, 0);
  });

  it("lists both names in server and worker with no value", () => {
    const { fake, written } = fakeFs();
    writeTwentyRuntimeOverride({
      env: { IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: "false", IS_CONFIG_VARIABLES_IN_DB_ENABLED: "false" },
      fs: fake,
    });
    const yaml = [...written.values()][0] ?? "";
    assert.equal(
      yaml,
      [
        "services:",
        "  server:",
        "    environment:",
        "      IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS:",
        "      IS_CONFIG_VARIABLES_IN_DB_ENABLED:",
        "  worker:",
        "    environment:",
        "      IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS:",
        "      IS_CONFIG_VARIABLES_IN_DB_ENABLED:",
        "",
      ].join("\n"),
    );
    assert.equal(yaml.includes("false"), false);
  });

  it("are harness-reserved, so a canary cannot use them", () => {
    for (const name of NEW_FLAGS) {
      assert.ok(TWENTY_RESERVED_ENV.has(name), `${name} must be reserved`);
      assert.throws(
        () =>
          readTwentyCanary(
            { [CANARY_NAME_ENV]: name, [CANARY_VALUE_ENV]: "placeholder-value" } as NodeJS.ProcessEnv,
            TWENTY_RESERVED_ENV,
          ),
        /TWENTY_CANARY_NAME_RESERVED/,
      );
    }
  });
});

