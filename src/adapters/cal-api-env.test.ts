import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCalApiEnv,
  CAL_API_NO_FALLBACK_KEYS,
  describeCalApiEnv,
  generateTestSecret,
} from "./cal-api-env.js";

const ROOT = {
  DATABASE_URL: "postgresql://postgres:@localhost:5450/calendso",
  NEXTAUTH_SECRET: "web-nextauth-value",
  CALENDSO_ENCRYPTION_KEY: "web-encryption-value",
};
const EXTERNAL = { STRIPE_API_KEY: "sk_test_fixture_key", STRIPE_WEBHOOK_SECRET: "whsec_fixture" };

function input(overrides: Partial<Parameters<typeof buildCalApiEnv>[0]> = {}) {
  return {
    rootEnv: { ...ROOT, STRIPE_WEBHOOK_SECRET: EXTERNAL.STRIPE_WEBHOOK_SECRET },
    processEnv: { STRIPE_API_KEY: EXTERNAL.STRIPE_API_KEY } as NodeJS.ProcessEnv,
    apiPort: 5555,
    redisUrl: "redis://127.0.0.1:6381",
    ...overrides,
  };
}

describe("CAL_API_NO_FALLBACK_KEYS", () => {
  it("names every key the fork reads with no fallback, with its source line", () => {
    assert.deepEqual(
      CAL_API_NO_FALLBACK_KEYS.map((k) => k.key),
      [
        "DATABASE_READ_URL",
        "DATABASE_WRITE_URL",
        "REDIS_URL",
        "NEXTAUTH_SECRET",
        "STRIPE_API_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "JWT_SECRET",
      ],
    );
    for (const k of CAL_API_NO_FALLBACK_KEYS) {
      assert.match(k.source, /^apps\/api\/v2\/src\/.+:\d+$/);
    }
  });
});

describe("buildCalApiEnv", () => {
  it("puts every required key in the spawn env", () => {
    const env = buildCalApiEnv(input());
    for (const { key } of CAL_API_NO_FALLBACK_KEYS) {
      assert.ok(env[key] !== undefined, `missing ${key}`);
    }
    assert.equal(env.API_PORT, "5555");
  });

  it("gives shared keys the web's own values", () => {
    const env = buildCalApiEnv(input());
    assert.equal(env.NEXTAUTH_SECRET, ROOT.NEXTAUTH_SECRET);
    assert.equal(env.DATABASE_READ_URL, ROOT.DATABASE_URL);
    assert.equal(env.DATABASE_WRITE_URL, ROOT.DATABASE_URL);
  });

  it("keeps an explicit DB read URL from the root env over the fallback", () => {
    const env = buildCalApiEnv(input({ rootEnv: { ...ROOT, DATABASE_READ_URL: "postgresql://replica", STRIPE_WEBHOOK_SECRET: "whsec_fixture" } }));
    assert.equal(env.DATABASE_READ_URL, "postgresql://replica");
    assert.equal(env.DATABASE_WRITE_URL, ROOT.DATABASE_URL);
  });

  it("generates JWT_SECRET, and the values differ between runs", () => {
    const a = buildCalApiEnv(input());
    const b = buildCalApiEnv(input());
    assert.match(a.JWT_SECRET ?? "", /^[0-9a-f]{64}$/);
    assert.notEqual(a.JWT_SECRET, b.JWT_SECRET);
  });

  it("uses the injected generator for JWT_SECRET", () => {
    const env = buildCalApiEnv(input({ randomSecret: () => "fixed-test-value" }));
    assert.equal(env.JWT_SECRET, "fixed-test-value");
  });

  it("takes an external credential from the process env, then the root env", () => {
    const env = buildCalApiEnv(input({ processEnv: {} as NodeJS.ProcessEnv, rootEnv: { ...ROOT, STRIPE_API_KEY: "sk_root", STRIPE_WEBHOOK_SECRET: "whsec_fixture" } }));
    assert.equal(env.STRIPE_API_KEY, "sk_root");
  });

  it("throws naming the missing external key, and never a value, when no credential exists", () => {
    assert.throws(
      () => buildCalApiEnv(input({ processEnv: {} as NodeJS.ProcessEnv })),
      (error: unknown) => {
        const message = String((error as Error).message);
        return message.includes("STRIPE_API_KEY") && !message.includes("sk_test_fixture_key");
      },
    );
  });

  it("names a missing shared key without generating it", () => {
    assert.throws(() => buildCalApiEnv(input({ rootEnv: { STRIPE_WEBHOOK_SECRET: "x" } })), /NEXTAUTH_SECRET/);
  });
});

describe("log safety", () => {
  it("never prints a generated or external value", () => {
    const env = buildCalApiEnv(input({ randomSecret: () => "GENERATED_MARKER_9f2c" }));
    const text = describeCalApiEnv(env);
    assert.equal(text.includes("GENERATED_MARKER_9f2c"), false);
    assert.equal(text.includes("sk_test_fixture_key"), false);
    assert.equal(text.includes("whsec_fixture"), false);
    assert.match(text, /JWT_SECRET=<redacted>/);
    assert.match(text, /STRIPE_API_KEY=<redacted>/);
    assert.match(text, /REDIS_URL=redis:\/\/127\.0\.0\.1:6381/);
  });

  it("generateTestSecret returns a fresh 32-byte hex value each call", () => {
    assert.notEqual(generateTestSecret(), generateTestSecret());
  });
});
