import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { P4_SECOND_IDENTITY_INVALID, parseSecondIdentityFlag, secondIdentityProduct } from "./p4-second-identity.js";
import { ocsCreateUserRequest, ocsSetPasswordRequest, parseOcsProvisionStatus } from "./nextcloud-seed.js";
import { NEXTCLOUD_SECOND_EMAIL, NEXTCLOUD_SECOND_USERNAME } from "./nextcloud-env.js";

describe("H2 second identity: flag (off by default, exact \"1\" only)", () => {
  it("is off when unset", () => {
    assert.equal(parseSecondIdentityFlag(""), false);
  });
  it("is on only for exactly 1", () => {
    assert.equal(parseSecondIdentityFlag("1"), true);
  });
  it("rejects every other value without echoing it", () => {
    for (const bad of ["zz-value-0", "true", "yes", " zz-1", "zz-1 "]) {
      assert.throws(
        () => parseSecondIdentityFlag(bad),
        (err: Error) => err.message.startsWith(P4_SECOND_IDENTITY_INVALID) && !err.message.includes("zz-"),
        `value ${JSON.stringify(bad)}`,
      );
    }
  });
  it("names the second run state after its product", () => {
    assert.equal(secondIdentityProduct("nextcloud"), "nextcloud-b");
  });
});

describe("H2 Nextcloud: provisioning builders", () => {
  it("creates the user as the admin with form fields, and never in the URL", () => {
    const req = ocsCreateUserRequest("http://127.0.0.1:8080", "qa-owner", "owner-secret", NEXTCLOUD_SECOND_USERNAME, "pw-b", NEXTCLOUD_SECOND_EMAIL);
    assert.equal(req.url, "http://127.0.0.1:8080/ocs/v2.php/cloud/users?format=json");
    assert.equal(req.init.method, "POST");
    const headers = req.init.headers as Record<string, string>;
    assert.equal(headers["OCS-APIRequest"], "true");
    assert.equal(headers.Authorization, `Basic ${Buffer.from("qa-owner:owner-secret").toString("base64")}`);
    const body = new URLSearchParams(String(req.init.body));
    assert.equal(body.get("userid"), NEXTCLOUD_SECOND_USERNAME);
    assert.equal(body.get("password"), "pw-b");
    assert.equal(body.get("email"), NEXTCLOUD_SECOND_EMAIL);
    assert.ok(!req.url.includes("pw-b") && !req.url.includes("owner-secret"));
  });
  it("resets a password with a percent-encoded user id", () => {
    const req = ocsSetPasswordRequest("http://h", "qa-owner", "o", "a b", "pw");
    assert.equal(req.url, "http://h/ocs/v2.php/cloud/users/a%20b?format=json");
    assert.equal(req.init.method, "PUT");
    assert.equal(new URLSearchParams(String(req.init.body)).get("key"), "password");
  });
  it("decides by the OCS status code: 102 (exists) is not an error whatever the HTTP status was", () => {
    // Nextcloud answers "User already exists" with HTTP 400 and OCS 102 (proved live on a kept volume).
    assert.equal(parseOcsProvisionStatus({ ocs: { meta: { statuscode: 102, message: "User already exists" } } }), "exists");
  });
  it("reads the OCS status: 100 created, 200 ok, 102 exists, anything else throws without the body", () => {
    assert.equal(parseOcsProvisionStatus({ ocs: { meta: { statuscode: 100 } } }), "created");
    assert.equal(parseOcsProvisionStatus({ ocs: { meta: { statuscode: 200 } } }), "ok");
    assert.equal(parseOcsProvisionStatus({ ocs: { meta: { statuscode: 102 } } }), "exists");
    assert.throws(
      () => parseOcsProvisionStatus({ ocs: { meta: { statuscode: 999, message: "secret-body-text" } } }),
      (err: Error) => err.message.startsWith("NEXTCLOUD_PROVISION_FAILED") && !err.message.includes("secret-body-text"),
    );
  });
});
