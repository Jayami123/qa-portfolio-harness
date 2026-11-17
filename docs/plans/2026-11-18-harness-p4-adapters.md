# Harness P4 adapters (Nextcloud, Outline, Penpot, Mattermost, Twenty MCP)

## 1 Header

- Repo: `qa-portfolio-harness` · [Jayami123/qa-portfolio-harness](https://github.com/Jayami123/qa-portfolio-harness) · harness
- Branch: `feat/2026-11-18-harness-p4-adapters` from `main` at **15aedca** (v0.5.1). This is a **plan branch** for review. The draft PR contains this file only. Do not build until the reviewer approves.
- Lane: P4 Lane 1, part A (harness adapters). Part B (LibreChat, OpenClaw, LiteLLM, stub model, Gemma proof) is a separate suite repo and is **not** in this plan.
- Date: 2026-11-18. The probe ran on 2026-11-17 in a cloud session (Docker 29.10.0, Node 22.23.3, 4 vCPU, 15 GiB RAM).
- Labels in this file: **VERIFIED** (observed this session, command or file named), **INFERRED** (reasoned, not observed), **UNVERIFIED** (could not be checked; a build-phase spike must settle it).
- Start and stop products only through `npm run up -- <product>` and `npm run down -- <product>`. Finish every run with `down` and confirm no `qa-harness-*` container is left.

## 2 Goal and scope

**In scope**

1. Four new image-only adapters: `nextcloud`, `outline`, `penpot`, `mattermost`. Each starts a pinned compose stack, waits for app health **and** its MCP endpoint, seeds one fake owner plus a scoped MCP credential, and stops cleanly.
2. Twenty: extend the existing adapter **only** to mint a scoped MCP credential and wait for `/mcp`, behind the opt-in `TWENTY_MCP=1`. No change to Twenty defaults. The fork is never edited.
3. A pin table `docs/pins/p4.md`, a RAM probe, one CI job, one ADR, unit tests.

**Out of scope:** LibreChat, OpenClaw, LiteLLM, the stub model, the Gemma proof, any LLM key, product fork edits, bumping the Twenty pin, Playwright, releases and tags.

## 3 Probe results (2026-11-17)

### 3.1 Summary table

Pins are image digests (multi-arch index digests from Docker Hub or ghcr.io). "Release tag" is the newest stable **image** tag; the GitHub releases pages were blocked from this session, so upstream release notes are UNVERIFIED.

| Product | Upstream repo · licence | Release tag · pin | MCP server | Transport | MCP auth | Tools | Status |
|---|---|---|---|---|---|---|---|
| Nextcloud | [nextcloud/server](https://github.com/nextcloud/server) · AGPL-3.0 (UNVERIFIED, not read this session) | `35.0.3-apache` · `sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3` | [cbcoutinho/nextcloud-mcp-server](https://github.com/cbcoutinho/nextcloud-mcp-server) `0.213.2` · AGPL-3.0-only (PyPI metadata) · `ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325`. Most-used server. **An official Nextcloud-published MCP app could not be confirmed: UNVERIFIED** (apps.nextcloud.com was unreachable). | streamable HTTP, `http://127.0.0.1:8000/mcp`, **stateful** (`Mcp-Session-Id`) | App password (Basic) to Nextcloud, set by env in single-user mode. In that mode the `/mcp` endpoint itself takes no client credential. | **188** (live `tools/list`, no Nextcloud reachable) | VERIFIED |
| Outline | [outline/outline](https://github.com/outline/outline) · **Business Source License 1.1** (`package.json` in the image) | `1.13.0` · `sha256:4583bb244dbb4464d8a632c75044d3b2f9fe44382b6a4b84d97995f473b823e4` | Built-in, same image. Route `POST /mcp` (`build/server/routes/mcp`). Team preference `MCP` defaults to `true` (`build/shared/constants.js:110`). | streamable HTTP (JSON replies) | `Authorization: Bearer` with an Outline API key, or OAuth. The route accepts auth types `MCP`, `OAUTH`, `API`. | **20** registered names, read from the build (static). Runtime `tools/list` is scope-filtered: UNVERIFIED. | MCP VERIFIED static; runtime UNVERIFIED |
| Penpot | [penpot/penpot](https://github.com/penpot/penpot) · MPL-2.0 (LICENSE header) | `2.19.2` · frontend `sha256:27af83e1…66a8`, backend `sha256:b6c60250…5e4e`, exporter `sha256:60fdaddd…29d7` (full digests in section 7) | Official, in-repo `mcp/` (standalone `penpot/penpot-mcp` is archived). Image `penpotapp/mcp:2.19.2@sha256:94c6672072a1fbbdb5ff577375e96d3f67b3a67ecdcd8f81498c5ec27eba36f3` · MIT (`mcp/packages/server/package.json`). | streamable HTTP `http://127.0.0.1:4401/mcp` (legacy `/sse` removed). Plugin bridge: WebSocket `4402`. | Penpot user token. Image runs `node index.js --multi-user`; the query parameter is `?userToken=` (seen in server logs). `initialize` and `tools/list` answered with **no** token. | **4**: `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape` (live) | VERIFIED. **Tool calls need a browser with the Penpot MCP plugin connected: not testable by `tools/list`.** |
| Mattermost | [mattermost/mattermost](https://github.com/mattermost/mattermost) · MIT for compiled builds, AGPL-3.0 or commercial for source (`LICENSE.txt`) | `mattermost-team-edition:12.1.0` · `sha256:35927b9c535a9eb74f0e45385d3fe5d8308b16e0464031f157a834da8af3ee73` | Official: [mattermost-plugin-agents/mcpserver](https://github.com/mattermost/mattermost-plugin-agents) · Apache-2.0. **Embedded production endpoint needs an Enterprise licence.** The standalone `mattermost-mcp-server` binary is documented "development and local tooling only". No published image found. | stdio, or HTTP at `/mcp` (stateful, `Mcp-Session-Id`). | PAT for the Mattermost API (`--token` / `MM_ACCESS_TOKEN`). HTTP mode documents OAuth for clients. How a headless client authenticates: UNVERIFIED. | 12 documented (`read_post`, `read_channel`, `search_posts`, `create_post`, `create_channel`, `get_channel_info`, `get_team_info`, `search_users`, `get_channel_members`, `get_team_members`, `add_channel_member`, `add_team_member`), plus plugin meta-tools. Runtime UNVERIFIED. | **UNVERIFIED** (weakest adapter) |
| Twenty (existing) | [twentyhq/twenty](https://github.com/twentyhq/twenty), fork `Jayami123/twenty-CRM` at `7cbdfec6` · licence not re-probed (UNVERIFIED) | `v2.44.0` · `twentycrm/twenty@sha256:01fb6d2c00397976fd7613dbeb9703b514b52fb6270339b7a326a2a975d15b26` (from `docker pull`) | Built in. `POST /mcp` on the app port. | streamable HTTP; replies `text/event-stream` when `Accept` includes it | `Authorization: Bearer` API key (JWT from `generateApiKeyToken`), or OAuth | **7** in default mode (live) | VERIFIED |

### 3.2 Twenty MCP at the harness pin (VERIFIED, live)

Requirement: find out whether MCP exists at `v2.44.0` and how it is enabled.

- **Exists:** the image contains `dist/engine/api/mcp/**` (`docker run ... find`). The fork source has `McpModule` imported unconditionally in `app.module.ts:68` and the route is `POST /mcp` (`ApiPath.Mcp = 'mcp'`). No env var or feature flag gates it: `grep` of `config-variables.ts` finds nothing, and a stack started by the harness with **no** extra setting answered `/mcp`. **No Twenty bump is needed. Stopping condition not triggered.**
- **Unauthenticated probe:** `POST http://127.0.0.1:3002/mcp` → `401`, `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="api profile"`. `GET /mcp` → `405` ("only accepts POST"). `GET /.well-known/oauth-protected-resource/mcp` → `200`.
- **How it is "enabled" in practice:** it is always on. What the harness must add is a **scoped credential**:
  1. `signIn` → workspace `loginToken` → `getAuthTokensFromLoginToken(origin = baseUrl)` gives a workspace-scoped access token.
  2. `getApiKeyRoles` lists assignable roles. The dev seed offers `Admin`, `Impersonate-only` and `Object-restricted`.
  3. `createApiKey(name, expiresAt, roleId)` with the least-privileged role, then `generateApiKeyToken(apiKeyId, expiresAt)`.
  4. `POST /mcp` with that bearer.
- **Result:** `initialize` → `200`, `text/event-stream`, `serverInfo = {name: "Twenty MCP Server", version: "0.1.0"}`, protocol `2025-06-18`. `tools/list` → `200`, 52 ms, **7 tools**: `search_help_center`, `get_tool_catalog`, `execute_tool`, `load_skills`, `list_object_metadata_names`, `list_skills`, `learn_tools`. The key was revoked afterwards. No token was printed.
- **Trap found (affects the build):** the harness `authenticate()` returns the `signIn` token. `/mcp` answers **401** to it and `getApiKeyRoles` answers `FORBIDDEN` ("not available to this caller"). Only the `loginToken` exchange token can mint API keys. The Twenty MCP helper must use the exchange path, not `authenticate()`.
- Timings on this session: `up twenty` healthy in about 80 s, `seed` about 90 s. Resting memory (`docker stats`): server 884 MiB, worker 746 MiB, db 149 MiB, redis 21 MiB, mailpit 6 MiB, **total about 1.8 GiB**.
- Cleanup: `npm run down -- twenty`, then `docker ps -a --filter name=qa-harness` returned 0. The fork `git status` stayed empty.

### 3.3 Docker in this session (VERIFIED)

Docker works. `docker run hello-world` pulled and ran. I also pulled and ran `penpotapp/mcp` and the Nextcloud MCP image, and ran the Twenty stack through the harness. Runtime proof is therefore possible in a cloud session for single products, so CI is the proof for the **combined** stack (memory, disk). Limits seen: 15 GiB RAM, 14 GB free disk (about 5.5 GB of images were already pulled by the probe). A blanket `docker rm -f $(docker ps -aq)` was denied by the session's permission classifier, so containers were removed by name only.

### 3.4 What the existing code looks like (VERIFIED, read this session)

- Contract: `ProductAdapter` (`src/adapters/types.ts`): `id, productRoot, baseUrl, dbUrl, up, down, health, waitHealthy, seed, authenticate, proveAuth`. `BaseAdapter<C extends ProductConfig>` adds default `waitHealthy` and a no-op `proveAuth`.
- Registry: `getAdapter(id)` is an exhaustive `switch` with a `never` default. `ProductId` is `"cal" | "documenso" | "medusa" | "twenty"` in `src/types.ts`. `scripts/lib.mjs` has `PRODUCT_IDS` and `scripts/up.mjs`, `down.mjs`, `smoke.mjs` take the product as an argument.
- Config: `src/config.ts` has one zod `envSchema`, one `build<Product>Config` per product, `loadConfig()` (eager, all four, each calls `resolveExistingDir` on a fork) and `loadProductConfig(id)` (one product, with `cached[id]` shortcut).
- Compose: `composeUp(opts, {wait})`, `composeDown`, `harnessComposeFile(name)` in `src/internal/compose.ts`. Harness-owned compose (Documenso, Medusa) is standalone, `name: qa-harness-<product>`, ports on `127.0.0.1`. Twenty is an overlay on the fork's compose.
- Readiness: `pollHealth` / `waitUntilHealthy` (`src/wait/health.ts`), `isOk` predicate, 2 s interval, throws `Timed out waiting for …`.
- Run state: `.harness/documenso-oidc-run.json`, gitignored, mode `0600`, written by `up`, removed by `down`, read by a typed reader that throws named errors and never prints values (`documenso-oidc-run-state.ts`).
- Pins: Twenty by tag `v2.44.0` plus a runtime `docker inspect` check (`assertRunningServerImage`); Redis `redis:8.10.3@sha256:1f88291b…` (ADR 0005); Keycloak by tag and digest; Mailpit `axllent/mailpit:v1.22.3`.
- Docs: `docs/adr/0001, 0002, 0003, 0005` (0004 does not exist). `CONTRIBUTING.md:40` requires an ADR-level reason before changing an upstream-default compose overlay.
- CI: `ci.yml` only builds, tests and packs. **There is no Docker live job today.** Actions pinned by full SHA with a version comment: `actions/checkout@3d3c42e5…` (v7.0.1), `actions/setup-node@949feb24…` (v7.1.0), `github/codeql-action@24c54180…` (v4.38.3).
- The repo is **public** (`gh api` → `private: false`). INFERRED from GitHub's runner docs: a public repo's `ubuntu-latest` has 4 vCPU, 16 GB RAM and about 14 GB of free SSD. I could not verify the runner size from here.

### 3.5 Findings that change or constrain the request

1. **Outline is BSL 1.1, not open source.** It is free for non-production and internal self-hosted use, but it is not an OSI licence. Fine for a local QA harness; the reviewer should confirm it is acceptable for the portfolio. Alternative if not: Docmost or Wiki.js (no built-in MCP, so a third-party server is needed).
2. **Mattermost's official MCP needs Enterprise.** The embedded endpoint (`/plugins/mattermost-ai/mcp-server/mcp`) requires an Enterprise licence to turn on. The only free path is the standalone binary, which Mattermost documents as development-only, with no published image. Section 6 task 6 contains the decision gate.
3. **Penpot MCP tools act through a browser.** `tools/list` works with no browser, but `execute_code` and `export_shape` need a Penpot tab with the plugin connected over WebSocket. Readiness can prove the endpoint and tool list only. A tool call needs Playwright, which is out of scope here.
4. **Nextcloud MCP `tools/list` succeeds with no Nextcloud reachable** (188 tools, dummy host). It proves nothing about Nextcloud. Readiness must also call Nextcloud itself.
5. **None of the four new products has a fork.** `ProductConfig.productRoot` is required, and `loadConfig()` calls `resolveExistingDir` for every product. Design decision D1 below keeps both unchanged.
6. **Disk may be the first limit, not RAM.** Images pulled by the probe were 5.5 GB for about half the stack. The CI job frees disk and the probe records `df`.

## 4 Design decisions (industry practice first; non-standard choices flagged)

- **D1 productRoot for image-only products.** `productRoot` = `<HARNESS_ROOT>/.harness/<product>` (the harness's own state dir, created by `up`). It is the only directory the adapter writes to. *Alternative:* make `productRoot` optional in `ProductConfig`. Rejected: it changes a shared interface used by all four existing adapters.
- **D2 `loadConfig()` stays eager over the four existing forks.** `HarnessConfig` is unchanged. New products are reachable only through `loadProductConfig(id)`. Add `ForkProductId = "cal" | "documenso" | "medusa" | "twenty"` and `P4ProductId = "nextcloud" | "outline" | "penpot" | "mattermost"`; `ProductId = ForkProductId | P4ProductId`. In `loadProductConfig`, the cache shortcut applies to `ForkProductId` only. This keeps existing defaults byte-for-byte.
- **D3 Same architecture, no new base class.** Each adapter extends `BaseAdapter` directly, like Twenty and Medusa. Shared logic is **pure functions in small files** (`mcp-ready.ts`, `p4-run-state.ts`, `p4-ram.ts`), each with a `.test.ts`. No intermediate abstract class.
- **D4 Optional MCP capability on the interface.** Add to `ProductAdapter`:
  `waitMcp?(timeoutMs?: number): Promise<McpReadiness>` and `mcpRunStateFile?(): string`. Optional, so Cal, Documenso and Medusa are untouched.
- **D5 Pinning.** Every image is `repo:tag@sha256:digest` (tag for humans, digest for immutability), the same style as Redis (ADR 0005) and Keycloak. After `up`, the adapter runs `docker inspect` on each service and throws if `Config.Image` differs from the pin (same as `assertRunningServerImage`). Bumps are deliberate PRs that edit `docs/pins/p4.md` and the constants together; a unit test fails if they disagree (section 7).
- **D6 Ports.** All on `127.0.0.1`, none overlapping existing 3000, 3001, 3002, 3003, 5433, 5434, 5450, 5451, 5555, 6380, 8000, 8025, 8026, 8081, 9000, 9003, 1025, 2525:

  | Product | App | MCP | Postgres | Other |
  |---|---|---|---|---|
  | nextcloud | 8080 | 8765 (container 8000) | 5460 | none |
  | outline | 3010 | same as app, `/mcp` | 5461 | mailpit UI/API 8027 |
  | penpot | 9001 | 4401 | 5462 | bridge WebSocket 4402 |
  | mattermost | 8065 | 8066 | 5463 | none |

  Postgres is published on loopback to match the existing `dbUrl` convention. Redis and Valkey are not published.
- **D7 Secrets.** The harness generates every secret per run with `crypto.randomBytes`. Product secrets go into the compose environment via the adapter's process env (like Twenty's `TAG`), never into a committed file. Tokens go only to `.harness/<product>-run.json` (gitignored, `0600`). Nothing prints a token, password or key; errors name the variable, not the value. *Known limit:* `docker inspect` shows container env. Acceptable for a throwaway loopback stack; stated here so nobody assumes otherwise.
- **D8 Fake owner.** One user per product: username `qa-owner`, email `qa-owner@p4.test` (`.test` is reserved by RFC 2606), password generated per run. No real data.
- **D9 Nextcloud MCP auth mode (non-standard, flagged).** Single-user mode puts one app password in the MCP container env and leaves `/mcp` itself unauthenticated, bound to `127.0.0.1` only. The standard alternative is the server's multi-user pass-through mode, where the client sends the app password as `Authorization: Basic`. The pass-through env switch is **UNVERIFIED**. Task 3 starts with a 30-minute spike; if pass-through works it becomes the default and the run state holds the app password for the client. Otherwise single-user stays, with the loopback bind as the control.
- **D10 No shared mail container.** Twenty already owns Mailpit on 8025/1025. Outline gets its own Mailpit (`axllent/mailpit:v1.22.3`, same pin as Twenty). Penpot uses its own mailcatcher. This keeps every product startable alone, which the split fallback needs.

## 5 Files

New (names follow the existing `<product>.adapter.ts`, `<product>-env.ts`, `<product>-seed.ts` pattern):

```text
docs/pins/p4.md
docs/adr/0006-p4-products.md
docker/nextcloud.compose.yml        docker/nextcloud.mcp.compose.yml
docker/outline.compose.yml
docker/penpot.compose.yml
docker/mattermost.compose.yml       docker/mattermost.mcp.compose.yml   (only if task 6 gate passes)
scripts/p4-ram-probe.sh             scripts/p4-ram-summary.mjs          scripts/ready.mjs
.github/workflows/p4-adapters.yml
src/adapters/mcp-ready.ts           src/adapters/mcp-ready.test.ts
src/adapters/p4-run-state.ts        src/adapters/p4-run-state.test.ts
src/adapters/p4-ram.ts              src/adapters/p4-ram.test.ts
src/adapters/p4-pins.test.ts
src/adapters/twenty-mcp.ts          src/adapters/twenty-mcp.test.ts
src/adapters/{nextcloud,outline,penpot,mattermost}.adapter.ts
src/adapters/{nextcloud,outline,penpot,mattermost}-env.ts      + .test.ts
src/adapters/{nextcloud,outline,penpot,mattermost}-seed.ts     + .test.ts
```

Edited (additive only): `src/types.ts`, `src/adapters/types.ts`, `src/adapters/registry.ts`, `src/config.ts`, `src/index.ts` (type export of `McpReadiness` and run-state reader), `src/adapters/twenty.adapter.ts` (MCP block, section 6 task 7), `scripts/lib.mjs` (`PRODUCT_IDS`), `.env.example`, `README.md`, `CHANGELOG.md`, `package.json` version when released.

Never edited: any product fork, `docker/twenty.compose.yml` defaults, Cal, Documenso, Medusa adapters.

## 6 Build tasks, with code skeletons

Each task ends with `npm run check`, then a small Conventional Commit (lowercase subject, `git add` by explicit path, no trailers). Do the tasks in this order. Tasks 1 to 2 are shared plumbing, 3 to 6 are one product each, 7 is Twenty, 8 to 10 are RAM probe, CI, docs.

### Task 1: ids, config, interface (no behaviour change)

`src/types.ts`:

```ts
export type ForkProductId = "cal" | "documenso" | "medusa" | "twenty";
export type P4ProductId = "nextcloud" | "outline" | "penpot" | "mattermost";
export type ProductId = ForkProductId | P4ProductId;
export const P4_PRODUCT_IDS: readonly P4ProductId[] = ["nextcloud", "outline", "penpot", "mattermost"];
export function isForkProductId(id: ProductId): id is ForkProductId {
  return !(P4_PRODUCT_IDS as readonly string[]).includes(id);
}
```

`src/adapters/types.ts` (append; the existing members stay as they are):

```ts
export interface McpReadiness {
  url: string;
  toolCount: number;
  toolNames: string[]; // names only, never schemas or tokens
  elapsedMs: number;
}
export interface ProductAdapter {
  // ...existing members...
  /** Waits for the MCP endpoint (initialize + tools/list). Present only on MCP-capable adapters. */
  waitMcp?(timeoutMs?: number): Promise<McpReadiness>;
  /** Absolute path of the run-state file holding the MCP credential. */
  mcpRunStateFile?(): string;
}
```

`src/config.ts`: add to `envSchema` (all optional with defaults, same style as Medusa):

```ts
NEXTCLOUD_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8080"),
NEXTCLOUD_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8765/mcp"),
NEXTCLOUD_DB_URL: z.string().trim().min(1).default("postgres://nextcloud:nextcloud@127.0.0.1:5460/nextcloud"),
OUTLINE_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3010"),
OUTLINE_DB_URL: z.string().trim().min(1).default("postgres://outline:outline@127.0.0.1:5461/outline"),
PENPOT_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:9001"),
PENPOT_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:4401/mcp"),
PENPOT_DB_URL: z.string().trim().min(1).default("postgres://penpot:penpot@127.0.0.1:5462/penpot"),
MATTERMOST_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8065"),
MATTERMOST_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8066/mcp"),
MATTERMOST_DB_URL: z.string().trim().min(1).default("postgres://mattermost:mattermost@127.0.0.1:5463/mattermost"),
TWENTY_MCP: optionalString,
P4_WAIT_MS: optionalString,
```

(Database passwords above are the same throwaway pattern as `medusa:medusa`, not secrets. The app-level secrets are generated per run.)

Add one config interface per P4 product extending `ProductConfig` (`id`, plus `mcpUrl` where relevant). Build function skeleton:

```ts
function p4StateDir(id: P4ProductId): string {
  return path.join(HARNESS_ROOT, ".harness", id); // D1: productRoot for image-only products
}
function buildNextcloudConfig(parsed: ParsedEnv): NextcloudConfig {
  return {
    id: "nextcloud",
    productRoot: p4StateDir("nextcloud"),
    baseUrl: parsed.NEXTCLOUD_BASE_URL.replace(/\/$/, ""),
    mcpUrl: parsed.NEXTCLOUD_MCP_URL.replace(/\/$/, ""),
    dbUrl: parsed.NEXTCLOUD_DB_URL,
  };
}
```

Same for the other three. `loadConfig()` is **not** changed. In `loadProductConfig`, change the first branch to `if (cached && isForkProductId(id)) return cached[id];` and add four `case` arms before `default`. Add four overloads. Existing `switch` arms are untouched, so the `never` check keeps compiling.

`src/adapters/registry.ts`: add four `case` arms returning the new adapters.
`scripts/lib.mjs`: `PRODUCT_IDS = ["cal", "documenso", "medusa", "twenty", "nextcloud", "outline", "penpot", "mattermost"]`.

Tests (extend `src/config.test.ts`):

```ts
it("loadProductConfig resolves a P4 product without any product fork", () => {
  resetConfigCache();
  const cfg = loadProductConfig("nextcloud");
  assert.equal(cfg.baseUrl, "http://127.0.0.1:8080");
  assert.ok(cfg.productRoot.endsWith(path.join(".harness", "nextcloud")));
});
it("loadConfig still returns exactly the four fork products", () => {
  assert.deepEqual(Object.keys(loadConfig()).sort(), ["cal", "documenso", "medusa", "productsRoot", "twenty"]);
});
it("existing defaults are unchanged", () => {
  assert.equal(loadProductConfig("twenty").baseUrl, "http://127.0.0.1:3002");
  assert.equal(loadProductConfig("medusa").baseUrl, "http://127.0.0.1:9000");
});
```

Commit: `feat(config): add p4 product ids and config`.

### Task 2: MCP readiness helper and run state (pure, shared)

`src/adapters/mcp-ready.ts`. It speaks only the standard JSON-RPC handshake: `initialize`, then `notifications/initialized`, then `tools/list`. It handles both JSON and SSE (`data:` lines) replies, and forwards `Mcp-Session-Id` when the server sets one (Nextcloud and Mattermost are stateful; Twenty, Outline and Penpot are not).

```ts
import type { McpReadiness } from "./types.js";

export const MCP_NOT_READY = "MCP_NOT_READY";
export const MCP_PROTOCOL_VERSION = "2025-06-18"; // accepted by all five servers probed

export interface McpProbeOptions {
  url: string;
  /** Request headers such as Authorization. Never logged, never put in an error message. */
  headers?: Record<string, string>;
  timeoutMs: number;
  intervalMs?: number;
  minTools?: number;                 // default 1
  fetchImpl?: typeof fetch;          // injected in tests
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Parses a JSON-RPC reply that is plain JSON or an SSE body ("event: message\ndata: {...}"). */
export function parseJsonRpcBody(text: string, contentType: string | null): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed.split("\n").find((l) => l.startsWith("data:"));
  if (!data) throw new Error("reply has neither JSON nor an SSE data line");
  return JSON.parse(data.slice(5).trim());
}

/** Returns tool names, or throws a message that names the problem and never a value. */
export function assertToolsList(reply: unknown, minTools: number): string[] {
  const r = reply as { error?: { code?: number; message?: string }; result?: { tools?: { name?: unknown }[] } };
  if (r?.error) throw new Error(`tools/list returned a JSON-RPC error (code ${String(r.error.code)})`);
  const tools = r?.result?.tools;
  if (!Array.isArray(tools)) throw new Error("tools/list reply has no result.tools array");
  const names = tools.map((t) => t.name).filter((n): n is string => typeof n === "string" && n !== "");
  if (names.length < minTools) throw new Error(`tools/list returned ${names.length} tools, need at least ${minTools}`);
  return names;
}

export async function waitForMcp(product: string, opts: McpProbeOptions): Promise<McpReadiness> {
  // loop until deadline: POST initialize -> (capture mcp-session-id) -> POST notifications/initialized -> POST tools/list
  // on any failure remember the last short reason (HTTP status or error class), sleep intervalMs (default 2000), retry
  // at the deadline throw: `${MCP_NOT_READY}: ${product} MCP at ${opts.url} not ready after ${opts.timeoutMs} ms (last: ${reason})`
  // return { url, toolCount, toolNames, elapsedMs }
}
```

Tests (`mcp-ready.test.ts`, fake `fetch`, no network, no sleeping):

```ts
it("parses plain JSON and SSE replies to the same value", () => {
  const body = { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a" }] } };
  assert.deepEqual(parseJsonRpcBody(JSON.stringify(body), "application/json"), body);
  assert.deepEqual(parseJsonRpcBody(`event: message\ndata: ${JSON.stringify(body)}\n\n`, "text/event-stream"), body);
});
it("assertToolsList rejects an empty list, an error reply and a missing array", () => { /* three assert.throws */ });
it("waitForMcp retries until tools/list succeeds and forwards the session id", async () => { /* 401, then 200 with mcp-session-id; assert the 3rd call carried the header */ });
it("a timeout error names product, url and last reason, and never the bearer", async () => {
  const secret = "tok_SHOULD_NOT_APPEAR";
  await assert.rejects(() => waitForMcp("outline", { url: "http://x/mcp", headers: { authorization: `Bearer ${secret}` }, timeoutMs: 1, fetchImpl: async () => new Response("no", { status: 401 }), sleep: async () => {}, now: fakeClock() }),
    (e: Error) => e.message.includes("MCP_NOT_READY") && e.message.includes("401") && !e.message.includes(secret));
});
```

`src/adapters/p4-run-state.ts` (generalises the Documenso reader; the Documenso file is not touched):

```ts
export interface P4RunState {
  version: 1;
  product: P4ProductId | "twenty";
  mcpUrl: string;
  mcpToken: string;                       // PAT, API key, app password or user token, per product
  owner: { username: string; email: string; password: string };
}
export function p4RunStateFile(product: string, harnessRoot = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", `${product}-run.json`);
}
export function writeP4RunState(file: string, state: P4RunState): void { /* mkdir, write 0600, chmod 0600 — same as documenso */ }
export function removeP4RunState(file: string): void { fs.rmSync(file, { force: true }); }
export function readP4McpCredentials(product: string, file = p4RunStateFile(product)): { mcpUrl: string; mcpToken: string } {
  // ENOENT -> "P4_RUN_STATE_MISSING: <file> does not exist. Run up first."
  // not JSON / wrong shape / empty token -> "P4_RUN_STATE_INVALID: <file> ... (content not printed)"
}
```

Tests (`p4-run-state.test.ts`, temp dir): file mode is `0o600` after write and after an overwrite; remove is idempotent; reader returns only `mcpUrl` and `mcpToken`; MISSING and INVALID errors never contain the token or password; a state file with an empty token is INVALID.

Commit: `feat(adapters): add mcp readiness and p4 run state helpers`.

### Task 3: Nextcloud adapter

**Compose.** `docker/nextcloud.compose.yml`, `name: qa-harness-nextcloud`:

```yaml
name: qa-harness-nextcloud
services:
  db:
    image: postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e
    environment: { POSTGRES_USER: nextcloud, POSTGRES_PASSWORD: nextcloud, POSTGRES_DB: nextcloud }
    ports: ["127.0.0.1:5460:5432"]
    volumes: [nextcloud_harness_pg:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U nextcloud -d nextcloud"], interval: 5s, timeout: 5s, retries: 20 }
  app:
    image: nextcloud:35.0.3-apache@sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3
    depends_on: { db: { condition: service_healthy } }
    ports: ["127.0.0.1:8080:80"]
    volumes: [nextcloud_harness_data:/var/www/html]
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: nextcloud
      NEXTCLOUD_ADMIN_USER: qa-owner
      NEXTCLOUD_ADMIN_PASSWORD: ${NEXTCLOUD_OWNER_PASSWORD:?set by the adapter}
      NEXTCLOUD_TRUSTED_DOMAINS: "127.0.0.1 localhost app"
    healthcheck: { test: ["CMD-SHELL", "curl -fsS http://localhost/status.php | grep -q '\"installed\":true'"], interval: 10s, timeout: 5s, retries: 60, start_period: 120s }
volumes: { nextcloud_harness_pg: {}, nextcloud_harness_data: {} }
```

`docker/nextcloud.mcp.compose.yml` (added by `up()` **after** the app password exists, as a second `-f` file in the same project):

```yaml
services:
  mcp:
    image: ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325
    depends_on: { app: { condition: service_healthy } }
    ports: ["127.0.0.1:8765:8000"]
    environment:
      NEXTCLOUD_HOST: http://app
      NEXTCLOUD_USERNAME: qa-owner
      NEXTCLOUD_PASSWORD: ${NEXTCLOUD_MCP_APP_PASSWORD:?set by the adapter}
```

(Env names `NEXTCLOUD_HOST`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD` are VERIFIED from the upstream README and the container started with them. Overriding the image's `CMD` is not needed: its entrypoint is `nextcloud-mcp-server run --host 0.0.0.0`, VERIFIED.)

**`src/adapters/nextcloud-env.ts`** (pure):

```ts
export const NEXTCLOUD_IMAGE = "nextcloud:35.0.3-apache@sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3";
export const NEXTCLOUD_MCP_IMAGE = "ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325";
export const NEXTCLOUD_OWNER = { username: "qa-owner", email: "qa-owner@p4.test" } as const;

export function nextcloudComposeFiles(withMcp: boolean): string[] { /* harnessComposeFile("nextcloud.compose.yml") + (withMcp ? mcp file : []) */ }
/** status.php body -> ready only when installed, not in maintenance, no DB upgrade pending. */
export function parseNextcloudStatus(body: unknown): { ready: boolean; reason?: string } { /* ... */ }
export function nextcloudComposeEnv(base: NodeJS.ProcessEnv, secrets: { ownerPassword: string; mcpAppPassword?: string }): NodeJS.ProcessEnv { /* spreads base, adds the two names */ }
export function generateOwnerPassword(randomBytes: (n: number) => Buffer = crypto.randomBytes): string { return randomBytes(24).toString("base64url"); }
```

**`src/adapters/nextcloud-seed.ts`** (pure builders and parsers, no I/O):

```ts
/** OCS request that mints an app password for the owner. Basic auth uses the owner password. */
export function appPasswordRequest(baseUrl: string, owner: string, ownerPassword: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/ocs/v2.php/core/getapppassword?format=json`,
    init: { method: "GET", headers: { "OCS-APIRequest": "true", Authorization: `Basic ${Buffer.from(`${owner}:${ownerPassword}`).toString("base64")}` } },
  };
}
export function parseAppPassword(body: unknown): string { /* body.ocs.data.apppassword, non-empty string, else throw "NEXTCLOUD_APP_PASSWORD_MISSING" (no body in message) */ }
/** occ commands run through `docker compose exec -u www-data app php occ ...` */
export function nextcloudAppInstallArgs(app: "calendar" | "contacts" | "mail"): string[] { return ["php", "occ", "app:install", app]; }
```

**Adapter** `src/adapters/nextcloud.adapter.ts` (skeleton; every other P4 adapter has this exact shape):

```ts
const COMPOSE_PROJECT = "qa-harness-nextcloud";

export class NextcloudAdapter extends BaseAdapter<NextcloudConfig> {
  readonly id = "nextcloud" as const;
  private ownerPassword = "";
  private mcpAppPassword = "";

  mcpRunStateFile(): string { return p4RunStateFile("nextcloud"); }

  async up(): Promise<void> {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    this.ownerPassword = this.readOrCreateOwnerPassword();      // see seed(): kept in run state across restarts
    await composeUp(this.opts(false), { wait: true });           // db + app, health = status.php installed
    await this.assertRunningImages();                            // docker inspect vs NEXTCLOUD_IMAGE
    await this.waitHealthy();
    await this.seed();                                           // owner already exists via NEXTCLOUD_ADMIN_*; installs apps, mints app password
    await composeUp(this.opts(true), { wait: true });            // adds the mcp service
    await this.waitMcp();
    console.log(`Nextcloud is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}). Owner credentials are in ${this.mcpRunStateFile()}.`);
  }
  async down(): Promise<void> {
    removeP4RunState(this.mcpRunStateFile());
    await composeDown(this.opts(true), ["--remove-orphans"]);    // keeps volumes unless NEXTCLOUD_DOWN_VOLUMES=1, like TWENTY_DOWN_VOLUMES
  }
  async health(): Promise<HealthStatus> { return pollHealth(`${this.cfg.baseUrl}/status.php`, { timeoutMs: 0, isOk: (s) => s === 200 }); }
  async waitHealthy(t?: number): Promise<void> { /* poll status.php; body must satisfy parseNextcloudStatus(...).ready */ }
  async waitMcp(t?: number): Promise<McpReadiness> { /* waitForMcp("nextcloud", { url: mcpUrl, timeoutMs: t ?? p4WaitMs(env), minTools: 1 }) AND one authenticated GET /ocs/v2.php/cloud/user must return the owner id */ }
  async seed(): Promise<SeedResult> { /* occ app:install calendar/contacts/mail (skip when `occ app:list` already shows them); appPasswordRequest -> parseAppPassword; writeP4RunState(...) */ }
  async authenticate(): Promise<AuthSession> { /* Basic header from run state; raw: { source: "run-state" } */ }
  async proveAuth(s: AuthSession): Promise<void> { /* GET /ocs/v2.php/cloud/user, assert id === "qa-owner" */ }
}
```

**Tests** (`nextcloud-env.test.ts`, `nextcloud-seed.test.ts`): `parseNextcloudStatus` ready/maintenance/upgrade/garbage; `nextcloudComposeFiles(false|true)` lengths; compose env never mutates `process.env` and contains both secret names only when supplied; `generateOwnerPassword` with a fixed `randomBytes` is deterministic and url-safe; `appPasswordRequest` sets `OCS-APIRequest` and a Basic header that decodes to `owner:password`; `parseAppPassword` rejects empty, missing and non-string, and the thrown message contains no input value.

**Open items for this task (UNVERIFIED, settle first):** (a) Calendar, Contacts and Mail are compatible with Nextcloud 35 and installable from the app store in CI; (b) `getapppassword` works on a fresh install with the admin password; (c) the multi-user pass-through env switch (D9). If (a) fails for an app, install the apps that work and record the gap in the pin table.

Commit: `feat(nextcloud): add adapter with mcp readiness`.

### Task 4: Outline adapter

**Compose** `docker/outline.compose.yml` (`name: qa-harness-outline`): services `db` (`postgres:16-alpine@sha256:81e77a48…`, port `127.0.0.1:5461`), `redis` (`redis:8.10.3@sha256:1f88291b…`, the ADR 0005 pin, no host port), `mail` (`axllent/mailpit:v1.22.3@sha256:f7f7c31de4de59540ad6515a0ca057a77525bca2069b6e747d873ca66c10fe08`, UI/API `127.0.0.1:8027`), `outline` (`outlinewiki/outline:1.13.0@sha256:4583bb24…823e4`, `127.0.0.1:3010:3000`).

`outline` environment (names VERIFIED present in `build/server/env.js`; values generated by the adapter): `SECRET_KEY` (32 random bytes, hex), `UTILS_SECRET` (32 random bytes, hex), `DATABASE_URL=postgres://outline:outline@db:5432/outline`, `PGSSLMODE=disable`, `REDIS_URL=redis://redis:6379`, `URL=http://127.0.0.1:3010`, `PORT=3000`, `FORCE_HTTPS=false`, `FILE_STORAGE=local`, `FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data` (volume), `SMTP_HOST=mail`, `SMTP_PORT=1025`, `SMTP_FROM_EMAIL=outline@p4.test`, `SMTP_SECURE=false`. Outline refuses to start with no sign-in method; email magic link through Mailpit is the standard no-external-IdP option.

The container needs migrations before first start: run `docker compose run --rm --no-deps outline yarn db:migrate --env=production-ssl-disabled` (the documented command; the exact `--env` value is **UNVERIFIED**, take it from the image's `.sequelizerc` in the spike). `scripts` in the image `package.json` show `db:migrate: sequelize db:migrate` (VERIFIED).

**Health:** `GET /_health` → `200`. **UNVERIFIED** path (not found in the files I grepped); fallback `GET /api/auth.config` → `200` (documented unauthenticated endpoint, also UNVERIFIED).

**MCP readiness:** `POST {baseUrl}/mcp` with `Authorization: Bearer <api key>`; `minTools: 1`; also assert the names include `list_documents` (a stable name, VERIFIED in the build).

**Seed, the highest-risk step (UNVERIFIED).** Two plans, in order:
- **Plan B (preferred, public interfaces only):** request a magic link for `qa-owner@p4.test` (`POST /api/email.signin`), read the link from Mailpit (`GET http://127.0.0.1:8027/api/v1/messages`), follow it to get a session, create a team if none exists, then `POST /api/apiKeys.create` with a name and 1-day expiry. Needs the first-run "create workspace" path to work for email auth. If it does not, use Plan A.
- **Plan A (fallback):** a one-off `node -e` inside the container that uses Outline's own models (`Team`, `User`, `ApiKey`) to insert the owner and key. Non-standard because it depends on internals, so flag it in the ADR if used. Do **not** write SQL by hand: API keys are stored hashed (`20240930113921-hash-api-keys.js` exists in the image), so a hand-built row would not authenticate.
- Time-box 2 hours. If neither works, stop and report with evidence; do not change the design.

`outline-env.ts`: `OUTLINE_IMAGE`, `outlineSecrets(randomBytes)`, `outlineComposeEnv(base, secrets)`, `parseOutlineAuthConfig(body)`. `outline-seed.ts`: `emailSigninRequest`, `extractMagicLink(mailpitMessageJson)` (finds the first `href` that starts with the `URL` origin and contains `/auth/email.callback`), `apiKeyCreateRequest`, `parseApiKey(body)` (must start with the `ol_api_` prefix: **UNVERIFIED**, read the prefix from the build in the spike before coding the check).

Tests: `extractMagicLink` on a canned Mailpit payload (found, absent, a link to a foreign origin is rejected); `parseApiKey` accepts a well-formed key and its error never echoes the input; `outlineSecrets` are 64 hex chars and differ per call; compose env contains `SECRET_KEY` and `UTILS_SECRET` and nothing else secret.

Commit: `feat(outline): add adapter with mcp readiness`.

### Task 5: Penpot adapter

**Compose** `docker/penpot.compose.yml` (`name: qa-harness-penpot`), a harness-owned reduction of Penpot's documented self-host compose: `frontend` (`penpotapp/frontend:2.19.2@sha256:27af83e1…`, `127.0.0.1:9001:8080`), `backend` (`penpotapp/backend:2.19.2@sha256:b6c60250…`), `exporter` (`penpotapp/exporter:2.19.2@sha256:60fdaddd…`), `postgres` (`postgres:16-alpine`, `127.0.0.1:5462`), `valkey` (`valkey/valkey:8-alpine@sha256:2602ace2…`), `mailcatcher` (`penpotapp/mailcatcher:latest` **cannot be pinned by digest from here: UNVERIFIED**, so use `axllent/mailpit:v1.22.3` instead, a pinned image already used in this repo), `mcp` (`penpotapp/mcp:2.19.2@sha256:94c66720…`, `127.0.0.1:4401:4401` and `127.0.0.1:4402:4402`).

Environment keys (from Penpot's published self-host guide; all **UNVERIFIED** against 2.19.2 until the spike): `PENPOT_FLAGS` (`enable-login-with-password disable-registration enable-smtp disable-email-verification`), `PENPOT_SECRET_KEY` (generated), `PENPOT_PUBLIC_URI=http://127.0.0.1:9001`, `PENPOT_DATABASE_URI`, `PENPOT_DATABASE_USERNAME`, `PENPOT_DATABASE_PASSWORD`, `PENPOT_REDIS_URI`, `PENPOT_SMTP_*`. Penpot's backend is a JVM service and is the largest single memory consumer: cap it (`JAVA_OPTS=-Xmx1g`; flag and the exact variable are UNVERIFIED) and let the RAM probe prove the cap.

**Health:** frontend `GET /` → `200`; backend through the frontend `GET /api/rpc/command/get-profile` → `200` JSON (anonymous profile). Both **UNVERIFIED** paths; confirm in the spike.

**Seed:** documented profile command `docker compose exec -T backend ./manage.sh create-profile -e qa-owner@p4.test -n "QA Owner" -p <generated>` (the command name is from memory of Penpot's admin docs: **UNVERIFIED**, confirm with `./manage.sh --help` in the pinned image). Then mint a **personal access token** for the MCP: log in (`POST /api/rpc/command/login-with-password`, keep the auth cookie in memory) and `POST /api/rpc/command/create-access-token` with a name and expiry. Write that token as `mcpToken`. The MCP client passes it as `?userToken=<token>` (VERIFIED parameter name).

**MCP readiness:** `POST http://127.0.0.1:4401/mcp?userToken=<token>`, `minTools: 4`, and assert the names include `execute_code`. Document in the adapter header and the README that a tool call needs a browser session with the plugin; readiness does not and cannot prove that.

`penpot-env.ts`: image constants, `penpotSecretKey(randomBytes)`, `penpotComposeEnv`, `buildMcpUrl(base, token)` (URL-encodes the token). `penpot-seed.ts`: `createProfileArgs(email, name, password)`, `loginRequest`, `createAccessTokenRequest`, `parseAccessToken`.

Tests: `buildMcpUrl` encodes a token containing `&`, `#` and `=` so it cannot add or truncate a parameter; `createProfileArgs` returns an argv array (never a shell string); `parseAccessToken` rejects empty and missing and never echoes input; secret key is 64 hex chars.

Commit: `feat(penpot): add adapter with mcp readiness`.

### Task 6: Mattermost adapter (decision gate first)

**Gate (do before any code, 1 hour max).** Decide how the MCP is provided. The reviewer should answer open question Q2 first.
- **Option 1 (recommended): standalone `mattermost-mcp-server`, built from a pinned commit of `mattermost-plugin-agents` (Apache-2.0).** `docker/mattermost.mcp.compose.yml` builds it in a pinned `golang` image stage and runs it as a pinned slim image, `--transport http --http-port 8066`, `MM_SERVER_URL` and `MM_INTERNAL_SERVER_URL` pointing at `http://app:8065`, token from `MM_ACCESS_TOKEN`. Non-standard: Mattermost documents it as development-only. Mitigation: loopback bind and a throwaway stack. The build adds a harness-owned `Dockerfile`, which is the only place this plan creates one. The Go module download needs network in CI; the sandbox here could not confirm it (UNVERIFIED).
- **Option 2: embedded Agents-plugin endpoint.** Needs an Enterprise licence. Not allowed here.
- **Option 3: drop Mattermost MCP and keep Mattermost REST only.** Fails the acceptance criterion "each new product reports MCP ready", so the reviewer must waive it explicitly.

**Compose** `docker/mattermost.compose.yml` (`name: qa-harness-mattermost`): `db` (`postgres:16-alpine`, `127.0.0.1:5463`), `app` (`mattermost/mattermost-team-edition:12.1.0@sha256:35927b9c…`, `127.0.0.1:8065:8065`). Environment (standard Mattermost env-override names): `MM_SQLSETTINGS_DRIVERNAME=postgres`, `MM_SQLSETTINGS_DATASOURCE=postgres://mattermost:mattermost@db:5432/mattermost?sslmode=disable&connect_timeout=10`, `MM_SERVICESETTINGS_SITEURL=http://127.0.0.1:8065`, `MM_SERVICESETTINGS_ENABLELOCALMODE=true`, `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true`, `MM_TEAMSETTINGS_ENABLEOPENSERVER=false`.

**Health:** `GET /api/v4/system/ping` → `200` with `{"status":"OK"}`.

**Seed** (all through `mmctl --local`, the standard bootstrap route, run with `docker compose exec -T app mmctl --local ...`): `user create --email qa-owner@p4.test --username qa-owner --password <generated> --system-admin`, `team create --name qa --display-name QA --email qa-owner@p4.test`, `team users add qa qa-owner`, `token generate qa-owner p4-mcp` (prints the PAT; capture, never log). A **PAT scoped to a non-admin user** is the least-privilege choice: create a second user `qa-agent` (member only) and generate the PAT for that user instead. Run state holds that PAT.

**MCP readiness:** `waitForMcp("mattermost", ...)` against `http://127.0.0.1:8066/mcp`, `minTools: 1` (documented base set is 12). Stateful server, so the session header path in `mcp-ready.ts` must be exercised in tests. How a headless client authenticates in HTTP mode is **UNVERIFIED** (the docs say OAuth); if it requires OAuth, the spike either configures the `--token` startup path so the server calls Mattermost with the PAT and the HTTP side stays loopback-only, or the reviewer picks Option 3.

`mattermost-env.ts`, `mattermost-seed.ts`: `mmctlUserCreateArgs`, `parseMmctlToken(stdout)` (a PAT is a 26-character lowercase alphanumeric string: **UNVERIFIED**, take the exact shape from a spike run before asserting a regex), `parsePing(body)`.

Tests: `parseMmctlToken` picks the token out of noisy stdout and rejects empty output without echoing it; argv builders return arrays; ping parser accepts `OK` only.

Commit: `feat(mattermost): add adapter with mcp readiness`.

### Task 7: Twenty MCP (extend, never change defaults)

Rules: opt-in `TWENTY_MCP=1`, exact value `1` only; anything else is off. With it unset, `up()`, `down()` and every default behave exactly as today. Nothing under the fork changes. `docker/twenty.compose.yml` is not edited (MCP needs no compose key; section 3.2).

`src/adapters/twenty-mcp.ts` (pure):

```ts
export const TWENTY_MCP_ENV = "TWENTY_MCP";
export function twentyMcpEnabled(env: NodeJS.ProcessEnv): boolean { return env[TWENTY_MCP_ENV] === "1"; }
export function twentyMcpUrl(baseUrl: string): string { return `${baseUrl}/mcp`; }

export interface ApiKeyRole { id: string; label: string; canUpdateAllSettings?: boolean; canUpdateAllObjectRecords?: boolean }
/** Least-privilege pick: prefer a role that cannot update settings; throw (naming the labels, not ids) when none exists. */
export function selectApiKeyRole(roles: ApiKeyRole[]): ApiKeyRole { /* ... */ }

export const GET_API_KEY_ROLES = `query { getApiKeyRoles { id label canUpdateAllSettings canUpdateAllObjectRecords } }`;
export const CREATE_API_KEY = `mutation($i: CreateApiKeyInput!) { createApiKey(input: $i) { id } }`;
export const GENERATE_API_KEY_TOKEN = `mutation($id: UUID!, $e: String!) { generateApiKeyToken(apiKeyId: $id, expiresAt: $e) { token } }`;
export function apiKeyExpiry(now: Date, hours = 4): string { return new Date(now.getTime() + hours * 3_600_000).toISOString(); }
export function extractApiKeyToken(body: { data?: { generateApiKeyToken?: { token?: string } }; errors?: unknown[] }): string { /* throw TWENTY_MCP_TOKEN_MISSING without echoing the body */ }
```

(The three GraphQL documents above are exactly the ones that worked in the 2026-11-17 live probe; the `getApiKeyRoles` selection set matches what the probe requested.)

Adapter change, a single additive block (`twenty.adapter.ts`):

```ts
// in up(), after assertRunningServerImage():
if (twentyMcpEnabled(process.env)) {
  await this.seed();                  // dev seed already exists as a method; idempotent
  await this.prepareMcp();            // loginToken exchange -> createApiKey -> generateApiKeyToken -> writeP4RunState
  await this.waitMcp();
}
// in down(), first line:
removeP4RunState(p4RunStateFile("twenty"));
// new methods:
mcpRunStateFile(): string { return p4RunStateFile("twenty"); }
async waitMcp(timeoutMs?: number): Promise<McpReadiness> { /* waitForMcp("twenty", { url: twentyMcpUrl(baseUrl), headers: { authorization: `Bearer ${token from run state}` }, minTools: 1 }) */ }
```

`prepareMcp` reuses the existing `metadataGraphql`, `SIGN_IN_MUTATION` and `EXCHANGE_LOGIN_TOKEN_MUTATION`. It must **not** call `authenticate()`, because that returns the workspace-agnostic token that `/mcp` and `createApiKey` reject (section 3.2). Run-state `owner` is the existing dev-seed Jane account (public fixture, same as the README).

Tests (`twenty-mcp.test.ts`): `twentyMcpEnabled` is true for `"1"` only (`undefined`, `""`, `"true"`, `"0"`, `" 1"` are false); `selectApiKeyRole` prefers a non-settings role, falls back to none → throws with labels only; `apiKeyExpiry` is deterministic for a fixed clock; `extractApiKeyToken` throws on missing and on GraphQL `errors`, and the message never contains the body; the three documents are non-empty strings that begin with `query` or `mutation`. In `twenty-passthrough`-style guard test: **with `TWENTY_MCP` unset the compose option list, env and file list are identical to today** (snapshot the output of `composeOpts()` pure parts before and after).

Commit: `feat(twenty): mint a scoped mcp credential and wait for the mcp endpoint`.

### Task 8: RAM probe

Budget: **14 GiB (14336 MiB) of the 16 GB runner.** Reasoning: the runner exposes about 15.6 GiB (this session shows `15.71GiB` for a 16 GB class VM). The OS, runner agent and Docker daemon need about 1 GiB, and `docker stats` MemUsage excludes page cache, so about 1 GiB of headroom avoids the OOM killer during image pulls and the readiness burst. 16 − 2 = 14. The number is a committed constant (`RAM_BUDGET_MIB` default in the script) and is overridable only by an explicit env var.

`src/adapters/p4-ram.ts` (pure, unit tested; the shell script stays thin):

```ts
export const RAM_BUDGET_MIB = 14336;
/** "884.3MiB / 15.71GiB" -> 884.3 ; "1.2GiB / 15.71GiB" -> 1228.8 ; kB, MB, GB, KiB handled ; garbage -> NaN */
export function parseMemUsageMiB(raw: string): number { /* take text before "/", unit table */ }
export interface RamSample { t: number; container: string; mib: number }
export interface RamReport {
  schema: 1; budgetMiB: number; products: string[];
  containers: { name: string; peakMiB: number }[];
  totalPeakMiB: number;   // peak of the per-instant SUM, not the sum of per-container peaks
  sumOfPeaksMiB: number;  // reported too, always >= totalPeakMiB
  hostUsedPeakMiB: number | null; diskFreeGiB: number | null;
  readyMs: number | null; fit: boolean;
}
export function summarize(samples: RamSample[], meta: { products: string[]; budgetMiB: number; hostUsedPeakMiB?: number; diskFreeGiB?: number; readyMs?: number }): RamReport { /* group by t, sum, take max; fit = totalPeakMiB <= budgetMiB */ }
```

`scripts/p4-ram-probe.sh <product>...` (skeleton):

```bash
#!/usr/bin/env bash
# Starts the given products through the harness, samples `docker stats` until all are ready plus 30 s steady
# state, writes evidence/ram-probe.json, and always runs `down`. Usage: scripts/p4-ram-probe.sh nextcloud outline ...
set -euo pipefail
products=("$@"); [ "${#products[@]}" -gt 0 ] || { echo "usage: $0 <product>..." >&2; exit 2; }
mkdir -p evidence; : > evidence/ram-samples.tsv
cleanup() { kill "${sampler:-0}" 2>/dev/null || true; for p in "${products[@]}"; do npm run down -- "$p" || true; done; }
trap cleanup EXIT
( while true; do t=$(date +%s); docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' | sed "s/^/$t\t/" >> evidence/ram-samples.tsv; free -m | awk '/^Mem:/{print "host\t"$3}' >> evidence/ram-host.tsv; sleep 2; done ) & sampler=$!
start=$(date +%s)
for p in "${products[@]}"; do TWENTY_MCP=1 npm run up -- "$p"; done
node scripts/ready.mjs "${products[@]}"                 # waitHealthy + waitMcp, exit 1 with a clear message on timeout
ready_ms=$(( ($(date +%s) - start) * 1000 ))
sleep 30                                                # steady state
kill "$sampler"; sampler=0
df -BG --output=avail / | tail -1 | tr -dc 0-9 > evidence/.disk
node scripts/p4-ram-summary.mjs "${products[@]}" --ready-ms "$ready_ms" > evidence/ram-probe.json
cat evidence/ram-probe.json
jq -e '.fit == true' evidence/ram-probe.json >/dev/null    # non-zero exit when it does not fit
```

`scripts/ready.mjs` loads the harness like `up.mjs`, then for each product id calls `adapter.waitHealthy()` and, if present, `adapter.waitMcp()`, printing one line per product: `ready <product> health=ok mcp=ok tools=<n> in <ms> ms`. `scripts/p4-ram-summary.mjs` reads the TSVs, calls the compiled `summarize`, prints JSON.

Tests (`p4-ram.test.ts`): unit parsing for `MiB`, `GiB`, `kB`, `MB`, `GB` and garbage; `summarize` sums per instant (two containers peaking at different times give `totalPeakMiB < sumOfPeaksMiB`); `fit` is true at exactly the budget and false one MiB over; an empty sample list yields `fit: false` and a clear `containers: []`, never a fake pass.

Commit: `feat(scripts): add p4 ram probe and readiness cli`.

### Task 9: CI job

`.github/workflows/p4-adapters.yml` (all actions pinned by full SHA; `permissions: contents: read`; no secrets; no LLM keys):

```yaml
name: P4 adapters
on:
  workflow_dispatch:
  pull_request:
    paths:
      - "src/adapters/{nextcloud,outline,penpot,mattermost,twenty,mcp-ready,p4-}*"   # expand to explicit globs in the build
      - "docker/{nextcloud,outline,penpot,mattermost,twenty}*.yml"
      - "scripts/p4-*"
      - "scripts/ready.mjs"
      - "docs/pins/p4.md"
      - ".github/workflows/p4-adapters.yml"
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
defaults:
  run:
    shell: bash
jobs:
  p4-stack:
    name: five products, readiness and RAM
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      PRODUCTS_ROOT: ${{ github.workspace }}/../products
      TWENTY_MCP: "1"
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Setup Node
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Free disk space
        run: |
          set -euo pipefail
          sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc
          df -h /
      - name: Install harness and clone the Twenty fork at its pin
        run: |
          set -euo pipefail
          HARNESS_PRODUCTS=twenty bash scripts/cloud-install.sh
          npm run build
      - name: Pull pinned images
        run: |
          set -euo pipefail
          for f in nextcloud outline penpot mattermost; do docker compose -f "docker/$f.compose.yml" pull --quiet; done
      - name: Start, wait for readiness, measure memory
        run: bash scripts/p4-ram-probe.sh nextcloud outline penpot mattermost twenty
      - name: Upload RAM evidence
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: ram-probe
          path: evidence/ram-probe.json
          if-no-files-found: warn
          retention-days: 30
      - name: Leftover containers (must be none)
        if: always()
        run: |
          set -euo pipefail
          docker ps -a --filter name=qa-harness --format '{{.Names}}' | tee left.txt
          test ! -s left.txt
```

Notes: `upload-artifact` `v7.0.2` resolves to commit `cf430e03…` (`git ls-remote`, lightweight tag, VERIFIED) and `checkout v7.0.1` resolves to `3d3c42e5…`, matching `ci.yml`. The job uploads `evidence/ram-probe.json` only; `.harness/` (run state with tokens) is never uploaded. `actionlint` in `ci.yml` lints the new file. `p4-adapters` should not be a required check (it is slow and pulls from public registries); the owner decides (question Q5).

Commit: `ci: add p4 adapters stack job`.

### Task 10: docs

- `docs/pins/p4.md`: the table in section 7, copied verbatim.
- `docs/adr/0006-p4-products.md`: section 12.
- `README.md`: a "P4 products" section (ports, `up`/`down`, run-state files, env names, `TWENTY_MCP=1`, the Penpot browser caveat, the Mattermost licence note). `.env.example`: the new names with empty or default values and no secrets. `CHANGELOG.md`: `## Unreleased`. The owner tags after merge.

Commit: `docs: document p4 products, pins and adr`.

## 7 Pins: `docs/pins/p4.md`

Digests are the multi-arch index digests read from Docker Hub and ghcr.io on 2026-11-17. A unit test (`p4-pins.test.ts`) parses this file and every `docker/*.compose.yml`, and fails when an image reference in compose differs from the table, or when an image has no digest.

| Product / role | Upstream · licence | Pin (`image:tag@digest`) | MCP server · transport · auth |
|---|---|---|---|
| Nextcloud app | nextcloud/server · AGPL-3.0 (UNVERIFIED) | `nextcloud:35.0.3-apache@sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3` | see next row |
| Nextcloud MCP | cbcoutinho/nextcloud-mcp-server · AGPL-3.0-only | `ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325` | same · streamable HTTP, stateful · app password (single-user) |
| Outline | outline/outline · BSL 1.1 | `outlinewiki/outline:1.13.0@sha256:4583bb244dbb4464d8a632c75044d3b2f9fe44382b6a4b84d97995f473b823e4` | built-in `/mcp` · streamable HTTP · API key bearer |
| Penpot frontend | penpot/penpot · MPL-2.0 | `penpotapp/frontend:2.19.2@sha256:27af83e128712c6e621afcbc4dbae5a607204f7acc89a9ae1245b5601b4a66a8` | n/a |
| Penpot backend | same | `penpotapp/backend:2.19.2@sha256:b6c602504ca48ec99a25f6a5463c9aa4f4728ac9ed69e7d5d183fb4f779f5e4e` | n/a |
| Penpot exporter | same | `penpotapp/exporter:2.19.2@sha256:60fdaddd4de2492e5fc5d21419a268374af83b5501c09b167cd2513d2c3e29d7` | n/a |
| Penpot MCP | penpot/penpot `mcp/` · MIT | `penpotapp/mcp:2.19.2@sha256:94c6672072a1fbbdb5ff577375e96d3f67b3a67ecdcd8f81498c5ec27eba36f3` | streamable HTTP `/mcp` · user token (`?userToken=`) |
| Mattermost app | mattermost/mattermost · MIT compiled, AGPL source | `mattermost/mattermost-team-edition:12.1.0@sha256:35927b9c535a9eb74f0e45385d3fe5d8308b16e0464031f157a834da8af3ee73` | see next row |
| Mattermost MCP | mattermost/mattermost-plugin-agents `mcpserver` · Apache-2.0 | **commit to pin: UNVERIFIED** (GitHub API was blocked; record the SHA in task 6) | HTTP `/mcp` or stdio · PAT |
| Twenty (existing) | twentyhq/twenty | `twentycrm/twenty:v2.44.0@sha256:01fb6d2c00397976fd7613dbeb9703b514b52fb6270339b7a326a2a975d15b26` | built-in `/mcp` · streamable HTTP · API key bearer |
| Postgres | postgres | `postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e` | n/a |
| Redis (Outline) | redis | `redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53` (ADR 0005) | n/a |
| Valkey (Penpot) | valkey-io/valkey | `valkey/valkey:8-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a` | n/a |
| Mailpit (Outline, Penpot) | axllent/mailpit | `axllent/mailpit:v1.22.3@sha256:f7f7c31de4de59540ad6515a0ca057a77525bca2069b6e747d873ca66c10fe08` | n/a |

Existing Twenty compose pins the image by tag only; adding the digest there would be a default change and needs its own ADR, so this plan records the digest in the pin table and checks it at runtime instead (`docker inspect`), without editing `docker/twenty.compose.yml`.

## 8 Readiness (every product waits for both)

Order inside `up()`: compose `--wait` → app health → seed → MCP. `waitHealthy()` is the app health; `waitMcp()` is `initialize` + `notifications/initialized` + `tools/list` (real calls, via `waitForMcp`) with the scoped credential. Budget: `P4_WAIT_MS` (default 600000, floor 120000, same rule as `TWENTY_WAIT_MS`). On timeout the error is one line: `MCP_NOT_READY: <product> MCP at <url> not ready after <ms> ms (last: HTTP 401)`. App health failure uses the existing `Timed out waiting for <url> to become healthy (last HTTP n)`. Neither ever contains a header or token.

| Product | App health (must be 200) | MCP check | minTools |
|---|---|---|---|
| nextcloud | `GET /status.php` body installed and not in maintenance | `/mcp` on 8765, **plus** an authenticated `GET /ocs/v2.php/cloud/user` returning the owner (because `tools/list` alone passes with Nextcloud down) | 1 |
| outline | `GET /_health` (UNVERIFIED path) | `POST /mcp`, bearer API key | 1 |
| penpot | `GET /` and `GET /api/rpc/command/get-profile` (UNVERIFIED) | `POST :4401/mcp?userToken=…` | 4 |
| mattermost | `GET /api/v4/system/ping` | `POST :8066/mcp`, session header | 1 |
| twenty | `GET /healthz` (existing, unchanged) | `POST /mcp`, bearer API key from the exchange token | 1 |

## 9 Seed and run state

One fake owner per product (D8), one scoped MCP credential per product, written by `up()` to `.harness/<product>-run.json` (`0600`, gitignored) through `writeP4RunState`, removed by `down()`. A test reads it only through `readP4McpCredentials(product)`; the reader returns `{ mcpUrl, mcpToken }` and throws the named `P4_RUN_STATE_MISSING` or `P4_RUN_STATE_INVALID` without printing any value.

| Product | Owner | Scoped MCP credential | Scope |
|---|---|---|---|
| nextcloud | `qa-owner` (install-time admin) | app password minted over OCS | one app password; revocable; not the login password |
| outline | `qa-owner@p4.test` | Outline API key | user-scoped, 1-day expiry |
| penpot | `qa-owner@p4.test` | Penpot access token | user-scoped, expiry set |
| mattermost | `qa-agent` (member, not admin) | PAT | member permissions only |
| twenty | dev-seed Jane (existing fixture) | API key JWT, role without settings access | 4-hour expiry, revoked is left to expiry |

Rules: nothing prints a token, password or key (names only); no secret is written to a committed file, a log or test output; `evidence/` holds numbers only; CI never uploads `.harness/`; tests use obvious fake values and assert they do not leak.

## 10 Fallback: if the full set does not fit

Measured baseline so far: Twenty about 1.8 GiB (VERIFIED). Everything else is **INFERRED** until the probe runs: Nextcloud plus Postgres plus MCP about 1 GiB, Outline plus Postgres, Redis and Mailpit about 1 GiB, Penpot (JVM backend, exporter with Chromium, frontend, Postgres, Valkey, MCP at 105 MiB measured) about 3 GiB, Mattermost plus Postgres about 0.8 GiB. That sums to about 8 GiB, so I expect the full set to fit the 14 GiB budget. If `fit` is false, or the disk runs out first:

- **Stack A:** Nextcloud + Outline. **Stack B:** Twenty + Penpot + Mattermost.
- No adapter change is needed. Every product has its own compose project (`qa-harness-<product>`), its own ports and its own run-state file, so any subset starts with `npm run up -- <product>` and `p4-ram-probe.sh <subset>`. CI becomes a two-job matrix over the two subsets, each with its own `ram-probe-<stack>.json`.
- This split is the only trigger for a second ADR (`0007-p4-stack-split.md`). The probe, not this plan, decides.

## 11 Commands and expected output (for the build phase)

```bash
npm ci
npm run check            # tsc --noEmit, tsc + node --test, tsc build
```

Expected: all existing tests pass unchanged and the new `*.test.ts` files appear in the node:test summary with `fail 0`.

```bash
npm run up -- nextcloud
```

Expected tail: `Nextcloud is up: http://127.0.0.1:8080 (MCP http://127.0.0.1:8765/mcp). Owner credentials are in <repo>/.harness/nextcloud-run.json.` Exit 0. The same line shape for `outline`, `penpot`, `mattermost`; for Twenty run `TWENTY_MCP=1 npm run up -- twenty` and expect the existing Twenty summary followed by `Twenty MCP ready: http://127.0.0.1:3002/mcp (7 tools)`.

```bash
node scripts/ready.mjs nextcloud outline penpot mattermost twenty
```

Expected (timings vary; tool counts are the minimums the probe saw):

```text
ready nextcloud health=ok mcp=ok tools=188 in 1890 ms
ready outline health=ok mcp=ok tools=20 in 412 ms
ready penpot health=ok mcp=ok tools=4 in 960 ms
ready mattermost health=ok mcp=ok tools=12 in 740 ms
ready twenty health=ok mcp=ok tools=7 in 380 ms
```

Outline 20, Mattermost 12 and the Outline/Mattermost latencies are **not yet observed**; treat them as targets. A failure prints one `MCP_NOT_READY:` or `Timed out waiting for …` line and exits 1.

```bash
bash scripts/p4-ram-probe.sh nextcloud outline penpot mattermost twenty
cat evidence/ram-probe.json
```

Expected shape (numbers are placeholders, the real file comes from CI):

```json
{ "schema": 1, "budgetMiB": 14336, "products": ["nextcloud","outline","penpot","mattermost","twenty"],
  "containers": [{ "name": "qa-harness-penpot-backend-1", "peakMiB": 0 }],
  "totalPeakMiB": 0, "sumOfPeaksMiB": 0, "hostUsedPeakMiB": 0, "diskFreeGiB": 0, "readyMs": 0, "fit": true }
```

Always finish with `npm run down -- <product>` per product (the probe script does this in a trap) and `docker ps -a --filter name=qa-harness --format '{{.Names}}'` must print nothing.

## 12 ADR draft: `docs/adr/0006-p4-products.md`

```text
# 0006. Add the P4 products as image-only harness adapters

- Status: Proposed
- Date: 2026-11-18

## Context
P4 needs Nextcloud, Outline, Penpot and Mattermost next to Cal, Documenso, Medusa and Twenty, each with an MCP
endpoint. None has a fork. ProductConfig.productRoot is required and loadConfig() resolves a fork for every product.
CONTRIBUTING.md:40 asks for an ADR before upstream-default changes to docker/*.compose.yml.

## Decision
1. Same architecture: one adapter per product extending BaseAdapter, pure helpers with unit tests, a harness-owned
   standalone compose file (name: qa-harness-<product>), loopback ports.
2. productRoot for these products is .harness/<product>. loadConfig() stays eager over the four fork products;
   the new products load through loadProductConfig(id) only.
3. Every image is pinned as tag@digest (docs/pins/p4.md). A test keeps the table and the compose files in step.
4. Readiness is app health plus a real MCP initialize and tools/list.
5. One fake owner and one scoped MCP credential per product, written to .harness/<product>-run.json (0600).
6. Twenty gets only TWENTY_MCP=1: mint a scoped API key and wait for /mcp. No compose or fork change.
7. Memory budget 14 GiB of the 16 GB runner, recorded by scripts/p4-ram-probe.sh as evidence/ram-probe.json.

## Alternatives considered
- Make productRoot optional: rejected, changes a shared interface.
- A shared abstract base adapter: rejected, a second architecture next to the existing pattern.
- Outline BSL 1.1: accepted for local QA use only; Docmost or Wiki.js are the alternatives.
- Mattermost: standalone MCP binary (development-only upstream) instead of the Enterprise-only embedded endpoint.
- Nextcloud MCP single-user mode (loopback) unless the pass-through mode is verified.

## Consequences
- New licence exposure: Outline BSL 1.1, Nextcloud MCP AGPL-3.0, Mattermost source AGPL-3.0.
- The Penpot MCP tools need a browser plugin session; readiness proves tools/list only.
- A product bump is a deliberate edit to the pin table and constants.
```

If the probe forces the split, add `0007-p4-stack-split.md`; otherwise no second ADR.

## 13 Acceptance criteria for the build

1. `npm run check` passes. New unit tests cover env building (`*-env.test.ts`), readiness parsing (`mcp-ready.test.ts`), seed (`*-seed.test.ts`, `p4-run-state.test.ts`, `twenty-mcp.test.ts`), RAM parsing (`p4-ram.test.ts`) and the pin table (`p4-pins.test.ts`).
2. CI `P4 adapters`: each of the five products reports `ready` with `tools/list` returning at least one tool, and `ram-probe.json` is uploaded with real, non-placeholder numbers and `fit` true (or the split in section 10 is applied).
3. Existing Cal, Documenso, Medusa and Twenty behaviour is unchanged: all existing tests pass, no existing default changes, `loadConfig()` still returns the same four products, and with `TWENTY_MCP` unset the Twenty compose options are identical to today.
4. No product fork edited (`git -C <fork> status --short` empty after `up`). No secret printed: grep of CI logs and test output for generated values finds nothing.
5. `docker ps -a --filter name=qa-harness` is empty after every run.

## 14 Risks and open questions

| # | Item | Label |
|---|---|---|
| R1 | Outline seeding (no CLI to create a user and key). Plan B (magic link through Mailpit) or Plan A (model script) may not work on 1.13.0. Highest risk, 2 h spike. | UNVERIFIED |
| R2 | Mattermost MCP: free path is a development-only standalone binary with no published image; HTTP client auth may be OAuth only; the commit to pin is unknown. | UNVERIFIED |
| R3 | Penpot: `manage.sh create-profile`, access-token RPC, health paths, JVM memory flag. | UNVERIFIED |
| R4 | Nextcloud: Calendar, Contacts, Mail compatible with Nextcloud 35 and installable in CI; `getapppassword` on a fresh install; the pass-through auth switch. | UNVERIFIED |
| R5 | Combined disk (about 5.5 GB of images for half the stack here; a public runner has about 14 GB free). The job frees disk; the probe records it. | INFERRED |
| R6 | Combined RAM estimate of about 8 GiB (only Twenty at 1.8 GiB and Penpot MCP at 105 MiB were measured). | INFERRED |
| R7 | Twenty: `/mcp` is always on at `v2.44.0`; a later bump could add a gate. Re-run `tools/list` on every Twenty bump. | VERIFIED for v2.44.0 |
| R8 | Twenty `authenticate()` returns a workspace-agnostic token that `/mcp` rejects; MCP code must use the loginToken exchange. | VERIFIED |
| R9 | `tools/list` is a weak signal for Nextcloud (passes with no Nextcloud) and Penpot (passes with no browser). Readiness adds a Nextcloud call; Penpot cannot do more without a browser. | VERIFIED |
| R10 | Outline `tools/list` count at runtime (20 is a static read; scope filtering may change it). | UNVERIFIED |
| R11 | Public-repo `ubuntu-latest` size (4 vCPU, 16 GB, 14 GB disk) is from GitHub docs, not measured here. | INFERRED |
| R12 | Upstream licences: Nextcloud server and Twenty licence text not read this session. Verified: Outline BSL 1.1, Penpot MPL-2.0, Penpot MCP MIT, Mattermost MIT/AGPL, Mattermost MCP Apache-2.0, Nextcloud MCP AGPL-3.0-only. | partly UNVERIFIED |
| R13 | An official Nextcloud-published MCP app might exist on apps.nextcloud.com (blocked from here). If it does, it is the more standard choice than a third-party server. | UNVERIFIED |
| R14 | Container env shows secrets in `docker inspect`. Acceptable on a throwaway loopback stack. | VERIFIED by design |

Questions for the reviewer:

- **Q1** Is Outline's BSL 1.1 acceptable, or should the wiki be Docmost or Wiki.js?
- **Q2** Mattermost MCP: approve Option 1 (standalone binary built from a pinned commit, development-only upstream), or waive MCP for Mattermost (Option 3)?
- **Q3** Nextcloud MCP: third-party `cbcoutinho` server (AGPL-3.0, most used), or wait until the official-app question (R13) is answered?
- **Q4** Is `productRoot = .harness/<product>` (D1) acceptable, or do you prefer making `productRoot` optional?
- **Q5** Should the new CI job be a required check, or stay advisory?
- **Q6** Digest pins for Twenty: keep the digest only in `docs/pins/p4.md` (this plan), or ADR a digest in `docker/twenty.compose.yml` too?

## 15 Commit plan and what will not be done

Branch commits, small and in order (lowercase Conventional Commits, `git add` by explicit path, no trailers, no `Co-authored-by`, no force-push, no rebase, no amend):

1. `docs(plan): harness p4 adapters` (this file, the only commit in the plan PR)
2. After approval: tasks 1 to 10 as named above, one commit each. The owner merges with a merge commit and tags.

Will not do: edit any product fork; bump the Twenty pin; touch the Cal, Documenso or Medusa adapters or defaults; add LibreChat, OpenClaw, LiteLLM, a stub model or a Gemma proof; use an LLM key; print or commit a secret; run CodeRabbit; merge, tag, squash, rebase or force-push; use the Bridge-bss account.

## 16 Approval decisions (2026-11-18)

The reviewer approved the plan with the answers below. **Where this section conflicts with sections 3 to 15, this section wins.**

| Question | Decision |
|---|---|
| Q1 Outline | Keep Outline. Licence **BSL 1.1**. Reason, recorded in ADR 0006: BSL 1.1 allows non-production self-hosted use, and a local QA harness is that use. |
| Q2 Mattermost | Use the **standalone `mattermost-mcp-server`** built from a pinned commit of `mattermost/mattermost-plugin-agents`: **`96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1`** (master at approval). Build it with a harness-owned multi-stage `docker/mattermost-mcp.Dockerfile` whose base images are pinned by digest. Bind to **127.0.0.1 only**. No Enterprise licence, no embedded endpoint. ADR 0006 records: "development-only binary, used for local testing". |
| Q3 Nextcloud | Use `cbcoutinho/nextcloud-mcp-server` at the pinned digest. **Run the D9 pass-through spike first.** Prefer authenticated pass-through over an unauthenticated `/mcp`. `docs/pins/p4.md` gets one line: an official Nextcloud MCP app was checked and is **UNVERIFIED** (appstore unreachable). |
| Q4 D1 `productRoot = .harness/<product>` | Accepted. Document it in ADR 0006. Add a unit test proving the four fork products still resolve exactly as before. |
| Q5 CI job | **Advisory**, not a required check. |
| Q6 Twenty digest | Do **not** change `docker/twenty.compose.yml` or any Twenty default. Record the observed digest in `docs/pins/p4.md` only. |

**Extra requirement, Penpot plugin spike:** Penpot MCP tool calls need a browser with the MCP plugin connected. A headless Playwright (Chromium) run must log in as the seeded user, open a file, connect the MCP plugin, then `tools/call` `high_level_overview` must return a non-error result. If headless cannot connect the plugin, **stop and report. Do not fake it.** Record the result as VERIFIED or FAILED.

**Order:** (1) Outline seeding spike, (2) Penpot plugin spike, (3) Nextcloud D9 pass-through spike, (4) Mattermost auth spike, then Tasks 1 to 10. Each task is its own commit. The PR stays a draft. Spike outcomes are reported before any build that depends on them.

**Spike method note:** the adapters do not exist until Tasks 3 to 6, so the spikes use raw `docker compose` files kept in the session scratchpad, not `npm run up`. Those files are not committed. The CI job and the adapters use only harness scripts.

## 17 Spike results (2026-11-17, run before any adapter code)

Spikes ran with raw `docker compose` files in the session scratchpad (not committed). Adapters do not exist yet, so the harness scripts could not be used for these. Each spike's VERIFIED lines were observed in this session.

| # | Spike | Result | What the build must do |
|---|---|---|---|
| 1 | Outline seeding | **VERIFIED, with a deviation from Plan B** | Outline's email sign-in (`plugins/email`) needs an existing team and user, so a fresh stack cannot sign up through it. The team and owner are created through Outline's own models (`Team`, `User`, `ApiKey`) in a container script (Plan A). API keys need scope `["*"]` (an empty scope returns 403). With that, `POST /api/auth.info` returns the owner, and `POST /mcp` `initialize` and `tools/list` return HTTP 200 with **20 tools** (matches the static read). The MCP is stateless: no `mcp-session-id` header. Health: `GET /_health` returns 200 (VERIFIED path). **Env:** `NODE_ENV=production` is required, since `ENVIRONMENT` derives from it. `NODE_ENV=production-ssl-disabled` fails on startup, but the migration step uses that value. Migration command: `node_modules/.bin/sequelize db:migrate` from `/opt/outline` with `NODE_ENV=production-ssl-disabled`. |
| 2 | Penpot plugin (headless Playwright) | **VERIFIED** | Headless Chromium logged in as the seeded owner, created a file over RPC, installed the bundled plugin (`/plugins/mcp/manifest.json`), accepted the permissions prompt, opened the plugin, and pressed "Connect". The plugin status reads `connected`. Then `tools/call high_level_overview` returned HTTP 200, `isError: false`, about 32 KB of text. **Required settings:** `PENPOT_FLAGS` must add `disable-admin-console` (it is on by default, and it blocks RPC with `nitrate-not-configured`) and `enable-prepl-server` (the owner-creation CLI uses PREPL). `PENPOT_DISABLE_IPV6_LISTEN=true` (the sandbox kernel has no IPv6 sockets). **Gap in the image:** the plugin connects to `/mcp/ws` on the frontend origin, and the image has no proxy for it. The build must mount a harness-owned nginx file into `/etc/nginx/overrides/server.d/` that proxies `/mcp/ws` to `mcp:4402/`. A location block in `location.d` does not work (it sits inside `location /`). **MCP mode:** single-user (`node index.js`). The plugin UI has no token field, so the image's `--multi-user` default cannot connect from the UI. Multi-user with a user token is **UNVERIFIED**. |
| 3 | Nextcloud D9 pass-through | **VERIFIED** | `MCP_DEPLOYMENT_MODE=multi_user_basic`, with no `NEXTCLOUD_USERNAME` or `NEXTCLOUD_PASSWORD` on the MCP container. The client sends `Authorization: Basic base64(user:app-password)`. The app password came from OCS `getapppassword` (HTTP 200, 72 characters). Results: `initialize` 200 with a session, `tools/list` 200 with **110 tools** (the count depends on which Nextcloud apps are enabled; the earlier 188 was a static count with no Nextcloud reachable), `nc_webdav_list_directory` 200 with `isError: false`. Negative cases: no credentials gives **400** (the plan said 401; the record is 400), a wrong password gives **401** on `tools/list` and `tools/call`. Calendar, Contacts and Mail: **UNVERIFIED**. `occ app:install calendar` returned "not found on the appstore" (the appstore is unreachable from the sandbox). |
| 4 | Mattermost MCP auth | **VERIFIED (HTTP, with a PAT)** | Built from pinned commit `96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1` (Go 1.27.3). The upstream HTTP mode is documented as OAuth, but in this build a **PAT bearer works**. `initialize` returns 200 with a session header, `tools/list` returns **121 tools**, `get_team_info` returns `isError: false` for a **non-admin** member. No credentials gives 401 with `WWW-Authenticate`. **Setup gotchas:** the PAT is created through the API (`POST /users/{id}/tokens`) after the user has the `system_user_access_token` role. `mmctl --local token generate` output is not a clean token string. The binary needs `--site-url` when bound to `0.0.0.0`. The sandbox proxy CA must be injected at build time in this sandbox only (CI has no proxy). The committed Dockerfile does not include it. Development-only upstream, as recorded in ADR 0006. |

**Penpot image digest for the plugin spike:** frontend, backend, exporter and MCP digests as in section 7 (all pulled and run here).

**Consequences for the build order (section 16):**

- Outline, Penpot, Nextcloud and Mattermost adapters can proceed, because each spike passed.
- Penpot needs the nginx overlay file (`docker/penpot-mcp-ws.conf`, a harness file, not a fork edit) and the two extra flags.
- Nextcloud needs `MCP_DEPLOYMENT_MODE=multi_user_basic` and no server-side password. The readiness check uses the owner's app password, not an unauthenticated call.
- Twenty MCP (Task 7) does not depend on any spike.
