import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { P4_DEFAULT_WAIT_MS, P4_MIN_WAIT_MS, p4WaitBudgetMs } from "./p4-wait.js";

describe("p4WaitBudgetMs", () => {
  it("uses the default when unset or blank", () => {
    assert.equal(p4WaitBudgetMs({}), P4_DEFAULT_WAIT_MS);
    assert.equal(p4WaitBudgetMs({ P4_WAIT_MS: "   " }), P4_DEFAULT_WAIT_MS);
  });

  it("accepts a value at or above the floor", () => {
    assert.equal(p4WaitBudgetMs({ P4_WAIT_MS: String(P4_MIN_WAIT_MS) }), P4_MIN_WAIT_MS);
    assert.equal(p4WaitBudgetMs({ P4_WAIT_MS: "900000" }), 900000);
  });

  it("ignores a value below the floor and a non-number", () => {
    assert.equal(p4WaitBudgetMs({ P4_WAIT_MS: "5000" }), P4_DEFAULT_WAIT_MS);
    assert.equal(p4WaitBudgetMs({ P4_WAIT_MS: "soon" }), P4_DEFAULT_WAIT_MS);
  });
});
