import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generatePenpotSecrets,
  penpotComposeEnv,
  penpotComposeFiles,
  penpotSecretsFromText,
  PENPOT_MCP_IMAGE,
} from "./penpot-env.js";

describe("penpot-env", () => {
  it("pins the MCP image by digest", () => {
    assert.match(PENPOT_MCP_IMAGE, /@sha256:[0-9a-f]{64}$/);
  });

  it("makes a 64-hex shared secret that differs per call", () => {
    const a = generatePenpotSecrets();
    const b = generatePenpotSecrets();
    assert.match(a.secretKey, /^[0-9a-f]{64}$/);
    assert.notEqual(a.secretKey, b.secretKey);
    assert.notEqual(a.ownerPassword, b.ownerPassword);
  });

  it("reuses saved secrets and replaces a file whose shared key is not 64 hex", () => {
    const good = { dbPassword: "d", secretKey: "c".repeat(64), ownerPassword: "o" };
    assert.deepEqual(penpotSecretsFromText(JSON.stringify(good)), good);
    const made = () => good;
    assert.deepEqual(penpotSecretsFromText(JSON.stringify({ ...good, secretKey: "short" }), made), good);
    assert.deepEqual(penpotSecretsFromText(undefined, made), good);
  });

  it("lists the one compose file and adds exactly the two secret names", () => {
    assert.equal(penpotComposeFiles().length, 1);
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const env = penpotComposeEnv(base, { dbPassword: "d", secretKey: "s", ownerPassword: "o" });
    assert.equal(env.PENPOT_DB_PASSWORD, "d");
    assert.equal(env.PENPOT_SECRET_KEY, "s");
    assert.equal(base.PENPOT_DB_PASSWORD, undefined);
  });
});
