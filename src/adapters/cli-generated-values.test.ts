// CLI arguments that carry a generated value. A derived password can start with "-" (about 1 in 64; "secret-8" gives one).
// argparse (Penpot manage.py) and yargs (Medusa CLI) then read a separate "-p" value as a flag, so every builder here puts
// the value in its attached form, or after an explicit "--". Every value in this file is a test fixture.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets } from "../internal/run.js";
import { medusaUserCreateArgs } from "./medusa-seed.js";
import { mailAccountCreateArgs } from "./nextcloud-mail.js";
import { mmctlUserCreateArgs } from "./mattermost-seed.js";
import { createProfileArgs } from "./penpot-seed.js";
import { derivedSecondPassword } from "./p4-second-identity.js";

const DASH_PASSWORD = "-abc123DEF_ghi";

describe("a password that starts with a dash is passed attached", () => {
  it("Penpot create-profile uses --password=<value> and no separate -p", () => {
    const argv = createProfileArgs("qa-user-b@p4.test", "QA User B", DASH_PASSWORD);
    assert.ok(argv.includes(`--password=${DASH_PASSWORD}`));
    assert.ok(!argv.includes(DASH_PASSWORD));
    assert.ok(!argv.includes("-p"));
  });

  it("Medusa user uses --password=<value> and no separate -p", () => {
    const argv = medusaUserCreateArgs("admin@medusa.test", DASH_PASSWORD);
    assert.deepEqual(argv, ["medusa", "user", "--email=admin@medusa.test", `--password=${DASH_PASSWORD}`]);
    assert.ok(!argv.includes("-p"));
  });

  it("Nextcloud occ ends its options with -- before the positional password", () => {
    const argv = mailAccountCreateArgs({ uid: "qa-user-b", name: "QA user B", email: "qa-user-b@p4.test", login: "qa-user-b", password: DASH_PASSWORD });
    const end = argv.indexOf("--");
    assert.equal(end, 1);
    const occurrences = argv.map((item, i) => (item === DASH_PASSWORD ? i : -1)).filter((i) => i >= 0);
    assert.equal(occurrences.length, 2, "IMAP and SMTP each take the password once");
    for (const i of occurrences) assert.ok(i > end, "the password comes after the -- marker");
  });

  it("mmctl keeps the separate form: the pinned mmctl accepts a dashed value there (checked against mattermost-team-edition 12.1.0 mmctl)", () => {
    const argv = mmctlUserCreateArgs("qa-owner@p4.test", "qa-owner", DASH_PASSWORD, true);
    assert.equal(argv[argv.indexOf("--password") + 1], DASH_PASSWORD);
  });
});

describe("derived passwords are passed safely for any value", () => {
  it("covers dash-leading derived passwords, and every builder keeps each one whole", () => {
    let dashCount = 0;
    for (let i = 0; i < 2000; i++) {
      const pw = derivedSecondPassword(`secret-${i}`, "penpot");
      if (pw.startsWith("-")) dashCount += 1;

      const penpot = createProfileArgs("qa-user-b@p4.test", "QA User B", pw);
      assert.ok(penpot.includes(`--password=${pw}`), `penpot attached for secret-${i}`);
      assert.ok(!penpot.includes(pw), `penpot has no bare value for secret-${i}`);

      const medusa = medusaUserCreateArgs("admin@medusa.test", pw);
      assert.ok(medusa.includes(`--password=${pw}`), `medusa attached for secret-${i}`);
      assert.ok(!medusa.includes(pw), `medusa has no bare value for secret-${i}`);

      const mail = mailAccountCreateArgs({ uid: "qa-user-b", name: "QA user B", email: "qa-user-b@p4.test", login: "qa-user-b", password: pw });
      const end = mail.indexOf("--");
      for (const [j, item] of mail.entries()) {
        if (item === pw) assert.ok(j > end, `occ password after -- for secret-${i}`);
      }
    }
    assert.ok(dashCount > 0, "the sample includes dash-leading passwords");
  });

  it("the derivation itself is unchanged: a kept volume gets the same password back", () => {
    assert.equal(derivedSecondPassword("secret-one", "penpot"), "egu8t2WFn-fxFiL3UANajqnjW9iJqpp3iMDN1hzJ-cw");
    assert.equal(derivedSecondPassword("secret-8", "penpot"), derivedSecondPassword("secret-8", "penpot"));
    assert.ok(derivedSecondPassword("secret-8", "penpot").startsWith("-"));
  });
});

describe("passwords stay redacted in the logged command line", () => {
  it("the attached form is redacted by the value, so a log or error shows no password", () => {
    const pw = derivedSecondPassword("secret-8", "penpot");
    const line = ["python3", "manage.py", "create-profile", `--password=${pw}`].join(" ");
    const out = redactSecrets(line, [pw]);
    assert.ok(!out.includes(pw));
    assert.match(out, /--password=\*+/);
  });

  it("the Medusa and occ command lines are redacted the same way", () => {
    const pw = derivedSecondPassword("secret-8", "mattermost");
    for (const argv of [medusaUserCreateArgs("admin@medusa.test", pw), mailAccountCreateArgs({ uid: "u", name: "U", email: "u@p4.test", login: "u", password: pw })]) {
      const out = redactSecrets(argv.join(" "), [pw]);
      assert.ok(!out.includes(pw));
    }
  });
});
