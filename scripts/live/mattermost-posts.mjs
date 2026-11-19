// Live H7 check. Run after `npm run up -- mattermost` with P4_SECOND_IDENTITY=1 and P4_SECOND_POSTS=1:
//   node scripts/live/mattermost-posts.mjs
// Reads town-square as the owner (the MCP's own PAT) and checks that each seeded message exists exactly once and that
// its author is the second identity (qa-agent-b). It prints counts and the second username only. Exits 1 on any failure.
import { loadHarness } from "../lib.mjs";

const { getAdapter } = await loadHarness();
try {
  const probe = await getAdapter("mattermost").probeSeededPosts();
  const ok = probe.missing === 0 && probe.duplicates === 0 && probe.found === probe.expected && probe.authoredBySecond === probe.expected;
  console.log(
    `${ok ? "ok" : "FAIL"} mattermost posts: channel=${probe.channel} expected=${probe.expected} found=${probe.found} missing=${probe.missing} duplicates=${probe.duplicates} authored-by-${probe.secondAuthor}=${probe.authoredBySecond}`,
  );
  if (!ok) {
    process.exit(1);
  }
  console.log(`H7 live check passed: ${probe.expected} posts in ${probe.channel}, all authored by ${probe.secondAuthor}`);
} catch (error) {
  console.log(`FAIL mattermost posts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
