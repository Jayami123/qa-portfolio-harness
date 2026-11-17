import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appPasswordRequest,
  basicAuthorization,
  cloudUserRequest,
  parseAppPassword,
  parseOcsUserId,
} from "./nextcloud-seed.js";

describe("nextcloud-seed", () => {
  it("builds the app-password request with the OCS header and a Basic login", () => {
    const req = appPasswordRequest("http://127.0.0.1:8080", "qa-owner", "login-secret");
    assert.equal(req.url, "http://127.0.0.1:8080/ocs/v2.php/core/getapppassword?format=json");
    const headers = req.init.headers as Record<string, string>;
    assert.equal(headers["OCS-APIRequest"], "true");
    assert.equal(headers.Authorization, basicAuthorization("qa-owner", "login-secret"));
    const decoded = Buffer.from(headers.Authorization.replace("Basic ", ""), "base64").toString("utf8");
    assert.equal(decoded, "qa-owner:login-secret");
  });

  it("reads the app password and rejects a missing one without echoing the body", () => {
    assert.equal(parseAppPassword({ ocs: { data: { apppassword: "app-pw" } } }), "app-pw");
    assert.throws(
      () => parseAppPassword({ ocs: { data: { apppassword: "" }, leak: "SHOULD_NOT_APPEAR" } }),
      (e: Error) => e.message.startsWith("NEXTCLOUD_APP_PASSWORD_MISSING") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
    assert.throws(() => parseAppPassword(null), /NEXTCLOUD_APP_PASSWORD_MISSING/);
  });

  it("reads the user id and rejects a missing one", () => {
    assert.equal(parseOcsUserId({ ocs: { data: { id: "qa-owner" } } }), "qa-owner");
    assert.throws(() => parseOcsUserId({ ocs: { data: {} } }), /NEXTCLOUD_USER_UNKNOWN/);
  });

  it("builds the cloud/user request with the given Authorization value", () => {
    const req = cloudUserRequest("http://127.0.0.1:8080", "Basic abc");
    assert.equal(req.url, "http://127.0.0.1:8080/ocs/v2.php/cloud/user?format=json");
    assert.equal((req.init.headers as Record<string, string>).Authorization, "Basic abc");
  });
});
