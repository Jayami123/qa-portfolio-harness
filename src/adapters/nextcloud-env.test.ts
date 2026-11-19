import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateNextcloudSecret,
  nextcloudComposeEnv,
  nextcloudComposeFiles,
  nextcloudSecretsFromText,
  parseNextcloudStatus,
  NEXTCLOUD_IMAGE,
  NEXTCLOUD_MCP_IMAGE,
} from "./nextcloud-env.js";

describe("nextcloud-env", () => {
  it("pins both images by digest", () => {
    assert.match(NEXTCLOUD_IMAGE, /@sha256:[0-9a-f]{64}$/);
    assert.match(NEXTCLOUD_MCP_IMAGE, /@sha256:[0-9a-f]{64}$/);
  });

  it("generates url-safe secrets that differ per call, from an injected source", () => {
    const fixed = (n: number) => Buffer.alloc(n, 0xab);
    assert.equal(generateNextcloudSecret(fixed), generateNextcloudSecret(fixed));
    const real = generateNextcloudSecret();
    assert.match(real, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(real, generateNextcloudSecret());
  });

  it("never starts a secret with a dash (occ reads it as an option), and keeps the length and alphabet", () => {
    // 0xfb in the first byte makes the first base64url character "-".
    const dashFirst = (n: number) => Buffer.alloc(n, 0xfb);
    assert.equal(dashFirst(24).toString("base64url").startsWith("-"), true, "the fixture really starts with a dash");
    const secret = generateNextcloudSecret(dashFirst);
    assert.equal(secret.startsWith("-"), false);
    assert.match(secret, /^[A-Za-z0-9_-]{32}$/);
    for (let i = 0; i < 2000; i++) {
      assert.equal(generateNextcloudSecret().startsWith("-"), false);
    }
  });

  it("reuses secrets from text and replaces unusable text", () => {
    const kept = nextcloudSecretsFromText(JSON.stringify({ dbPassword: "db-a", ownerPassword: "own-a" }));
    assert.deepEqual(kept, { dbPassword: "db-a", ownerPassword: "own-a" });
    const made = () => ({ dbPassword: "new-db", ownerPassword: "new-own" });
    assert.deepEqual(nextcloudSecretsFromText(undefined, made), { dbPassword: "new-db", ownerPassword: "new-own" });
    assert.deepEqual(nextcloudSecretsFromText("not json", made), { dbPassword: "new-db", ownerPassword: "new-own" });
    assert.deepEqual(nextcloudSecretsFromText('{"dbPassword":""}', made), {
      dbPassword: "new-db",
      ownerPassword: "new-own",
    });
  });

  it("lists the app file alone, or the app and MCP files", () => {
    assert.equal(nextcloudComposeFiles(false).length, 1);
    assert.equal(nextcloudComposeFiles(true).length, 2);
    assert.match(nextcloudComposeFiles(true).at(-1) ?? "", /nextcloud\.mcp\.compose\.yml$/);
  });

  it("adds exactly the two secret names and does not mutate the base env", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const env = nextcloudComposeEnv(base, { dbPassword: "d", ownerPassword: "o" });
    assert.equal(env.NEXTCLOUD_DB_PASSWORD, "d");
    assert.equal(env.NEXTCLOUD_OWNER_PASSWORD, "o");
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(base.NEXTCLOUD_DB_PASSWORD, undefined);
  });

  it("reads status.php as ready only when installed, out of maintenance, and with no upgrade pending", () => {
    assert.deepEqual(parseNextcloudStatus({ installed: true, maintenance: false, needsDbUpgrade: false }), { ready: true });
    assert.equal(parseNextcloudStatus({ installed: false }).ready, false);
    assert.equal(parseNextcloudStatus({ installed: true, maintenance: true }).ready, false);
    assert.equal(parseNextcloudStatus({ installed: true, needsDbUpgrade: true }).ready, false);
    assert.equal(parseNextcloudStatus("garbage").ready, false);
    assert.equal(parseNextcloudStatus(null).ready, false);
  });
});
