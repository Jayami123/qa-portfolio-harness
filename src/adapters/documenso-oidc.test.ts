import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildDocumensoAppEnv } from "./documenso-env.js";
import {
  DOCUMENSO_OIDC_CLIENT_ID,
  DOCUMENSO_OIDC_IDP_CONFIG,
  DOCUMENSO_OIDC_IDP_NOT_READY,
  DOCUMENSO_OIDC_IDP_PORT,
  DOCUMENSO_OIDC_IMAGE,
  DOCUMENSO_OIDC_INVALID,
  DOCUMENSO_OIDC_OVERLAY,
  DOCUMENSO_OIDC_WELL_KNOWN_URL,
  documensoOidcClientSecret,
  documensoOidcEnabled,
  documensoOidcOverlayFiles,
  waitForOidcWellKnown,
} from "./documenso-oidc.js";
import { HARNESS_ROOT } from "../paths.js";

const compose = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "documenso.oidc.compose.yml"), "utf8");
const APP_CFG = { baseUrl: "http://127.0.0.1:3001", dbUrl: "postgres://documenso@127.0.0.1:5451/documenso", productRoot: "/p" };

describe("DOCUMENSO_OIDC flag", () => {
  it("is off when unset or blank", () => {
    assert.equal(documensoOidcEnabled({}), false);
    assert.equal(documensoOidcEnabled({ DOCUMENSO_OIDC: "" }), false);
    assert.equal(documensoOidcEnabled({ DOCUMENSO_OIDC: "   " }), false);
  });

  it("is on only for exactly 1", () => {
    assert.equal(documensoOidcEnabled({ DOCUMENSO_OIDC: "1" }), true);
  });

  for (const bad of ["0", "true", "yes", "2"]) {
    it(`throws DOCUMENSO_OIDC_INVALID, naming the variable and not the value, for ${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => documensoOidcEnabled({ DOCUMENSO_OIDC: bad }),
        (err: Error) =>
          err.message.startsWith(DOCUMENSO_OIDC_INVALID) &&
          err.message.includes("DOCUMENSO_OIDC") &&
          !err.message.includes(bad),
      );
    });
  }

  it("rejects a value with surrounding spaces (exact match only)", () => {
    assert.throws(() => documensoOidcEnabled({ DOCUMENSO_OIDC: " 1" }), /DOCUMENSO_OIDC_INVALID/);
    assert.throws(() => documensoOidcEnabled({ DOCUMENSO_OIDC: "1 " }), /DOCUMENSO_OIDC_INVALID/);
  });
});

describe("overlay files", () => {
  it("adds nothing when the flag is off, and the overlay when it is on", () => {
    assert.deepEqual(documensoOidcOverlayFiles(false), []);
    assert.deepEqual(documensoOidcOverlayFiles(true), [DOCUMENSO_OIDC_OVERLAY]);
    assert.ok(fs.existsSync(path.join(HARNESS_ROOT, "docker", DOCUMENSO_OIDC_OVERLAY)));
  });
});

describe("Documenso app env", () => {
  it("sets no NEXT_PRIVATE_OIDC_* name when the OIDC option is absent (default)", () => {
    const env = buildDocumensoAppEnv(APP_CFG);
    assert.deepEqual(
      Object.keys(env).filter((key) => key.startsWith("NEXT_PRIVATE_OIDC")),
      [],
    );
  });

  it("sets the well-known URL, client id and client secret, and forces skip-verify off, when the option is present", () => {
    const env = buildDocumensoAppEnv({
      ...APP_CFG,
      oidc: { wellKnownUrl: DOCUMENSO_OIDC_WELL_KNOWN_URL, clientId: DOCUMENSO_OIDC_CLIENT_ID, clientSecret: "test-secret-value" },
    });
    assert.equal(env.NEXT_PRIVATE_OIDC_WELL_KNOWN, DOCUMENSO_OIDC_WELL_KNOWN_URL);
    assert.equal(env.NEXT_PRIVATE_OIDC_CLIENT_ID, DOCUMENSO_OIDC_CLIENT_ID);
    assert.equal(env.NEXT_PRIVATE_OIDC_CLIENT_SECRET, "test-secret-value");
    assert.equal(env.NEXT_PRIVATE_OIDC_SKIP_VERIFY, "");
  });
});

describe("documensoOidcClientSecret", () => {
  it("is 32 random bytes as hex by default, and differs between calls", () => {
    const a = documensoOidcClientSecret();
    const b = documensoOidcClientSecret();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });

  it("uses the injected byte source", () => {
    assert.equal(documensoOidcClientSecret((n) => Buffer.alloc(n, 0xab)), "ab".repeat(32));
  });
});

describe("docker/documenso.oidc.compose.yml", () => {
  const published = compose
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s*"/.test(line));

  it("publishes the provider on 127.0.0.1 only, on the documented port", () => {
    assert.deepEqual(published, [`- "127.0.0.1:${String(DOCUMENSO_OIDC_IDP_PORT)}:8080"`]);
  });

  it("does not use a reserved host port (Cal, Documenso, Twenty, Medusa, Redis)", () => {
    const reserved = [3000, 5555, 5450, 3001, 5451, 2525, 9003, 3002, 5434, 1025, 8025, 9000, 8000, 5433, 6380];
    assert.equal(reserved.includes(DOCUMENSO_OIDC_IDP_PORT), false);
  });

  it("pins the image by tag and digest, matching the constant", () => {
    assert.ok(compose.includes(`image: ${DOCUMENSO_OIDC_IMAGE}`));
    assert.match(DOCUMENSO_OIDC_IMAGE, /^ghcr\.io\/navikt\/mock-oauth2-server:2\.1\.11@sha256:[0-9a-f]{64}$/);
  });

  it("inline JSON_CONFIG equals the TypeScript config, and holds no secret-like word", () => {
    const json = /JSON_CONFIG: '([^']*)'/.exec(compose)?.[1];
    assert.ok(json !== undefined, "JSON_CONFIG not found in the overlay");
    assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(DOCUMENSO_OIDC_IDP_CONFIG)));
    for (const word of ["secret", "password"]) {
      assert.equal(json.toLowerCase().includes(word), false);
    }
  });

  it("the well-known URL uses the published port and the default issuer", () => {
    assert.equal(
      DOCUMENSO_OIDC_WELL_KNOWN_URL,
      `http://127.0.0.1:${String(DOCUMENSO_OIDC_IDP_PORT)}/default/.well-known/openid-configuration`,
    );
  });
});

describe("waitForOidcWellKnown", () => {
  it("resolves once the endpoint answers 200, after failures", async () => {
    let calls = 0;
    await waitForOidcWellKnown("http://127.0.0.1:8081/x", {
      fetch: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("ECONNREFUSED");
        }
        return { status: 200 };
      },
      timeoutMs: 1000,
      intervalMs: 1,
      sleep: async () => {},
    });
    assert.equal(calls, 3);
  });

  it("throws DOCUMENSO_OIDC_IDP_NOT_READY with the URL when it never answers 200", async () => {
    await assert.rejects(
      waitForOidcWellKnown("http://127.0.0.1:8081/wk", { fetch: async () => ({ status: 503 }), timeoutMs: 5, intervalMs: 1 }),
      new RegExp(`${DOCUMENSO_OIDC_IDP_NOT_READY}: http://127\\.0\\.0\\.1:8081/wk`),
    );
  });
});
