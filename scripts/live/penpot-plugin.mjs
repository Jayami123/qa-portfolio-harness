// Live H6 check. Run after `npm run up -- penpot` with P4_SECOND_IDENTITY=1 and P4_PENPOT_PLUGIN=1 (the two browser tabs
// are open and the MCP plugin is connected in each). For each profile, the MCP is called with that tab's user token:
// it lists its tools, and execute_code returns the name of the file that profile opened. The check passes only when the
// two names differ and each is its own profile's file. It prints the result on stdout (the step log). No token is printed.
import { loadHarness } from "../lib.mjs";

const { getAdapter } = await loadHarness();
try {
  const probe = await getAdapter("penpot").probePerUserPlugin();
  console.log(
    `${probe.ok ? "ok" : "FAIL"} penpot per-user plugin: owner tab sees file=${probe.ownerFile} (matches=${probe.ownerMatches}), second tab sees file=${probe.secondFile} (matches=${probe.secondMatches}), distinct=${probe.distinct}, mcp tools owner=${probe.ownerTools} second=${probe.secondTools}`,
  );
  if (!probe.ok) {
    process.exit(1);
  }
  console.log(`H6 live check passed: the MCP distinguishes the two profiles through their open tabs (${probe.ownerFile} vs ${probe.secondFile}).`);
} catch (error) {
  console.log(`FAIL penpot per-user plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
