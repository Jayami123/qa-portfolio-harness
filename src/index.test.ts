import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as harness from "./index.js";

describe("package entry", () => {
  it("re-exports the Twenty dev-seeder login as non-empty strings", () => {
    assert.equal(typeof harness.TWENTY_DEFAULT_ADMIN_EMAIL, "string");
    assert.notEqual(harness.TWENTY_DEFAULT_ADMIN_EMAIL.length, 0);
    assert.equal(typeof harness.TWENTY_DEV_SEED_PASSWORD, "string");
    assert.notEqual(harness.TWENTY_DEV_SEED_PASSWORD.length, 0);
  });
});
