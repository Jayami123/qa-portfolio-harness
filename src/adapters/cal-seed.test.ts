import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAL_SEED_USER_SQL, redactSeedOutput } from "./cal-seed.js";

describe("CAL_SEED_USER_SQL", () => {
  it('selects from users and not from "User"', () => {
    assert.match(CAL_SEED_USER_SQL, /FROM users\b/);
    assert.doesNotMatch(CAL_SEED_USER_SQL, /"User"/);
  });
});

describe("redactSeedOutput", () => {
  it("hides the key value and keeps the line", () => {
    const line = "2276:@calcom/prisma:db-seed: Created seeded API Key: cal_0123456789abcdef0123456789abcdef\n";
    const { text, carry } = redactSeedOutput(line);
    assert.equal(text, "2276:@calcom/prisma:db-seed: Created seeded API Key: ***\n");
    assert.equal(carry, "");
  });

  it("leaves other lines untouched", () => {
    const output = "Seed users created\nfree@example.com\n";
    assert.deepEqual(redactSeedOutput(output), { text: output, carry: "" });
  });

  it("catches a key split across two chunks", () => {
    const first = redactSeedOutput("Created seeded API Key: cal_01");
    assert.equal(first.text, "");
    const second = redactSeedOutput("23456789abcdef0123456789abcdef\n", first.carry);
    assert.equal(second.text, "Created seeded API Key: ***\n");
    assert.doesNotMatch(second.text, /23456789/);
    assert.equal(second.carry, "");
  });
});
