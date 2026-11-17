import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPatRequest,
  grantPatRoleRequest,
  isSystemAdmin,
  loginRequest,
  mmctlTeamAddArgs,
  mmctlTeamCreateArgs,
  mmctlUserCreateArgs,
  parsePatToken,
  parsePing,
  usersMeRequest,
} from "./mattermost-seed.js";

describe("mattermost-seed", () => {
  it("builds mmctl argv as arrays, with --local and the system-admin flag only when asked", () => {
    const admin = mmctlUserCreateArgs("a@p4.test", "a", "pw", true);
    assert.ok(admin.includes("--local"));
    assert.equal(admin.at(-1), "--system-admin");
    const member = mmctlUserCreateArgs("b@p4.test", "b", "pw", false);
    assert.equal(member.includes("--system-admin"), false);
    assert.deepEqual(mmctlTeamCreateArgs("qa", "QA", "a@p4.test").slice(0, 4), ["mmctl", "--local", "team", "create"]);
    assert.deepEqual(mmctlTeamAddArgs("qa", ["a", "b"]).slice(-2), ["a", "b"]);
  });

  it("builds the login, role grant, PAT and profile requests", () => {
    const login = loginRequest("http://127.0.0.1:8065", "qa-agent", "pw");
    assert.equal(login.url, "http://127.0.0.1:8065/api/v4/users/login");
    assert.deepEqual(JSON.parse(String(login.init.body)), { login_id: "qa-agent", password: "pw" });

    const grant = grantPatRoleRequest("http://127.0.0.1:8065", "u1", "adm", "system_user system_user_access_token");
    assert.equal((grant.init.headers as Record<string, string>).authorization, "Bearer adm");
    assert.equal(JSON.parse(String(grant.init.body)).roles, "system_user system_user_access_token");

    const pat = createPatRequest("http://127.0.0.1:8065", "u1", "sess", "p4-mcp");
    assert.equal(pat.url, "http://127.0.0.1:8065/api/v4/users/u1/tokens");

    assert.equal(usersMeRequest("http://127.0.0.1:8065", "tok").url, "http://127.0.0.1:8065/api/v4/users/me");
  });

  it("reads a 26-character PAT and rejects anything else without echoing it", () => {
    assert.equal(parsePatToken({ token: "abcdefghijklmnopqrstuvwxyz" }), "abcdefghijklmnopqrstuvwxyz");
    assert.throws(
      () => parsePatToken({ token: "SHOULD_NOT_APPEAR_short" }),
      (e: Error) => e.message.startsWith("MATTERMOST_PAT_INVALID") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
    assert.throws(() => parsePatToken({}), /MATTERMOST_PAT_INVALID/);
  });

  it("accepts ping only when the status is OK", () => {
    assert.equal(parsePing({ status: "OK" }), true);
    assert.equal(parsePing({ status: "FAIL" }), false);
    assert.equal(parsePing(null), false);
  });

  it("flags the system admin role", () => {
    assert.equal(isSystemAdmin("system_user system_admin"), true);
    assert.equal(isSystemAdmin("system_user system_user_access_token"), false);
    assert.equal(isSystemAdmin(undefined), false);
  });
});
