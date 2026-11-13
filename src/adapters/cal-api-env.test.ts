import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCalApiEnv,
  CAL_API_NO_FALLBACK_KEYS,
  calApiKeyRateLimit,
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
    dbUrl: "postgresql://postgres:@127.0.0.1:5450/calendso",
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
        "CALENDSO_ENCRYPTION_KEY",
        "STRIPE_API_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "JWT_SECRET",
        "NODE_ENV",
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
    assert.equal(env.NODE_ENV, "production");
  });

  it("never lets a shared web secret or DB URL into the log-safe view", () => {
    const text = describeCalApiEnv(buildCalApiEnv(input()));
    assert.equal(text.includes(ROOT.NEXTAUTH_SECRET), false);
    assert.equal(text.includes(ROOT.DATABASE_URL), false);
    assert.match(text, /NEXTAUTH_SECRET=<redacted>/);
    assert.match(text, /NODE_ENV=production/);
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

describe("DATABASE_URL and CALENDSO_ENCRYPTION_KEY in the API spawn env", () => {
  it("sets DATABASE_URL from the harness dbUrl, not from the product root DATABASE_URL", () => {
    const env = buildCalApiEnv(input({ dbUrl: "postgresql://postgres:@127.0.0.1:5450/calendso" }));
    assert.equal(env.DATABASE_URL, "postgresql://postgres:@127.0.0.1:5450/calendso");
    assert.notEqual(env.DATABASE_URL, ROOT.DATABASE_URL);
  });

  it("takes CALENDSO_ENCRYPTION_KEY from the product root .env (shared value)", () => {
    const env = buildCalApiEnv(input());
    assert.equal(env.CALENDSO_ENCRYPTION_KEY, ROOT.CALENDSO_ENCRYPTION_KEY);
  });

  it("describeCalApiEnv never prints the DATABASE_URL value", () => {
    const env = buildCalApiEnv(input({ dbUrl: "postgresql://postgres:s3cret-pass@127.0.0.1:5450/calendso" }));
    const described = describeCalApiEnv(env);
    assert.doesNotMatch(described, /s3cret-pass/);
    assert.match(described, /DATABASE_URL=<redacted>/);
  });
});

describe("rate-limit forwarding into the API spawn env", () => {
  const withRate = (rate: Record<string, string>) =>
    input({ processEnv: { STRIPE_API_KEY: EXTERNAL.STRIPE_API_KEY, ...rate } as NodeJS.ProcessEnv });

  it("forwards RATE_LIMIT_DEFAULT_LIMIT_API_KEY and RATE_LIMIT_DEFAULT_TTL_MS when set", () => {
    const env = buildCalApiEnv(
      withRate({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: "121", RATE_LIMIT_DEFAULT_TTL_MS: "60000" }),
    );
    assert.equal(env.RATE_LIMIT_DEFAULT_LIMIT_API_KEY, "121");
    assert.equal(env.RATE_LIMIT_DEFAULT_TTL_MS, "60000");
  });

  it("omits both keys when unset, so the fork default applies", () => {
    const env = buildCalApiEnv(input());
    assert.equal("RATE_LIMIT_DEFAULT_LIMIT_API_KEY" in env, false);
    assert.equal("RATE_LIMIT_DEFAULT_TTL_MS" in env, false);
  });

  it("treats a blank value as unset", () => {
    const env = buildCalApiEnv(withRate({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: "  ", RATE_LIMIT_DEFAULT_TTL_MS: "" }));
    assert.equal("RATE_LIMIT_DEFAULT_LIMIT_API_KEY" in env, false);
    assert.equal("RATE_LIMIT_DEFAULT_TTL_MS" in env, false);
  });

  for (const bad of ["0", "-3", "1.5", "7x9q", "abc"]) {
    it(`throws naming the key, not the value, for ${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => buildCalApiEnv(withRate({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: bad })),
        (err: Error) =>
          err.message.includes("RATE_LIMIT_DEFAULT_LIMIT_API_KEY") && !err.message.includes(bad),
      );
    });
  }

  it("names the TTL key, not its value, when it is invalid", () => {
    assert.throws(
      () => buildCalApiEnv(withRate({ RATE_LIMIT_DEFAULT_TTL_MS: "soon-7q" })),
      (err: Error) => err.message.includes("RATE_LIMIT_DEFAULT_TTL_MS") && !err.message.includes("soon-7q"),
    );
  });

  it("describeCalApiEnv redacts the forwarded limit and TTL", () => {
    const env = buildCalApiEnv(
      withRate({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: "7331", RATE_LIMIT_DEFAULT_TTL_MS: "424242" }),
    );
    const shown = describeCalApiEnv(env);
    assert.equal(shown.includes("7331"), false);
    assert.equal(shown.includes("424242"), false);
    assert.ok(shown.includes("RATE_LIMIT_DEFAULT_LIMIT_API_KEY=<redacted>"));
  });
});

describe("calApiKeyRateLimit", () => {
  it("returns the numeric limit the harness environment sets", () => {
    assert.equal(calApiKeyRateLimit({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: "121" } as NodeJS.ProcessEnv), 121);
  });

  it("throws by name when the limit is unset, and never reports the fork default as effective", () => {
    assert.throws(
      () => calApiKeyRateLimit({} as NodeJS.ProcessEnv),
      /RATE_LIMIT_DEFAULT_LIMIT_API_KEY is not set/,
    );
  });

  it("throws by name when the limit is blank", () => {
    assert.throws(
      () => calApiKeyRateLimit({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: " " } as NodeJS.ProcessEnv),
      /RATE_LIMIT_DEFAULT_LIMIT_API_KEY is not set/,
    );
  });

  it("throws by name, not the value, when the limit is not a positive whole number", () => {
    assert.throws(
      () => calApiKeyRateLimit({ RATE_LIMIT_DEFAULT_LIMIT_API_KEY: "12x" } as NodeJS.ProcessEnv),
      (err: Error) => err.message.includes("RATE_LIMIT_DEFAULT_LIMIT_API_KEY") && !err.message.includes("12x"),
    );
  });
});
