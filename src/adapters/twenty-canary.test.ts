import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canaryYamlLines, CANARY_NAME_ENV, CANARY_VALUE_ENV, readTwentyCanary } from "./twenty-canary.js";

const VALUE = "CANARY_TEST_VALUE_7f3a9c";
const RESERVED: ReadonlySet<string> = new Set([
  "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS", // passthrough
  "API_RATE_LIMITING_LONG_LIMIT", // rate limit
  "NODE_OPTIONS", // preload
  "TWENTY_REQUIRE_FRESH",
  CANARY_NAME_ENV,
  "SERVER_URL", // compose-set
]);

describe("readTwentyCanary", () => {
  it("accepts a valid name with a value and returns the name only", () => {
    assert.deepEqual(
      readTwentyCanary({ [CANARY_NAME_ENV]: "P5_CANARY_PROBE", [CANARY_VALUE_ENV]: VALUE }, RESERVED),
      { name: "P5_CANARY_PROBE" },
    );
  });

  it("accepts the shortest and longest names the pattern allows", () => {
    const longest = `A${"B".repeat(63)}`;
    assert.equal(readTwentyCanary({ [CANARY_NAME_ENV]: "ABC", [CANARY_VALUE_ENV]: VALUE }, RESERVED)?.name, "ABC");
    assert.equal(readTwentyCanary({ [CANARY_NAME_ENV]: longest, [CANARY_VALUE_ENV]: VALUE }, RESERVED)?.name, longest);
  });

  it("throws for a name that fails the pattern", () => {
    for (const name of ["lower_case", "AB", "1ABC", "BAD-NAME", " ABC", "A".repeat(65)]) {
      assert.throws(
        () => readTwentyCanary({ [CANARY_NAME_ENV]: name, [CANARY_VALUE_ENV]: VALUE }, RESERVED),
        /TWENTY_CANARY_NAME_INVALID/,
        name,
      );
    }
  });

  it("throws when the name is in any reserved class", () => {
    for (const name of ["OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS", "API_RATE_LIMITING_LONG_LIMIT", "NODE_OPTIONS", "TWENTY_REQUIRE_FRESH", CANARY_NAME_ENV, "SERVER_URL"]) {
      assert.throws(
        () => readTwentyCanary({ [CANARY_NAME_ENV]: name, [CANARY_VALUE_ENV]: VALUE }, RESERVED),
        /TWENTY_CANARY_NAME_RESERVED/,
        name,
      );
    }
  });

  it("throws when the name is set and the value is blank or unset", () => {
    for (const env of [
      { [CANARY_NAME_ENV]: "P5_CANARY_PROBE" },
      { [CANARY_NAME_ENV]: "P5_CANARY_PROBE", [CANARY_VALUE_ENV]: "" },
      { [CANARY_NAME_ENV]: "P5_CANARY_PROBE", [CANARY_VALUE_ENV]: "   " },
    ]) {
      assert.throws(() => readTwentyCanary(env, RESERVED), /TWENTY_CANARY_VALUE_MISSING/);
    }
  });

  it("returns undefined when the name is unset or blank, and ignores the value", () => {
    assert.equal(readTwentyCanary({}, RESERVED), undefined);
    assert.equal(readTwentyCanary({ [CANARY_VALUE_ENV]: VALUE }, RESERVED), undefined);
    assert.equal(readTwentyCanary({ [CANARY_NAME_ENV]: "", [CANARY_VALUE_ENV]: VALUE }, RESERVED), undefined);
    assert.equal(readTwentyCanary({ [CANARY_NAME_ENV]: "   ", [CANARY_VALUE_ENV]: VALUE }, RESERVED), undefined);
  });

  it("never puts the value in an error message", () => {
    const cases: NodeJS.ProcessEnv[] = [
      { [CANARY_NAME_ENV]: "bad-name", [CANARY_VALUE_ENV]: VALUE },
      { [CANARY_NAME_ENV]: "SERVER_URL", [CANARY_VALUE_ENV]: VALUE },
      { [CANARY_NAME_ENV]: "P5_CANARY_PROBE", [CANARY_VALUE_ENV]: "  " },
      // The value is misplaced in the name field: the invalid name must not be echoed.
      { [CANARY_NAME_ENV]: VALUE, [CANARY_VALUE_ENV]: "x" },
    ];
    for (const env of cases) {
      assert.throws(
        () => readTwentyCanary(env, RESERVED),
        (err: unknown) => err instanceof Error && !err.message.includes(VALUE),
      );
    }
  });
});

describe("canaryYamlLines", () => {
  it("returns no lines when there is no canary", () => {
    assert.deepEqual(canaryYamlLines(undefined), []);
  });

  it("returns the reference line only, never a value", () => {
    assert.deepEqual(canaryYamlLines({ name: "P5_CANARY_PROBE" }), ["      P5_CANARY_PROBE: ${HARNESS_TWENTY_CANARY_VALUE}"]);
  });
});
