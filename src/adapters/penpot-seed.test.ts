import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authTokenFromSetCookie, createProfileArgs, loginRequest, profileEmail } from "./penpot-seed.js";
import { PENPOT_FLAGS } from "./penpot-env.js";


describe("penpot-seed", () => {
  it("builds the login request as JSON", () => {
    const req = loginRequest("http://127.0.0.1:9001", "qa-owner@p4.test", "pw");
    assert.equal(req.url, "http://127.0.0.1:9001/api/rpc/command/login-with-password");
    assert.equal(req.init.method, "POST");
    assert.deepEqual(JSON.parse(String(req.init.body)), { email: "qa-owner@p4.test", password: "pw" });
  });

  it("reads the auth-token cookie and rejects a reply without one, without echoing headers", () => {
    assert.equal(authTokenFromSetCookie(["auth-token=abc123; Path=/; HttpOnly"]), "abc123");
    assert.equal(authTokenFromSetCookie(["other=1", "auth-token=xyz; Path=/"]), "xyz");
    assert.throws(
      () => authTokenFromSetCookie(["other=SHOULD_NOT_APPEAR"]),
      (e: Error) => e.message.startsWith("PENPOT_AUTH_COOKIE_MISSING") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
  });

  it("builds the create-profile argv as an array, with the flags to skip the tutorials", () => {
    const argv = createProfileArgs("qa-owner@p4.test", "QA Owner", "pw");
    assert.equal(argv[0], "python3");
    assert.ok(argv.includes("--skip-tutorial"));
    assert.ok(argv.includes("--skip-walkthrough"));
    assert.ok(argv.includes("--password=pw"));
    assert.ok(argv.includes("--email=qa-owner@p4.test"));
    assert.ok(argv.includes("--fullname=QA Owner"));
    assert.ok(!argv.includes("-p") && !argv.includes("-e") && !argv.includes("-n"));
  });

  it("reads the profile email and returns null when absent", () => {
    assert.equal(profileEmail({ email: "qa-owner@p4.test" }), "qa-owner@p4.test");
    assert.equal(profileEmail({ id: "x" }), null);
    assert.equal(profileEmail(null), null);
  });

  it("keeps the two flags the spike needed", () => {
    assert.match(PENPOT_FLAGS, /disable-admin-console/);
    assert.match(PENPOT_FLAGS, /enable-prepl-server/);
  });
});
