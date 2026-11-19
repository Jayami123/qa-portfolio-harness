# LibreChat pin: v0.8.7 to v0.8.9

- Branch: `chore/2026-11-19-librechat-pin-v0.8.9` off `main`. One PR, draft until CI is green, then marked ready. Not merged by the agent.
- Pin: `ghcr.io/librechat-ai/librechat:v0.8.9@sha256:4a3967a47031c1fdba8302a6a341be7671101e40b617f7934ba25aac69fcea2b` (manifest index, pulled by tag on 2026-11-19; the digest is the one Docker reports for the tag).
- Tag dates (from the source repo's tags): v0.8.7 2026-06-24, v0.8.8 2026-09-30, v0.8.9 2026-11-17. The v0.8.9 tag is the newest stable tag. Release notes were not readable through the GitHub API from this session (403), so the review below is from the source diff `v0.8.7..v0.8.9` in `danny-avila/LibreChat`.

## Correction

`src/adapters/librechat-env.ts` and `docs/pins/p4.md` said v0.8.7 was "the newest stable tag at 2026-11-18". That was wrong. v0.8.8 and v0.8.9 had been tagged before that date.

## What the adapter depends on, and what changed

| Adapter dependency | v0.8.9 status | Evidence |
|---|---|---|
| `GET /health` and `GET /api/config` (readiness) | Present | `api/server/index.js:376` (`app.get('/health', ...)`) |
| `GET /api/mcp/tools` (`requireJwtAuth`) | Present | `api/server/routes/mcp.js:128` |
| `GET /api/mcp/connection/status` | Present | `api/server/routes/mcp.js:1063` |
| `npm run create-user -- <email> <name> <username> [--email-verified=false]` | Same usage line | `config/create-user.js:18` |
| `CONFIG_PATH`, `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, `ALLOW_REGISTRATION`, `PORT`, `HOST` | Still in `.env.example` (CREDS_*, JWT_* moved within the file, not removed) | `git diff v0.8.7 v0.8.9 -- .env.example` |
| `requiresOAuth: false` skips OAuth detection | Still short-circuits | `packages/api/src/mcp/registry/MCPServerInspector.ts:138` |
| `librechat.yaml` `version` | Changed from `1.3.13` to `1.3.19` (`CONFIG_VERSION = '1.3.19'`, `packages/data-provider/src/config.ts`). An older version only logs "Outdated Config version" (`packages/api/src/app/checks.ts:386`), so this is not a hard break. The adapter now writes `1.3.19`. | |

## Breaking or notable changes

1. **Config version.** `1.3.19` is written now. Nothing in the adapter was removed.
2. **Env names removed from `.env.example`:** `FLUX_API_BASE_URL`, `MEILI_MASTER_KEY`, `SEARCH`. The adapter never sets them.
3. **Env names added to `.env.example` (optional, not set by the adapter):** `ALLOW_PASSKEY_LOGIN`, `ENABLE_INSIGHTS`, `ENFORCE_TWO_FACTOR_AUTHENTICATION`, `OPENID_DISCOVERY_RETRY_ATTEMPTS`, `OPENID_DISCOVERY_RETRY_DELAY_MS`, `OPENID_REFRESH_BRIDGE_GRACE_MS`, `PASSKEY_STEPUP_MAX`, `PASSKEY_STEPUP_WINDOW`, `SAML_IDP_ISSUER`, `SHARE_VIOLATION_SCORE`, `VIOLATION_SCORE_TTL`. Defaults come from the image. The full-stack run below is the check that the login and MCP paths still work with those defaults.
4. **MCP code was largely rewritten.** The diff is 185 files, +70k/-7k lines, with new approval code (`packages/api/src/mcp/approval.ts`, `tools/approval`) and `toolApproval` (see the H3 plan). The adapter depends only on the three routes in the table; the full-stack run checks them live.
5. **Agent tool approval.** `endpoints.agents.toolApproval` exists from v0.8.8. It is off by default and the adapter does not set it.

## Not checked

- Whether `ALLOW_REGISTRATION=false` and the owner-seed path behave the same. Verified only by the full-stack run.
- Behavior under the new `mcpSettings` and `mcpServers` checks at runtime. Verified only by the full-stack run.
