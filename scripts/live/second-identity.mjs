// Live H2 check. Run after `npm run up -- <product>` for each product, with P4_SECOND_IDENTITY=1 in the environment:
//   node scripts/live/second-identity.mjs <product>...
// For each product, the adapter's probeSecondIdentity() checks that the owner and the second identity authenticate as
// two different users, and that the MCP handshake and tools/list pass for both credentials. The check passes only when
// the identities differ and both credentials list at least one tool. Penpot's MCP is single-user and takes no
// credential, so it is reported with the same fields and its two identities are the two Penpot profiles.
// It prints product names, identities (fake emails or usernames), statuses and tool counts only. No key, password or
// token is read into this script's output. Exits 1 if any product fails; the message names the step.
import { loadHarness } from "../lib.mjs";

const products = process.argv.slice(2);
if (products.length === 0) {
  console.error("usage: node scripts/live/second-identity.mjs <product>...");
  process.exit(2);
}

const { getAdapter } = await loadHarness();
let failed = false;

for (const id of products) {
  try {
    const probe = await getAdapter(id).probeSecondIdentity();
    if (!probe.distinct) {
      throw new Error(`the owner and the second identity are the same user (${probe.owner})`);
    }
    if (probe.ownerTools < 1 || probe.secondTools < 1) {
      throw new Error(`the MCP listed no tools (owner ${probe.ownerTools}, second ${probe.secondTools})`);
    }
    console.log(
      `ok ${id}: owner=${probe.owner} second=${probe.second} distinct=yes mcp tools owner=${probe.ownerTools} second=${probe.secondTools}`,
    );
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${id}: ${message}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`H2 live check passed for: ${products.join(" ")}`);
