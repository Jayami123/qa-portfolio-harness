// Live H1 check. Run after `P4_MAIL=1 npm run up -- nextcloud` (add P4_SECOND_IDENTITY=1 for qa-user-b):
//   node scripts/live/mail.mjs
// The owner's MCP (nc_mail_*) lists the accounts and the inbox, and sends a marked message. GreenMail must store it for the
// recipient, and after a Mail sync the recipient's MCP inbox must list it. With the second identity, the owner sends to
// qa-user-b, and that identity's own MCP credential must list it. Prints addresses (fake, @p4.test), account ids, counts and
// yes or no flags only. No password, token or message body is read into this script. Exits 1 if a step fails.
import { loadHarness } from "../lib.mjs";

const { getAdapter } = await loadHarness();
const yes = (flag) => (flag ? "yes" : "no");

try {
  const probe = await getAdapter("nextcloud").probeMail();
  const identities = [["owner", probe.owner]];
  if (probe.second) identities.push(["second", probe.second]);
  let failed = false;
  for (const [label, r] of identities) {
    const ok = r.inboxListed && r.sendAccepted && r.greenmailDelivered && r.listedAfterSync;
    failed ||= !ok;
    console.log(
      `${ok ? "ok" : "FAIL"} ${label}: ${r.email} account=${r.accountId} inbox listed (${r.inboxMessages} before) ` +
        `sent=${yes(r.sendAccepted)} greenmail stored=${yes(r.greenmailDelivered)} listed after sync=${yes(r.listedAfterSync)}`,
    );
  }
  if (failed) {
    console.log("FAIL nextcloud mail: a step did not pass (see the flags above)");
    process.exit(1);
  }
  console.log(`H1 live check passed for: nextcloud mail (${identities.length} identit${identities.length === 1 ? "y" : "ies"})`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`FAIL nextcloud mail: ${message}`);
  process.exit(1);
}
