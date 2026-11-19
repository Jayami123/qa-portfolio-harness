import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GREENMAIL_API_URL,
  GREENMAIL_IMAGE,
  P4_MAIL_INVALID,
  greenmailComposeFiles,
  greenmailCreateUserRequest,
  greenmailMessagesRequest,
  greenmailReadyRequest,
  parseGreenmailSubjects,
  parseMailFlag,
} from "./greenmail-env.js";

describe("H1 flag: P4_MAIL is off by default and exactly 1 turns it on", () => {
  it("is false when empty and true for exactly 1", () => {
    assert.equal(parseMailFlag(""), false);
    assert.equal(parseMailFlag("1"), true);
  });

  it("throws P4_MAIL_INVALID for any other value, without echoing it", () => {
    for (const value of ["true", "yes", "0", "on-secret-x"]) {
      assert.throws(
        () => parseMailFlag(value),
        (error: Error) => {
          assert.match(error.message, new RegExp(`^${P4_MAIL_INVALID}`));
          assert.equal(error.message.includes(value), false);
          return true;
        },
      );
    }
  });
});

describe("GreenMail pin and compose file", () => {
  it("pins GreenMail 2.1.15 by a 64-hex digest", () => {
    assert.match(GREENMAIL_IMAGE, /^greenmail\/standalone:2\.1\.15@sha256:[0-9a-f]{64}$/);
  });

  it("uses the harness docker directory and the greenmail compose file", () => {
    const [file] = greenmailComposeFiles();
    assert.equal(file?.replaceAll("\\", "/").endsWith("/docker/greenmail.compose.yml"), true);
  });
});

describe("GreenMail REST requests (no request is logged here)", () => {
  it("creates a user with POST /api/user and the password in the body only", () => {
    const req = greenmailCreateUserRequest("qa-owner", "qa-owner@p4.test", "secret-value-1");
    assert.equal(req.url, `${GREENMAIL_API_URL}/api/user`);
    assert.equal(req.init.method, "POST");
    assert.equal(req.url.includes("secret-value-1"), false);
    assert.deepEqual(JSON.parse(String(req.init.body)), { login: "qa-owner", email: "qa-owner@p4.test", password: "secret-value-1" });
  });

  it("reads a user's messages from an address encoded in the path", () => {
    const req = greenmailMessagesRequest("qa-owner@p4.test");
    assert.equal(req.url, `${GREENMAIL_API_URL}/api/user/qa-owner%40p4.test/messages`);
  });

  it("uses GET for readiness", () => {
    assert.equal(greenmailReadyRequest().init.method, "GET");
  });
});

describe("parseGreenmailSubjects", () => {
  it("returns the subjects of an array reply", () => {
    assert.deepEqual(parseGreenmailSubjects([{ subject: "a" }, { subject: "b" }, { uid: "3" }]), ["a", "b"]);
  });

  it("returns an empty list for anything that is not an array of messages", () => {
    assert.deepEqual(parseGreenmailSubjects(undefined), []);
    assert.deepEqual(parseGreenmailSubjects({ subject: "x" }), []);
    assert.deepEqual(parseGreenmailSubjects([null, 1, "x"]), []);
  });
});
