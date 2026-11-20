import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { librechatMcpServerFor, librechatYaml, allowedDomainsFor } from "./librechat-env.js";
import {
  applyMcpOauth,
  findSecretLeaks,
  LIBRECHAT_MCP_OAUTH_INVALID,
  LIBRECHAT_MCP_OAUTH_NO_SERVER,
  LIBRECHAT_MCP_OAUTH_NOT_REGISTERED,
  mcpWaitNames,
  oauthAuthorizationUrl,
  oauthRedirectUri,
  oauthRegistrationBody,
  parseMcpOauthFlag,
  resolveLibreChatMcpOauth,
  withRegisteredClients,
  type LibreChatMcpOauth,
} from "./librechat-oauth.js";
import { clientIdFromRegistration, LIBRECHAT_OAUTH_REGISTER_FAILED, registerOauthClients } from "./librechat-oauth-register.js";
import { librechatMcpEnv } from "./librechat-seed.js";

const TWENTY_BASE = "http://127.0.0.1:3002";
const CLIENT = "h4-test-client-0001";

const resolved = (products: string[]) =>
  resolveLibreChatMcpOauth({ flag: "1", mcpProducts: products, twentyBrowserBaseUrl: TWENTY_BASE });
/** Options with a client already registered, as the adapter has them after registration. */
const registered = (products: string[]): LibreChatMcpOauth => withRegisteredClients(resolved(products) as LibreChatMcpOauth, { twenty: CLIENT });

describe("parseMcpOauthFlag (default off, exact value)", () => {
  it("is off when unset", () => {
    assert.equal(parseMcpOauthFlag(""), false);
  });
  it("is on only for exactly 1", () => {
    assert.equal(parseMcpOauthFlag("1"), true);
  });
  it("throws without echoing other values", () => {
    for (const bad of ["true", "yes", "01"]) {
      assert.throws(
        () => parseMcpOauthFlag(bad),
        (err: Error) => err.message.startsWith(LIBRECHAT_MCP_OAUTH_INVALID) && !err.message.includes(bad),
      );
    }
  });
});

describe("resolveLibreChatMcpOauth", () => {
  it("returns null with the flag off, whatever the products are", () => {
    assert.equal(resolveLibreChatMcpOauth({ flag: "", mcpProducts: ["twenty"], twentyBrowserBaseUrl: TWENTY_BASE }), null);
  });
  it("selects only the OAuth-capable products named in LIBRECHAT_MCP_PRODUCTS", () => {
    assert.deepEqual(resolved(["nextcloud", "twenty", "outline"])?.products, ["twenty"]);
  });
  it("refuses the flag when no capable product is named", () => {
    assert.throws(() => resolved(["nextcloud", "outline"]), (err: Error) => err.message.startsWith(LIBRECHAT_MCP_OAUTH_NO_SERVER));
  });
  it("strips a trailing slash from the browser base URL and rejects a non-URL", () => {
    assert.equal(resolveLibreChatMcpOauth({ flag: "1", mcpProducts: ["twenty"], twentyBrowserBaseUrl: `${TWENTY_BASE}/` })?.twentyBrowserBaseUrl, TWENTY_BASE);
    assert.throws(() => resolveLibreChatMcpOauth({ flag: "1", mcpProducts: ["twenty"], twentyBrowserBaseUrl: "not a url" }));
  });
  it("has no authorization URL for a product that is not OAuth", () => {
    assert.equal(oauthAuthorizationUrl("nextcloud", registered(["twenty"])), null);
    assert.equal(oauthAuthorizationUrl("twenty", null), null);
    assert.equal(oauthAuthorizationUrl("twenty", registered(["twenty"])), `${TWENTY_BASE}/authorize`);
  });
  it("uses LibreChat's own callback origin, so the callback matches the initiate origin", () => {
    assert.equal(oauthRedirectUri("twenty"), "http://localhost:3080/api/mcp/twenty/oauth/callback");
  });
});

