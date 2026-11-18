import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertServersConnected,
  createOwnerArgs,
  librechatMcpEnv,
  librechatMongoUri,
  loginRequest,
  toolCountsByServer,
  tokenFromLogin,
} from "./librechat-seed.js";

describe("librechat-seed (review answers 0.1, 0.6, 0.7)", () => {
  it("percent-encodes the Mongo password and keeps the root auth database", () => {
    assert.equal(
      librechatMongoUri("a/b+c"),
      "mongodb://librechat:a%2Fb%2Bc@mongodb:27017/LibreChat?authSource=admin",
    );
  });

  it("takes the alias URL and the credential, and reads only the credential from the run state", () => {
    const seen: string[] = [];
    const out = librechatMcpEnv(
      ["nextcloud", "penpot"],
      (product, file) => {
        seen.push(file);
        return { mcpAuthorization: product === "penpot" ? null : `Bearer SECRET-${product}` };
      },
      (p) => `/x/${p}`,
    );
    assert.equal(out.servers[0]?.url, "http://nextcloud-mcp:8000/mcp");
    assert.equal(out.env.P4_NEXTCLOUD_MCP_AUTHORIZATION, "Bearer SECRET-nextcloud");
    assert.equal("P4_PENPOT_MCP_AUTHORIZATION" in out.env, false, "Penpot has no header");
    assert.deepEqual(seen, ["/x/nextcloud"], "Penpot's run state is not needed");
  });

  it("throws a named error when a header product has no credential, without the value", () => {
    assert.throws(
      () => librechatMcpEnv(["nextcloud"], () => ({ mcpAuthorization: null }), () => "/x"),
      /LIBRECHAT_MCP_AUTH_MISSING/,
    );
  });

  it("names the product when its run-state file is missing", () => {
    assert.throws(
      () =>
        librechatMcpEnv(
          ["outline"],
          () => {
            throw new Error("P4_RUN_STATE_MISSING: /x does not exist");
          },
          () => "/x",
        ),
      /P4_RUN_STATE_MISSING/,
    );
  });

  it("builds non-interactive create-user arguments with the verified flag and the fake owner", () => {
    const args = createOwnerArgs("pw-1");
    assert.deepEqual(args.slice(0, 4), ["run", "--silent", "create-user", "--"]);
    assert.ok(args.includes("qa-owner@p4.test"));
    assert.ok(args.includes("--email-verified=true"));
  });

  it("builds a login request with the email and password in the body only", () => {
    const req = loginRequest("http://127.0.0.1:3080", "qa-owner@p4.test", "pw-1");
    assert.equal(req.url, "http://127.0.0.1:3080/api/auth/login");
    assert.equal(req.init.method, "POST");
    assert.equal(req.init.headers && (req.init.headers as Record<string, string>)["content-type"], "application/json");
  });

  it("reads the token and refuses a reply without one, without echoing it", () => {
    assert.equal(tokenFromLogin({ token: "t-123" }), "t-123");
    assert.throws(() => tokenFromLogin({ message: "bad secret-leak" }), (err: Error) => !err.message.includes("secret-leak"));
  });

  it("passes when every expected server is connected", () => {
    const body = { connectionStatus: { nextcloud: { connectionState: "connected" }, penpot: { connectionState: "connected" } } };
    assert.doesNotThrow(() => assertServersConnected(body, ["nextcloud", "penpot"]));
  });

  it("names the first server that is not connected", () => {
    const body = { connectionStatus: { nextcloud: { connectionState: "disconnected" } } };
    assert.throws(() => assertServersConnected(body, ["nextcloud"]), /LIBRECHAT_MCP_NOT_CONNECTED: nextcloud is disconnected/);
    assert.throws(() => assertServersConnected({}, ["nextcloud"]), /LIBRECHAT_STATUS_MISSING/);
  });

  it("counts tools per server and refuses a server with none", () => {
    const body = { servers: { penpot: { tools: [{ name: "a" }, { name: "b" }] }, nextcloud: { tools: [{ name: "c" }] } } };
    assert.deepEqual(toolCountsByServer(body, ["penpot", "nextcloud"]), { penpot: 2, nextcloud: 1 });
    assert.throws(
      () => toolCountsByServer({ servers: { penpot: { tools: [] } } }, ["penpot"]),
      /LIBRECHAT_NO_TOOLS: penpot/,
    );
  });
});
