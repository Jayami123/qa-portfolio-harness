// Harness-owned seed for Outline (ADR 0006). It runs inside the outline container through `docker compose exec`.
// It creates one team, one fake owner and one API key through Outline's own models (Plan A in the plan: email sign-in
// needs an existing team and user, so a fresh stack cannot sign up). It prints ONE JSON line on stdout:
//   {"apiKey":"ol_api_...","teamId":"...","userId":"..."}
// The key is never written to stderr or to a file. The adapter reads stdout and stores the key in the run state.
"use strict";

const SERVER = "/opt/outline/build/server";
const OWNER_EMAIL = "qa-owner@p4.test";
const OWNER_NAME = "QA Owner";
const TEAM_NAME = "QA Harness";
const TEAM_SUBDOMAIN = "qa";

require(`${SERVER}/storage/database`);
const { Team, User, ApiKey } = require(`${SERVER}/models`);

(async () => {
  let team = await Team.findOne();
  if (!team) {
    team = await Team.create({ name: TEAM_NAME, subdomain: TEAM_SUBDOMAIN, authenticationProviders: [] });
  }
  let user = await User.findOne({ where: { email: OWNER_EMAIL } });
  if (!user) {
    user = await User.create({
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      teamId: team.id,
      role: "admin",
      lastActiveAt: new Date(),
    });
  }
  // An empty scope gets 403 on the MCP endpoint; "*" is the full scope for this fake owner (spike, 2026-11-17).
  const key = await ApiKey.create({ name: "p4-mcp", userId: user.id, scope: ["*"] });
  process.stdout.write(`${JSON.stringify({ apiKey: key.value, teamId: team.id, userId: user.id })}\n`);
  process.exit(0);
})().catch((err) => {
  process.stderr.write(`outline seed failed: ${err && err.name ? err.name : "error"}\n`);
  process.exit(1);
});
