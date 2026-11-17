import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extraCaPem,
  generateMattermostSecrets,
  mattermostComposeEnv,
  mattermostComposeFiles,
  mattermostSecretsFromText,
  MATTERMOST_MM_AGENTS_COMMIT,
} from "./mattermost-env.js";

describe("mattermost-env", () => {
  it("pins the MCP source to a full 40-hex commit", () => {
    assert.match(MATTERMOST_MM_AGENTS_COMMIT, /^[0-9a-f]{40}$/);
  });

  it("makes three secrets that differ, from an injected source", () => {
    const fixed = (n: number) => Buffer.alloc(n, 0x02);
    assert.deepEqual(generateMattermostSecrets(fixed), generateMattermostSecrets(fixed));
    const real = generateMattermostSecrets();
    assert.notEqual(real.ownerPassword, real.agentPassword);
    assert.notEqual(real.dbPassword, real.ownerPassword);
  });

  it("reuses saved secrets and replaces a file missing a field", () => {
    const good = { dbPassword: "d", ownerPassword: "o", agentPassword: "a" };
    assert.deepEqual(mattermostSecretsFromText(JSON.stringify(good)), good);
    const made = () => good;
    assert.deepEqual(mattermostSecretsFromText(JSON.stringify({ dbPassword: "d" }), made), good);
  });

  it("lists the compose file and adds the db password and build context without mutating the base env", () => {
    assert.equal(mattermostComposeFiles().length, 1);
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const env = mattermostComposeEnv(base, { dbPassword: "d", ownerPassword: "o", agentPassword: "a" }, "/ctx");
    assert.equal(env.MATTERMOST_DB_PASSWORD, "d");
    assert.equal(env.MATTERMOST_BUILD_CONTEXT, "/ctx");
    assert.equal(base.MATTERMOST_DB_PASSWORD, undefined);
  });

  it("returns the optional CA as text, empty when no file is named, and reads the named file", () => {
    assert.equal(extraCaPem(undefined), "");
    assert.equal(extraCaPem("   "), "");
    assert.equal(extraCaPem("/ca.pem", () => "PEM TEXT"), "PEM TEXT");
  });
});
