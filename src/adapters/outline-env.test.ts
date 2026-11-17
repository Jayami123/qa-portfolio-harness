import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateOutlineSecrets,
  outlineComposeEnv,
  outlineComposeFiles,
  outlineSecretsFromText,
  OUTLINE_API_KEY_PREFIX,
} from "./outline-env.js";

describe("outline-env", () => {
  it("makes a 64-hex secret key and utils secret that differ per call", () => {
    const a = generateOutlineSecrets();
    const b = generateOutlineSecrets();
    assert.match(a.secretKey, /^[0-9a-f]{64}$/);
    assert.match(a.utilsSecret, /^[0-9a-f]{64}$/);
    assert.notEqual(a.secretKey, b.secretKey);
    assert.notEqual(a.utilsSecret, b.utilsSecret);
    assert.notEqual(a.secretKey, a.utilsSecret);
  });

  it("is deterministic for a fixed random source", () => {
    const fixed = (n: number) => Buffer.alloc(n, 0x01);
    assert.deepEqual(generateOutlineSecrets(fixed), generateOutlineSecrets(fixed));
  });

  it("reuses saved secrets and replaces a file whose keys are not 64 hex", () => {
    const good = { dbPassword: "db-1", secretKey: "a".repeat(64), utilsSecret: "b".repeat(64) };
    assert.deepEqual(outlineSecretsFromText(JSON.stringify(good)), good);
    const bad = { ...good, secretKey: "not-hex" };
    const made = () => good;
    assert.deepEqual(outlineSecretsFromText(JSON.stringify(bad), made), good);
    assert.deepEqual(outlineSecretsFromText("{", made), good);
  });

  it("lists the one compose file", () => {
    const files = outlineComposeFiles();
    assert.equal(files.length, 1);
    assert.match(files.at(0) ?? "", /outline\.compose\.yml$/);
  });

  it("adds exactly the three secret names and does not mutate the base env", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const env = outlineComposeEnv(base, { dbPassword: "d", secretKey: "s", utilsSecret: "u" });
    assert.equal(env.OUTLINE_DB_PASSWORD, "d");
    assert.equal(env.OUTLINE_SECRET_KEY, "s");
    assert.equal(env.OUTLINE_UTILS_SECRET, "u");
    assert.equal(base.OUTLINE_DB_PASSWORD, undefined);
  });

  it("uses the ol_api_ key prefix that the 1.13.0 build verifies", () => {
    assert.equal(OUTLINE_API_KEY_PREFIX, "ol_api_");
  });
});
