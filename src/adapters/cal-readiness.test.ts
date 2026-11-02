import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calDbHostPort, calReadinessError } from "./cal-readiness.js";

describe("calDbHostPort", () => {
  it("returns host and port only, never the password", () => {
    assert.equal(calDbHostPort("postgresql://postgres:s3cret-pass@127.0.0.1:5450/calendso"), "127.0.0.1:5450");
    assert.doesNotMatch(calDbHostPort("postgresql://postgres:s3cret-pass@127.0.0.1:5450/calendso"), /s3cret/);
  });

  it("uses 5432 when the URL has no port", () => {
    assert.equal(calDbHostPort("postgresql://postgres:@db.example/calendso"), "db.example:5432");
  });
});

describe("calReadinessError", () => {
  it("passes on 200", () => {
    assert.equal(calReadinessError(200, "127.0.0.1:5450"), undefined);
  });

  it("fails with a harness: message naming the status and the database host on any other status", () => {
    for (const status of [401, 500, 503]) {
      const message = calReadinessError(status, "127.0.0.1:5450");
      assert.ok(message?.startsWith("harness: "), `status ${status}`);
      assert.match(message ?? "", new RegExp(`answered ${status}`));
      assert.match(message ?? "", /127\.0\.0\.1:5450/);
    }
  });
});
