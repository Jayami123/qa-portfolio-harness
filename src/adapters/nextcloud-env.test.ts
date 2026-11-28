import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  generateNextcloudSecret,
  nextcloudComposeEnv,
  nextcloudComposeFiles,
  nextcloudSecretsFromText,
  parseNextcloudStatus,
  trustedDomainWrites,
  NEXTCLOUD_IMAGE,
  NEXTCLOUD_MCP_IMAGE,
  NEXTCLOUD_TRUSTED_DOMAINS,
} from "./nextcloud-env.js";
import { HARNESS_ROOT } from "../paths.js";

const nextcloudCompose = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "nextcloud.compose.yml"), "utf8");

describe("nextcloud-env", () => {
  it("trusts 127.0.0.1, localhost and app as before, plus 10.0.2.2 (the Android emulator's alias for the host)", () => {
    const line = nextcloudCompose.split("\n").find((l) => /^\s*NEXTCLOUD_TRUSTED_DOMAINS:/.test(l));
    assert.ok(line, "docker/nextcloud.compose.yml sets NEXTCLOUD_TRUSTED_DOMAINS");
    const value = /^\s*NEXTCLOUD_TRUSTED_DOMAINS:\s*"([^"]*)"\s*$/.exec(line)?.[1];
    assert.equal(value, "127.0.0.1 localhost app 10.0.2.2");
    assert.deepEqual([...NEXTCLOUD_TRUSTED_DOMAINS], ["127.0.0.1", "localhost", "app", "10.0.2.2"]);
    assert.equal(value, NEXTCLOUD_TRUSTED_DOMAINS.join(" "), "the compose value and the adapter's list match");
  });

  it("adds only the missing trusted domains, at the next free index (existing volumes), and nothing on a fresh install", () => {
    // A fresh install: the image already wrote every value, so there is nothing to add.
    assert.deepEqual(trustedDomainWrites(["localhost", "127.0.0.1", "localhost", "app", "10.0.2.2"]), []);
    // A volume installed before 10.0.2.2 was added: the image's list is 0..3, so 10.0.2.2 goes to index 4.
    assert.deepEqual(trustedDomainWrites(["localhost", "127.0.0.1", "localhost", "app"]), [{ index: 4, value: "10.0.2.2" }]);
    // An empty list gets every required value, indexed from 0.
    assert.deepEqual(trustedDomainWrites([]), NEXTCLOUD_TRUSTED_DOMAINS.map((value, index) => ({ index, value })));
    // A custom list still gets the missing required values, and no untrusted value is ever written.
    assert.deepEqual(trustedDomainWrites(["untrusted.example"], ["127.0.0.1", "10.0.2.2"]), [
      { index: 1, value: "127.0.0.1" },
      { index: 2, value: "10.0.2.2" },
    ]);
  });

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

  it("orders the compose files base, then mail (H1), then MCP, and adds only what is asked", () => {
    const names = (files: string[]) => files.map((f) => f.replaceAll("\\", "/").split("/").pop());
    assert.deepEqual(names(nextcloudComposeFiles(false)), ["nextcloud.compose.yml"]);
    assert.deepEqual(names(nextcloudComposeFiles(false, true)), ["nextcloud.compose.yml", "nextcloud.mail.compose.yml"]);
    assert.deepEqual(names(nextcloudComposeFiles(true, true)), ["nextcloud.compose.yml", "nextcloud.mail.compose.yml", "nextcloud.mcp.compose.yml"]);
    assert.deepEqual(names(nextcloudComposeFiles(true)), ["nextcloud.compose.yml", "nextcloud.mcp.compose.yml"]);
  });
});
