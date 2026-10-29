import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readTwentyRateLimitEnv,
  twentyRateLimitComposeYaml,
  TWENTY_RATE_LIMIT_ENV,
} from "./twenty-rate-limits.js";

describe("readTwentyRateLimitEnv", () => {
  it("reads nothing when no allowlisted name is set", () => {
    assert.deepEqual(readTwentyRateLimitEnv({}), {});
    assert.equal(twentyRateLimitComposeYaml(readTwentyRateLimitEnv({})), undefined);
  });

  it("treats blank and whitespace values as unset", () => {
    const env = {
      API_RATE_LIMITING_SHORT_LIMIT: "",
      API_RATE_LIMITING_LONG_LIMIT: "   ",
      APPLICATION_API_RATE_LIMITING_LIMIT: "\t",
    };
    assert.deepEqual(readTwentyRateLimitEnv(env), {});
  });

  it("returns exactly the set allowlisted names with their values", () => {
    const env = {
      API_RATE_LIMITING_SHORT_LIMIT: "500",
      APPLICATION_API_RATE_LIMITING_TTL_IN_MS: "30000",
      API_RATE_LIMITING_LONG_LIMIT: "",
    };
    assert.deepEqual(readTwentyRateLimitEnv(env), {
      API_RATE_LIMITING_SHORT_LIMIT: "500",
      APPLICATION_API_RATE_LIMITING_TTL_IN_MS: "30000",
    });
  });

  it("never reads a name outside the allowlist", () => {
    const env = {
      API_RATE_LIMITING: "5",
      API_RATE_LIMITING_SHORT_LIMIT_EXTRA: "5",
      API_RATE_LIMITING_BURST_LIMIT: "5",
      APPLICATION_API_RATE_LIMITING: "5",
      APPLICATION_API_RATE_LIMITING_BURST_LIMIT: "5",
      DATABASE_URL: "postgres://example",
    };
    assert.deepEqual(readTwentyRateLimitEnv(env), {});
  });

  it("rejects 0, negatives, decimals, leading zeros and text naming the variable", () => {
    const bad = ["0", "-1", "1.5", "01", "1e3", "abc", " 500", "500 ", "9007199254740992"];
    for (const raw of bad) {
      assert.throws(
        () => readTwentyRateLimitEnv({ API_RATE_LIMITING_SHORT_LIMIT: raw }),
        (error: Error) =>
          error.message.startsWith("TWENTY_RATE_LIMIT_NOT_INTEGER: API_RATE_LIMITING_SHORT_LIMIT must be"),
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });

  it("writes the same keys for server and worker", () => {
    const yaml = twentyRateLimitComposeYaml({
      API_RATE_LIMITING_SHORT_LIMIT: "500",
      APPLICATION_API_RATE_LIMITING_LIMIT: "700",
    });
    assert.equal(
      yaml,
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

  it("forwards API_RATE_LIMITING_SHORT_TTL_IN_MS with its exact value", () => {
    assertForwarded("API_RATE_LIMITING_SHORT_TTL_IN_MS", "1000");
  });

  it("forwards API_RATE_LIMITING_SHORT_LIMIT with its exact value", () => {
    assertForwarded("API_RATE_LIMITING_SHORT_LIMIT", "500");
  });

  it("forwards API_RATE_LIMITING_LONG_TTL_IN_MS with its exact value", () => {
    assertForwarded("API_RATE_LIMITING_LONG_TTL_IN_MS", "60000");
  });

  it("forwards API_RATE_LIMITING_LONG_LIMIT with its exact value", () => {
    assertForwarded("API_RATE_LIMITING_LONG_LIMIT", "5000");
  });

  it("forwards APPLICATION_API_RATE_LIMITING_TTL_IN_MS with its exact value", () => {
    assertForwarded("APPLICATION_API_RATE_LIMITING_TTL_IN_MS", "30000");
  });

  it("forwards APPLICATION_API_RATE_LIMITING_LIMIT with its exact value", () => {
    assertForwarded("APPLICATION_API_RATE_LIMITING_LIMIT", "700");
  });
});

/** Sets one allowlisted name to a whole number: the server and worker keys carry it, and a blank value writes no key. */
function assertForwarded(name: (typeof TWENTY_RATE_LIMIT_ENV)[number], value: string): void {
  const values = readTwentyRateLimitEnv({ [name]: value });
  assert.deepEqual(values, { [name]: value });

  const yaml = twentyRateLimitComposeYaml(values) ?? "";
  assert.equal(yaml.split(`      ${name}: "${value}"`).length - 1, 2, "server and worker both carry the key");

  const blank = readTwentyRateLimitEnv({ [name]: "" });
  assert.equal(twentyRateLimitComposeYaml(blank), undefined);
}
