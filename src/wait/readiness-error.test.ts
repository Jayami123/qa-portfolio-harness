import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeFetchFailure } from "./readiness-error.js";

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("describeFetchFailure (the error code survives)", () => {
  it("keeps ECONNREFUSED from the fetch cause", () => {
    const err = new TypeError("fetch failed", { cause: withCode("connect ECONNREFUSED 127.0.0.1:8080", "ECONNREFUSED") });
    assert.equal(describeFetchFailure(err), "ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8080");
  });

  it("finds the code inside an AggregateError", () => {
    const agg = new AggregateError([withCode("connect ECONNREFUSED ::1", "ECONNREFUSED")], "fetch failed");
    const err = new TypeError("fetch failed", { cause: agg });
    assert.match(describeFetchFailure(err), /^ECONNREFUSED: /);
  });

  it("keeps ECONNRESET and socket errors", () => {
    const err = new TypeError("fetch failed", { cause: withCode("socket hang up", "ECONNRESET") });
    assert.match(describeFetchFailure(err), /^ECONNRESET: socket hang up$/);
  });

  it("reports an abort or a timeout as a timeout", () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    assert.equal(describeFetchFailure(abort), "fetch timed out");
    assert.equal(describeFetchFailure(timeout), "fetch timed out");
  });

  it("falls back to the message when there is no code, and handles non-errors", () => {
    assert.equal(describeFetchFailure(new Error("plain failure")), "plain failure");
    assert.equal(describeFetchFailure("text only"), "text only");
  });

  it("bounds the length", () => {
    const long = describeFetchFailure(withCode("x".repeat(500), "ECONNREFUSED"));
    assert.ok(long.length <= 210);
  });
});
