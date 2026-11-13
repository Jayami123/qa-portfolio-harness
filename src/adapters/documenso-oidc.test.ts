import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildDocumensoAppEnv } from "./documenso-env.js";
import {
  DOCUMENSO_OIDC_ADMIN_PASSWORD_ENV,
  DOCUMENSO_OIDC_CALLBACK_PATH,
  DOCUMENSO_OIDC_CLIENT_ID,
  DOCUMENSO_OIDC_IDP_NOT_READY,
  DOCUMENSO_OIDC_IDP_PORT,
  DOCUMENSO_OIDC_IMAGE,
  DOCUMENSO_OIDC_INVALID,
  DOCUMENSO_OIDC_OVERLAY,
  DOCUMENSO_OIDC_SETUP_FAILED,
  DOCUMENSO_OIDC_TEST_USERS,
  DOCUMENSO_OIDC_WELL_KNOWN_URL,
  configureOidcProvider,
  documensoOidcClientSecret,
  documensoOidcEnabled,
  documensoOidcOverlayFiles,
  newDocumensoOidcRun,
  waitForOidcWellKnown,
  type OidcFetch,
} from "./documenso-oidc.js";
import { HARNESS_ROOT } from "../paths.js";

const compose = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "documenso.oidc.compose.yml"), "utf8");
const realmText = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "documenso-oidc", "qa-realm.json"), "utf8");
const realm = JSON.parse(realmText) as {
  realm: string;
  clients: Array<{ clientId: string; publicClient: boolean; standardFlowEnabled: boolean; redirectUris: string[]; attributes: Record<string, string> }>;
  users: Array<{ username: string; email: string; emailVerified: boolean; credentials?: unknown }>;
};
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
          err.message.startsWith(DOCUMENSO_OIDC_INVALID) && err.message.includes("DOCUMENSO_OIDC") && !err.message.includes(bad),
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

describe("per-run values", () => {
  it("client secret is 32 random bytes as hex by default, and differs between calls", () => {
    const a = documensoOidcClientSecret();
    const b = documensoOidcClientSecret();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
    assert.equal(documensoOidcClientSecret((n) => Buffer.alloc(n, 0xab)), "ab".repeat(32));
  });

  it("a run has an admin password, a client secret and one password per seeded user, all distinct", () => {
    const run = newDocumensoOidcRun();
    const values = [run.adminPassword, run.clientSecret, ...Object.values(run.userPasswords)];
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual(Object.keys(run.userPasswords).sort(), DOCUMENSO_OIDC_TEST_USERS.map((u) => u.username).sort());
    for (const v of values) {
      assert.ok(v.length >= 20);
    }
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
    assert.match(DOCUMENSO_OIDC_IMAGE, /^quay\.io\/keycloak\/keycloak:26\.5\.0@sha256:[0-9a-f]{64}$/);
  });

  it("passes the admin password by interpolation only, and holds no literal secret or password", () => {
    const yaml = compose.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    assert.ok(yaml.includes(`\${${DOCUMENSO_OIDC_ADMIN_PASSWORD_ENV}}`));
    assert.equal(/password\s*:\s*[^$\s]/i.test(yaml), false);
    assert.equal(/secret/i.test(yaml), false);
  });

  it("mounts the realm file read-only from the harness docker directory", () => {
    assert.ok(compose.includes("./documenso-oidc/qa-realm.json:/opt/keycloak/data/import/qa-realm.json:ro"));
  });

  it("the well-known URL uses the published port and the realm", () => {
    assert.equal(DOCUMENSO_OIDC_WELL_KNOWN_URL, `http://127.0.0.1:${String(DOCUMENSO_OIDC_IDP_PORT)}/realms/qa/.well-known/openid-configuration`);
  });
});

describe("docker/documenso-oidc/qa-realm.json", () => {
  it("holds no secret, no password and no redirect URI (the adapter sets those)", () => {
    const first = realm.clients[0];
    assert.ok(first !== undefined);
    assert.equal(first.redirectUris.length, 0);
    assert.equal(/secret|credentials|password/i.test(realmText), false);
    for (const u of realm.users) {
      assert.equal(u.credentials, undefined);
    }
  });

  it("defines the confidential PKCE client and the realm name the well-known URL uses", () => {
    const client = realm.clients.find((c) => c.clientId === DOCUMENSO_OIDC_CLIENT_ID);
    assert.ok(client !== undefined);
    assert.equal(client.publicClient, false);
    assert.equal(client.standardFlowEnabled, true);
    assert.equal(client.attributes["pkce.code.challenge.method"], "S256");
    assert.equal(realm.realm, "qa");
  });

  it("seeds the same two users as the TypeScript constant, one verified and one not", () => {
    const fromFile = realm.users.map((u) => ({ username: u.username, email: u.email, emailVerified: u.emailVerified })).sort((a, b) => a.username.localeCompare(b.username));
    const fromCode = DOCUMENSO_OIDC_TEST_USERS.map((u) => ({ ...u })).sort((a, b) => a.username.localeCompare(b.username));
    assert.deepEqual(fromFile, fromCode);
    assert.deepEqual(fromCode.map((u) => u.emailVerified).sort(), [false, true]);
  });
});

