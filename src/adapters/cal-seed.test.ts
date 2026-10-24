import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAL_SEED_USER_SQL } from "./cal-seed.js";

describe("CAL_SEED_USER_SQL", () => {
  it('selects from users and not from "User"', () => {
    assert.match(CAL_SEED_USER_SQL, /FROM users\b/);
    assert.doesNotMatch(CAL_SEED_USER_SQL, /"User"/);
  });
});
