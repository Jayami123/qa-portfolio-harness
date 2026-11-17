# 0006. Add the P4 products as image-only harness adapters

- Status: Accepted
- Date: 2026-11-18

## Context

P4 needs Nextcloud, Outline, Penpot and Mattermost next to Cal, Documenso, Medusa and Twenty. Each needs an MCP endpoint
the suite can call. None of the four has a fork under `PRODUCTS_ROOT`. `ProductConfig.productRoot` is required, and
`loadConfig()` resolves a fork for each of the original four. `CONTRIBUTING.md` asks for an ADR before any upstream-default
change to `docker/*.compose.yml`. The plan is `docs/plans/2026-11-18-harness-p4-adapters.md`. Its spike results are in
section 17 and its approval decisions in section 16.

## Decision

1. **Same architecture.** One adapter per product extends `BaseAdapter`. Pure helpers sit beside it, each with a unit test.
   Each product has a harness-owned compose file, a project named `qa-harness-<product>`, and ports on `127.0.0.1`.
2. **`productRoot = .harness/<product>` (D1, accepted).** `loadConfig()` stays eager over the four fork products.
   The P4 products load through `loadProductConfig(id)` only. A unit test (`src/config-p4.test.ts`) proves the four fork
   products resolve exactly as before, and that P4 roots never depend on `PRODUCTS_ROOT`.
3. **Pins.** Every image is `repo:tag@sha256:digest`. The table is `docs/pins/p4.md`. `src/adapters/p4-pins.test.ts`
   fails when a compose file or Dockerfile is not digest-pinned, or when a digest is missing from the table.
4. **Readiness.** Each product waits for app health and then for a real MCP `initialize`, `notifications/initialized` and
   `tools/list`, made with the product's scoped credential. Nextcloud and Mattermost also prove the account on the product's
   own API.
5. **Run state (D7).** Each product writes `.harness/<product>-run.json` (mode 0600), which holds the MCP URL and the
   Authorization value. Only `readP4McpCredentials` reads it. Database and product secrets are generated per run and kept
   in `.harness/<product>/secrets.json` (mode 0600), because the databases and installers read them only at first
   initialisation. `down` removes the run state. `down` with `<PRODUCT>_DOWN_VOLUMES=1` also removes the volumes and the
   secrets file.
6. **Twenty (Q6).** `TWENTY_MCP=1` (exact value) mints a least-privilege API key through the `loginToken` exchange and waits
   for `/mcp`. `docker/twenty.compose.yml` and every Twenty default are unchanged. The observed digest is recorded in
   `docs/pins/p4.md` only.
7. **Memory budget.** 14 GiB (14336 MiB) of a 16 GB runner. `scripts/p4-ram-probe.sh` writes `evidence/ram-probe.json`.
   The budget is checked against the peak of the per-instant sum across containers. The probe exits 1 when it does not fit.

## Product decisions

**Nextcloud (Q3, D9).** The MCP server is `cbcoutinho/nextcloud-mcp-server` at its pinned digest. It runs in
`MCP_DEPLOYMENT_MODE=multi_user_basic`, with no server-side Nextcloud credential. Each client sends its own app password as
Basic auth, and the server passes it through to Nextcloud. This is authenticated pass-through, preferred over an
unauthenticated `/mcp`. The spike verified it (wrong password: 401; no credentials: 400). An official Nextcloud-published
MCP app was checked and is **UNVERIFIED**: the appstore was unreachable from the session, so it could not be ruled out.

**Outline (Q1).** The licence is **BSL 1.1**. BSL 1.1 allows non-production self-hosted use, and a local QA harness is that
use. The product is not used for production. The MCP is Outline's built-in `/mcp` (20 tools). Outline's email sign-in
needs an existing team and user, so the owner and team are created through Outline's own models in a harness script
(`docker/outline-seed.cjs`). The script prints one JSON line, and the adapter masks API keys in the console echo.

**Penpot.** The MCP is the official `penpotapp/mcp` image (MIT). It runs in single-user mode on loopback. The plugin UI sends
no token, so single-user is what connects. A design edit needs a browser with the MCP plugin connected, which the Playwright
spike verified (plugin connected; `high_level_overview` returned `isError: false`). Readiness proves `tools/list` only.
The image does not proxy the plugin's `/mcp/ws` path, so the harness mounts `docker/penpot-mcp-ws.conf`.

**Mattermost (Q2).** The MCP is the standalone `mattermost-mcp-server`, built from pinned commit `96ecd17c` of
`mattermost/mattermost-plugin-agents` (Apache-2.0). **It is a development-only binary, used for local testing.** The
upstream documents it as not supported for production. The embedded endpoint needs an Enterprise licence, which this
harness does not use. The binary is built by `docker/mattermost-mcp.Dockerfile` (multi-stage, base images pinned by digest)
and bound to 127.0.0.1 on the host. The credential is a personal access token for a member account that has no admin
role. The owner, a system admin, is used only for setup.

## Alternatives considered

- Make `productRoot` optional. Rejected: it changes a shared interface used by the four existing adapters.
- A shared abstract base adapter. Rejected: a second architecture next to the existing pattern.
- Outline's BSL 1.1 licence: accepted for local QA use only (Q1). Alternatives are Docmost or Wiki.js, which have no
  built-in MCP.
- Mattermost's embedded Enterprise endpoint. Rejected: it needs an Enterprise licence this harness does not have (Q2).
- Nextcloud single-user MCP mode with the app password in the server environment. Rejected: pass-through is authenticated
  and holds no server credential (Q3).

## Consequences

- New licence exposure: Outline BSL 1.1; Nextcloud MCP AGPL-3.0-only; Mattermost source AGPL-3.0 or commercial (the
  compiled product is MIT); Penpot MPL-2.0 (MCP MIT); Mattermost MCP Apache-2.0.
- The Mattermost MCP binary is development-only upstream. The adapter labels it so in every output and in the README.
- Penpot tool calls and Mattermost tool calls need their own proof. The readiness check does not run a tool call.
- Database passwords are generated per run and not written in any committed file. This departs from the Medusa defaults,
  which contain a literal password. `CLAUDE.md` forbids committed passwords, so the P4 defaults contain none.
- Each product bump is a deliberate edit to `docs/pins/p4.md` and the matching constants; the pin test fails otherwise.
- The sandbox proxy needs `MATTERMOST_EXTRA_CA_FILE` for the Mattermost MCP build. CI does not set it.
- If the RAM probe does not fit the budget, the split in plan section 10 applies, and a second ADR (`0007`) records it.