describe("applyMcpOauth", () => {
  it("passes every server through unchanged when the option is off", () => {
    const s = librechatMcpServerFor("twenty");
    assert.equal(applyMcpOauth(s, "twenty", null), s);
  });
  it("drops the static header and writes the pinned oauth block for an OAuth product", () => {
    const s = applyMcpOauth(librechatMcpServerFor("twenty"), "twenty", registered(["twenty"]));
    assert.equal(s.authEnv, null);
    assert.deepEqual(s.oauth, {
      authorizationUrl: `${TWENTY_BASE}/authorize`,
      tokenUrl: "http://twenty-server:3000/oauth/token",
      clientId: CLIENT,
      redirectUri: "http://localhost:3080/api/mcp/twenty/oauth/callback",
      scope: "api profile",
    });
    assert.equal(s.url, "http://twenty-server:3000/mcp");
  });
  it("leaves a non-OAuth product on its static header", () => {
    const s = applyMcpOauth(librechatMcpServerFor("nextcloud"), "nextcloud", registered(["twenty"]));
    assert.equal(s.authEnv, "P4_NEXTCLOUD_MCP_AUTHORIZATION");
    assert.equal(s.oauth, undefined);
  });
  it("refuses to write an OAuth block before the client is registered", () => {
    assert.throws(
      () => applyMcpOauth(librechatMcpServerFor("twenty"), "twenty", resolved(["twenty"])),
      (err: Error) => err.message.startsWith(LIBRECHAT_MCP_OAUTH_NOT_REGISTERED),
    );
  });
});

describe("registration body and answer (no secret requested or read)", () => {
  it("asks for a public client with PKCE-only auth and the callback LibreChat uses", () => {
    const body = oauthRegistrationBody("twenty");
    assert.equal(body.token_endpoint_auth_method, "none");
    assert.deepEqual(body.redirect_uris, ["http://localhost:3080/api/mcp/twenty/oauth/callback"]);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });
  it("reads the client_id from a 201 answer", () => {
    assert.equal(clientIdFromRegistration(201, JSON.stringify({ client_id: CLIENT, client_secret: "x".repeat(20) })), CLIENT);
  });
  it("throws with the status only when the answer is not 201 or 200", () => {
    assert.throws(
      () => clientIdFromRegistration(400, JSON.stringify({ error: "invalid_redirect_uri", client_id: CLIENT })),
      (err: Error) => err.message.startsWith(LIBRECHAT_OAUTH_REGISTER_FAILED) && err.message.includes("HTTP 400") && !err.message.includes(CLIENT),
    );
  });
  it("refuses a non-JSON or client-id-less answer without printing it", () => {
    assert.throws(() => clientIdFromRegistration(201, "<html>secret-body</html>"), (err: Error) => !err.message.includes("secret-body"));
    assert.throws(() => clientIdFromRegistration(201, JSON.stringify({ client_id: "bad id!" })), (err: Error) => !err.message.includes("bad id!"));
  });
  it("posts to the product's registration endpoint and returns the client id", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body) });
      return new Response(JSON.stringify({ client_id: CLIENT }), { status: 201 });
    }) as typeof fetch;
    const out = await registerOauthClients(resolved(["twenty"]) as LibreChatMcpOauth, fake);
    assert.deepEqual(out, { twenty: CLIENT });
    assert.equal(calls[0]?.url, `${TWENTY_BASE}/oauth/register`);
    assert.equal(calls[0]?.body.includes(CLIENT), false);
  });
});

describe("librechatYaml with H4 (config output)", () => {
  const models = ["p4-stub"];
  const base = ["nextcloud", "outline", "twenty", "penpot", "mattermost"];

  it("is byte-identical to the unset output when the option is off", () => {
    const plain = librechatYaml({ models, servers: base.map((p) => librechatMcpServerFor(p)) });
    const off = librechatYaml({ models, servers: base.map((p) => applyMcpOauth(librechatMcpServerFor(p), p, null)) });
    assert.equal(off, plain);
    assert.equal(off.includes("oauth:"), false);
    assert.equal(off.includes("requiresOAuth: true"), false);
  });

  it("writes requiresOAuth true and the pinned block for twenty; the rest is unchanged", () => {
    const servers = base.map((p) => applyMcpOauth(librechatMcpServerFor(p), p, registered(["twenty"])));
    const yaml = librechatYaml({ models, servers });
    const block = yaml.slice(yaml.indexOf("  twenty:"), yaml.indexOf("  penpot:"));
    assert.match(block, /requiresOAuth: true/);
    assert.match(block, /authorization_url: "http:\/\/127\.0\.0\.1:3002\/authorize"/);
    assert.match(block, /token_url: "http:\/\/twenty-server:3000\/oauth\/token"/);
    assert.match(block, /client_id: "h4-test-client-0001"/);
    assert.equal(block.includes("Authorization"), false);
    assert.equal(yaml.match(/requiresOAuth: true/g)?.length, 1);
    assert.equal(yaml.match(/requiresOAuth: false/g)?.length, 4);
    assert.match(yaml, /Authorization: "\$\{P4_NEXTCLOUD_MCP_AUTHORIZATION\}"/);
  });

  it("allows the browser authorize host in mcpSettings, and no other new host", () => {
    const servers = base.map((p) => applyMcpOauth(librechatMcpServerFor(p), p, registered(["twenty"])));
    const off = allowedDomainsFor(base.map((p) => librechatMcpServerFor(p)));
    const on = allowedDomainsFor(servers);
    assert.deepEqual(on.filter((h) => !off.includes(h)), ["127.0.0.1"]);
  });

  it("never writes a client secret", () => {
    const yaml = librechatYaml({ models, servers: base.map((p) => applyMcpOauth(librechatMcpServerFor(p), p, registered(["twenty"]))) });
    assert.equal(/client_secret/.test(yaml), false);
  });
});