describe("configureOidcProvider", () => {
  const run = { adminPassword: "admin-pw-test-000000000000", clientSecret: "cs-test-0000000000000000", userPasswords: { verified: "pw-verified-0000000000", unverified: "pw-unverified-000000000" } };
  const clientRow = { id: "client-uuid", clientId: DOCUMENSO_OIDC_CLIENT_ID, secret: "old" };

  function scripted(overrides: Partial<Record<string, number>> = {}): { fetch: OidcFetch; calls: Array<{ url: string; method: string; body?: string }> } {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetch: OidcFetch = async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      const method = init?.method ?? "GET";
      if (url.endsWith("/protocol/openid-connect/token")) {
        return { status: overrides.token ?? 200, json: async () => ({ access_token: "tok" }) };
      }
      if (url.includes("/clients?clientId=")) {
        return { status: 200, json: async () => [clientRow] };
      }
      if (url.includes("/clients/") && method === "PUT") {
        return { status: overrides.putClient ?? 204, json: async () => ({}) };
      }
      if (url.includes("/users?username=")) {
        const name = new URL(url).searchParams.get("username") ?? "";
        return { status: 200, json: async () => [{ id: `${name}-id`, username: name }] };
      }
      if (url.endsWith("/reset-password")) {
        return { status: overrides.reset ?? 204, json: async () => ({}) };
      }
      return { status: 404, json: async () => ({}) };
    };
    return { fetch, calls };
  }

  it("sets the client secret and exact redirect, then resets each user's password, in order", async () => {
    const { fetch, calls } = scripted();
    await configureOidcProvider({ run, webappUrl: "http://127.0.0.1:3001", fetch });
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/clients/client-uuid"));
    assert.ok(put?.body !== undefined);
    const body = JSON.parse(put.body) as { secret: string; redirectUris: string[]; publicClient: boolean; attributes: Record<string, string> };
    assert.equal(body.secret, run.clientSecret);
    assert.deepEqual(body.redirectUris, [`http://127.0.0.1:3001${DOCUMENSO_OIDC_CALLBACK_PATH}`]);
    assert.equal(body.publicClient, false);
    assert.equal(body.attributes["pkce.code.challenge.method"], "S256");
    const resets = calls.filter((c) => c.url.endsWith("/reset-password"));
    assert.equal(resets.length, 2);
    assert.equal(resets.every((c) => c.body !== undefined && JSON.parse(c.body).temporary === false), true);
  });

  it("uses the publicUrl origin for the redirect when the caller passes it", async () => {
    const { fetch, calls } = scripted();
    await configureOidcProvider({ run, webappUrl: "http://p1.lvh.me:3001", fetch });
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/clients/client-uuid"));
    assert.ok(put?.body !== undefined);
    assert.deepEqual((JSON.parse(put.body) as { redirectUris: string[] }).redirectUris, [`http://p1.lvh.me:3001${DOCUMENSO_OIDC_CALLBACK_PATH}`]);
  });

  it("fails with DOCUMENSO_OIDC_SETUP_FAILED naming the step and status, and no secret value", async () => {
    const { fetch } = scripted({ token: 401 });
    await assert.rejects(
      configureOidcProvider({ run, webappUrl: "http://127.0.0.1:3001", fetch }),
      (err: Error) => err.message.startsWith(DOCUMENSO_OIDC_SETUP_FAILED) && err.message.includes("401") && !err.message.includes(run.adminPassword) && !err.message.includes(run.clientSecret),
    );
  });

  it("fails naming the step when the client update is refused", async () => {
    const { fetch } = scripted({ putClient: 403 });
    await assert.rejects(configureOidcProvider({ run, webappUrl: "http://127.0.0.1:3001", fetch }), /set client answered HTTP 403/);
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
