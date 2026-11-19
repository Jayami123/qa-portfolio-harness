import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GREENMAIL_IMAP_PORT, GREENMAIL_SMTP_PORT } from "./greenmail-env.js";
import {
  MAIL_APP_SHA256,
  MAIL_APP_URL,
  MAIL_APP_VERSION,
  mailAccountCreateArgs,
  mailAccountsRequest,
  parseAppInfoVersion,
  parseMailAccounts,
} from "./nextcloud-mail.js";

describe("Mail app pin", () => {
  it("pins the release by version, URL and a 64-hex SHA-256", () => {
    assert.equal(MAIL_APP_VERSION, "5.13.3");
    assert.ok(MAIL_APP_URL.endsWith(`/v${MAIL_APP_VERSION}/mail-v${MAIL_APP_VERSION}.tar.gz`));
    assert.match(MAIL_APP_SHA256, /^[0-9a-f]{64}$/);
  });

  it("reads the version from appinfo/info.xml", () => {
    assert.equal(parseAppInfoVersion("<info>\n\t<id>mail</id>\n\t<version>5.13.3</version>\n</info>"), "5.13.3");
    assert.equal(parseAppInfoVersion("<info><id>mail</id></info>"), undefined);
  });
});

describe("mailAccountCreateArgs", () => {
  it("builds the occ call for one IMAP account on GreenMail with password login", () => {
    const args = mailAccountCreateArgs({ uid: "qa-owner", name: "QA owner", email: "qa-owner@p4.test", login: "qa-owner", password: "pw-1" });
    assert.deepEqual(args, [
      "mail:account:create-imap",
      "qa-owner",
      "QA owner",
      "qa-owner@p4.test",
      "greenmail",
      String(GREENMAIL_IMAP_PORT),
      "none",
      "qa-owner",
      "pw-1",
      "greenmail",
      String(GREENMAIL_SMTP_PORT),
      "none",
      "qa-owner",
      "pw-1",
      "password",
    ]);
  });

  it("uses the login name, not the address, for IMAP and SMTP", () => {
    const args = mailAccountCreateArgs({ uid: "qa-user-b", name: "QA user B", email: "qa-user-b@p4.test", login: "qa-user-b", password: "pw" });
    assert.equal(args[7], "qa-user-b");
    assert.equal(args[12], "qa-user-b");
  });
});

describe("mail accounts list", () => {
  it("sends the user's own Basic credential with the OCS header", () => {
    const req = mailAccountsRequest("http://127.0.0.1:8080", "Basic dXNlcjpwdw==");
    assert.equal(req.url, "http://127.0.0.1:8080/index.php/apps/mail/api/accounts");
    const headers = req.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Basic dXNlcjpwdw==");
    assert.equal(headers["OCS-APIRequest"], "true");
  });

  it("keeps only entries with a numeric id and an address", () => {
    assert.deepEqual(
      parseMailAccounts([{ id: 2, emailAddress: "a@p4.test" }, { id: "x", emailAddress: "b" }, { id: 3 }, null]),
      [{ id: 2, emailAddress: "a@p4.test" }],
    );
    assert.deepEqual(parseMailAccounts({ accounts: [] }), []);
  });
});
