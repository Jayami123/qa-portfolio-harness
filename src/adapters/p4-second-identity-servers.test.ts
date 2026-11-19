import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { HARNESS_ROOT } from "../paths.js";
import { derivedSecondPassword, secondIdentityProduct } from "./p4-second-identity.js";
import { p4RunStateFile } from "./p4-run-state.js";
import { OUTLINE_SECOND_EMAIL, OUTLINE_OWNER_EMAIL } from "./outline-env.js";
import { outlineSeedExecEnv, parseOutlineSeedOutput, secondEmailMatches } from "./outline-seed.js";
import { PENPOT_OWNER_EMAIL, PENPOT_SECOND_EMAIL } from "./penpot-env.js";
import { MATTERMOST_AGENT_B_EMAIL, MATTERMOST_AGENT_B_USERNAME, MATTERMOST_AGENT_EMAIL, MATTERMOST_AGENT_USERNAME } from "./mattermost-env.js";
import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_SECOND_MEMBER_EMAIL } from "./twenty-env.js";
import { NEXTCLOUD_SECOND_EMAIL, NEXTCLOUD_OWNER_EMAIL } from "./nextcloud-env.js";

const KEY = "ol_api_" + "x".repeat(38);
const KEY_B = "ol_api_" + "y".repeat(38);

describe("H2 derived second password (not stored, stable across restarts)", () => {
  it("is deterministic for the same secret and label", () => {
    assert.equal(derivedSecondPassword("secret-one", "penpot"), derivedSecondPassword("secret-one", "penpot"));
  });
  it("changes with the secret and with the label", () => {
    const base = derivedSecondPassword("secret-one", "penpot");
    assert.notEqual(base, derivedSecondPassword("secret-two", "penpot"));
    assert.notEqual(base, derivedSecondPassword("secret-one", "mattermost"));
  });
  it("is 43 url-safe characters and never equals the secret it came from", () => {
    const pw = derivedSecondPassword("secret-one", "penpot");
    assert.match(pw, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(pw, "secret-one");
  });
});

describe("H2 run-state names for all five products", () => {
  for (const product of ["nextcloud", "outline", "twenty", "penpot", "mattermost"]) {
    it(`${product}: the second run state is a separate file in the same folder`, () => {
      const owner = p4RunStateFile(product, HARNESS_ROOT);
      const second = p4RunStateFile(secondIdentityProduct(product), HARNESS_ROOT);
      assert.equal(secondIdentityProduct(product), `${product}-b`);
      assert.notEqual(owner, second);
      assert.equal(path.dirname(owner), path.dirname(second));
    });
  }
});

describe("H2 Outline: the seed output and the flag", () => {
  it("passes the flag to the seed as an env value only when on", () => {
    assert.deepEqual(outlineSeedExecEnv(false), []);
    assert.deepEqual(outlineSeedExecEnv(true), ["-e", "P4_SECOND_IDENTITY=1"]);
  });
  it("reads the second key and user from the seed line", () => {
    const line = JSON.stringify({ apiKey: KEY, teamId: "t1", userId: "u1", second: { apiKey: KEY_B, userId: "u2" } });
    const parsed = parseOutlineSeedOutput(`noise\n${line}\n`);
    assert.equal(parsed.apiKey, KEY);
    assert.deepEqual(parsed.second, { apiKey: KEY_B, userId: "u2" });
  });
  it("has no second field when the seed line has none (option off)", () => {
    const line = JSON.stringify({ apiKey: KEY, teamId: "t1", userId: "u1" });
    assert.equal(parseOutlineSeedOutput(line).second, undefined);
  });
  it("rejects a null or malformed second block with a fixed message that never echoes the key", () => {
    for (const second of [null, { apiKey: "not-a-key", userId: "u2" }, { apiKey: KEY_B }]) {
      const line = JSON.stringify({ apiKey: KEY, teamId: "t1", userId: "u1", second });
      assert.throws(
        () => parseOutlineSeedOutput(line),
        (err: Error) => err.message.startsWith("OUTLINE_SEED_OUTPUT_INVALID") && !err.message.includes("ol_api_"),
      );
    }
  });
  it("matches the second user's email and rejects the owner's", () => {
    assert.equal(secondEmailMatches(OUTLINE_SECOND_EMAIL), true);
    assert.equal(secondEmailMatches(OUTLINE_OWNER_EMAIL), false);
  });
  it("the seed script names the same second email and reads the same flag (contract with docker/outline-seed.cjs)", () => {
    const script = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "outline-seed.cjs"), "utf8");
    assert.ok(script.includes(`const SECOND_EMAIL = "${OUTLINE_SECOND_EMAIL}";`));
    assert.ok(script.includes('process.env.P4_SECOND_IDENTITY === "1"'));
  });
});

describe("H2 Penpot, Mattermost, Twenty, Nextcloud: distinct identities", () => {
  it("Penpot: the second profile is not the owner's", () => {
    assert.notEqual(PENPOT_SECOND_EMAIL, PENPOT_OWNER_EMAIL);
  });
  it("Mattermost: the second member is a different account from the agent, with no admin role by name", () => {
    assert.notEqual(MATTERMOST_AGENT_B_USERNAME, MATTERMOST_AGENT_USERNAME);
    assert.notEqual(MATTERMOST_AGENT_B_EMAIL, MATTERMOST_AGENT_EMAIL);
  });
  it("Twenty: the second member is a seeded Member, not the seeded admin", () => {
    assert.notEqual(TWENTY_SECOND_MEMBER_EMAIL, TWENTY_DEFAULT_ADMIN_EMAIL);
  });
  it("Nextcloud: the second user is not the owner", () => {
    assert.notEqual(NEXTCLOUD_SECOND_EMAIL, NEXTCLOUD_OWNER_EMAIL);
  });
});