describe("librechatMcpEnv with H4 (secret handling)", () => {
  it("does not read or write the Twenty credential when the option is on", () => {
    const reads: string[] = [];
    const readCreds = (product: string) => {
      reads.push(product);
      return { mcpAuthorization: "Bearer abcdefghijklmnopqrstuvwxyz" };
    };
    const out = librechatMcpEnv(["nextcloud", "twenty"], readCreds, () => "unused", registered(["twenty"]));
    assert.deepEqual(reads, ["nextcloud"]);
    assert.equal(Object.keys(out.env).some((k) => k.includes("TWENTY")), false);
    assert.equal(out.servers.find((s) => s.name === "twenty")?.oauth !== undefined, true);
  });

  it("keeps the current behaviour when the option is off", () => {
    const readCreds = () => ({ mcpAuthorization: "Bearer abcdefghijklmnopqrstuvwxyz" });
    const out = librechatMcpEnv(["twenty"], readCreds, () => "unused", null);
    assert.equal(out.env["P4_TWENTY_MCP_AUTHORIZATION"], "Bearer abcdefghijklmnopqrstuvwxyz");
    assert.equal(out.servers[0]?.oauth, undefined);
  });
});

describe("findSecretLeaks (leak check)", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYS1vd25lciJ9.c2lnbmF0dXJlMTIzNDU2";
  it("reports nothing for clean text", () => {
    assert.deepEqual(findSecretLeaks("ok twenty oauth sign-in: connected, tools=7"), []);
  });
  it("flags a listed value without echoing it", () => {
    const secret = "owner-pass-12345678";
    const hits = findSecretLeaks(`log says ${secret}`, { values: [secret] });
    assert.deepEqual(hits, ["listed value"]);
    assert.equal(hits.join("").includes(secret), false);
  });
  it("ignores listed values shorter than 8 characters", () => {
    assert.deepEqual(findSecretLeaks("abc", { values: ["abc"] }), []);
  });
  it("flags JWTs, Bearer tokens, Set-Cookie, cookies, OAuth codes and client secrets", () => {
    assert.ok(findSecretLeaks(`token ${jwt}`).includes("jwt"));
    assert.ok(findSecretLeaks("Authorization: Bearer abcdefghijklmnop1234").includes("bearer"));
    assert.ok(findSecretLeaks("set-cookie: refreshToken=abcdefghijk").includes("set-cookie"));
    assert.ok(findSecretLeaks("refreshToken=abcdefghijk").includes("cookie"));
    assert.ok(findSecretLeaks("/oauth/callback?code=abcdef12345&state=x").includes("oauth-code"));
    assert.ok(findSecretLeaks('client_secret: "s3cr3tvalue"').includes("client-secret"));
  });
});

describe("mcpWaitNames (readiness wait leaves out OAuth products)", () => {
  it("keeps every product when the option is off", () => {
    assert.deepEqual(mcpWaitNames(["nextcloud", "twenty"], null), ["nextcloud", "twenty"]);
  });
  it("leaves the OAuth product out and keeps the static ones", () => {
    assert.deepEqual(mcpWaitNames(["nextcloud", "twenty", "outline"], registered(["twenty"])), ["nextcloud", "outline"]);
  });
  it("is empty when every product is an OAuth product", () => {
    assert.deepEqual(mcpWaitNames(["twenty"], registered(["twenty"])), []);
  });
});
