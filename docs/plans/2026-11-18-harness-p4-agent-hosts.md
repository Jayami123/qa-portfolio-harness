# Harness P4 agent hosts (LibreChat, OpenClaw, LiteLLM): part B1 plan

## 1 Header

- Repo: `qa-portfolio-harness` · [Jayami123/qa-portfolio-harness](https://github.com/Jayami123/qa-portfolio-harness) · harness
- Branch: `feat/2026-11-18-harness-p4-agent-hosts` from `main` at **059b582** (merge of PR #60, P4 Lane 1 part A). The draft PR contains **this file only**. Do not build until the reviewer approves.
- Lane: P4 Lane 1, part B1 (harness adapters for the agent hosts). Part B2 (the suite repo: stub-determinism fixture `P4-STAT-001`, L1 cases, Gemma proof) is out of scope here.
- Date: 2026-11-18. Probe run on 2026-11-18 in a cloud session (Docker 29.10.0, 4 vCPU, 15.7 GiB RAM, about 15 GB free on `/`).
- Labels: **VERIFIED** (observed in this session; the command or file is named), **UNVERIFIED** (could not be checked, or checked only in part; a build-phase spike settles it), **INFERRED** (reasoned from verified facts, not observed end to end).
- Start and stop products only through `npm run up -- <product>` and `npm run down -- <product>`. Finish every run with `down` and confirm `docker ps -a --filter name=qa-harness` is empty.

## 2 Goal and scope

**Goal.** Add three pinned, image-only, startable adapters so the P4 suite can start its agent hosts the same way it starts the Part A products (ADR 0006, D1: `productRoot = .harness/<product>`):

1. **LiteLLM** (`litellm`): the single OpenAI-compatible proxy. Two aliases, no fallbacks. Logs which model answered.
2. **LibreChat** (`librechat`): the chat host. Points at LiteLLM and attaches the five Part A MCP servers through a `librechat.yaml` generated per run under `.harness/`.
3. **OpenClaw** (`openclaw`): the personal agent. Points at LiteLLM, approvals on, a mock channel only if the pin provides one.

**In scope**

- Three adapters, six helper files with unit tests, three compose files, registry and type entries, run-state helper.
- Extend `scripts/p4-ram-probe.sh`, `scripts/lib.mjs`, `scripts/ready.mjs` (product list).
- One **sibling advisory** workflow, `.github/workflows/p4-agent-hosts.yml`.
- Pins in `docs/pins/p4.md`, ADR `0007-p4-agent-hosts.md`, `.env.example` and README notes.
- Stub mode only. B1 proves wiring through LiteLLM: proxy healthy, both aliases present in the live config, `p4-stub` route configured.

**Out of scope (do not do in B1)**

- Any call to Gemma (`gemini/gemma-4-31b-it`), any `GEMINI_API_KEY`, the Gemini host, or a `p4-nightly` completion.
- The suite's fixture server. Only a tiny, **temporary** route listener is allowed (section 6, task 6), and it is named as temporary in the file and in the PR.
- Case IDs. The case ledger has **no L1 IDs**. Do not invent any, and do not close any suite case in this PR.
- Editing `docker/twenty.compose.yml`, any Part A or existing-product default, any product fork (including `Jayami123/openclaw` and `Jayami123/LibreChat`, which are reference forks and are never edited), any `.env` file.
- Attack-lab service (Lane 2).

## 3 Probe results (2026-11-18)

### 3.1 Session facts

| Check | Result | Label |
|---|---|---|
| Docker in this session | `docker version` server 29.10.0; `docker buildx imagetools inspect` and `docker pull` work; the SessionStart hook reported `docker login ok` | VERIFIED |
| Pulls from `ghcr.io` and `docker.io` | Worked for LiteLLM, OpenClaw, LibreChat and `mongo:8` | VERIFIED |
| Upstream GitHub API (`api.github.com/repos/...`, releases) | **Denied** for BerriAI/litellm, danny-avila/LibreChat, openclaw/openclaw: "GitHub access to this repository is not enabled for this session". So upstream release notes and repo metadata are **UNVERIFIED** here. Registry tags and image labels were used instead | VERIFIED (the denial) |
| Outbound proxy | Enabled (`$HTTPS_PROXY/__agentproxy/status`) | VERIFIED |

### 3.2 Summary table

| Product | Upstream · licence | Pin (`image:tag@digest`) | Health (observed) | Port | Config findings | Status |
|---|---|---|---|---|---|---|
| LiteLLM | github.com/BerriAI/litellm · **MIT** (`litellm-1.110.0.dist-info/licenses/LICENSE` in the image). Image also ships `litellm_enterprise` and `litellm_admin_mcp` (licences not read: UNVERIFIED) | `ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3` (the same digest is `docker.io/litellm/litellm:v1.110.0`, `latest` and `main-stable`) | `GET /health/liveliness` 200 (about 20 s after start), `GET /health/readiness` 200, `GET /health` 200 (the probe sent the master key with these) | 4000 | Two aliases in `model_list`, no fallbacks in the config. `general_settings.master_key: os.environ/LITELLM_MASTER_KEY`. `/v1/models` 200 with the key, 401 without. Route proof headers, below. No database needed | VERIFIED (B1 probe) |
| LibreChat | github.com/danny-avila/LibreChat (repo URL from the image namespace; UNVERIFIED on GitHub) · **MIT** (`/app/LICENSE` in the image) | `ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9` (the same digest is `ghcr.io/danny-avila/librechat:v0.8.7`) | `GET /health` 200 (about 8 s), `GET /api/config` 200 | 3080 | `CONFIG_PATH=/app/librechat.yaml`. `version: 1.3.13` is the newest config version (the log said "Outdated Config version: 1.2.8; Latest version: 1.3.13"). `mcpServers` with `type: streamable-http`. **`mcpSettings.allowedDomains` is required** for `127.0.0.1`, or the server is refused ("Domain ... is not allowed"). MongoDB required | VERIFIED (boot and allowlist), UNVERIFIED (MCP tool calls, `${VAR}` header substitution at runtime) |
| OpenClaw | github.com/openclaw/openclaw (image label) · **MIT** (image label and docs) | `ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503`. Docker tags `2026.10.33`, `extended-stable` and `2026.10.33-slim` share this digest. The release tag on GitHub is UNVERIFIED | `GET /healthz` 200 (about 27 s); `GET /readyz` returned 503 during warm-up and then `{"ready":true,...}` | 18789 (`gateway.port`) | Config file at `$OPENCLAW_CONFIG_PATH` (honoured). `gateway.mode: "local"` is **required** or the gateway exits 78 ("Gateway start blocked"). State dir must be writable by uid 1000. Approval keys in the schema: `tools.exec.ask` (`off`, `on-miss`, `always`), `tools.exec.security` (`deny`, `allowlist`, `full`), `approvals.exec.enabled`, `approvals.exec.mode` (`session`, `targets`, `both`). Custom provider: `models.providers.<id>` with `baseUrl`, `apiKey`, `api: "openai-completions"`, `models` (accepted at boot; no call made) | VERIFIED (boot, health, schema keys), UNVERIFIED (approval behaviour at run time, provider call to LiteLLM) |
| Mongo (LibreChat's database) | mongo · SSPL (UNVERIFIED here) | `mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd` (index digest, `imagetools`) | used by the probe, unpinned at the time | 27017 | needs AVX on the CPU (LibreChat docs) | pin VERIFIED, licence UNVERIFIED |

### 3.3 LiteLLM details (VERIFIED unless marked)

- **Start.** `docker run --network host ... ghcr.io/berriai/litellm:v1.110.0@sha256:4295... --config <file> --port 4000`. Liveliness 200 after about 20 s.
- **Aliases.** Each `model_list` entry has `model_name` (the alias) and `litellm_params` (`model`, `api_base`, `api_key`). The probe used `p4-stub` with `model: openai/stub-upstream-model` and `api_base: http://127.0.0.1:9911/v1`, and `p4-nightly` with `model: gemini/gemma-4-31b-it` and `api_key: os.environ/GEMINI_API_KEY`. `/v1/models` listed exactly `p4-stub` and `p4-nightly`.
- **Route proof (stub only).** `POST /v1/chat/completions` with `model: p4-stub` returned `content: "stub-ok"`. The answer came from the temporary stub, not Gemma.
- **No Gemma call.** `p4-nightly` without `GEMINI_API_KEY` returned HTTP 500 "Missing Gemini API key" **without a network call**.
- **Which model answered.** The response **body** `model` field echoes the alias (`p4-stub`). The response **headers** name the real route: `x-litellm-model-group: p4-stub`, `x-litellm-model-name: openai/stub-upstream-model`, `x-litellm-model-api-base: http://127.0.0.1:9911/v1`, `x-litellm-model-id`, `x-litellm-call-id`. The harness logs the header values, which contain no keys.
- **Fallbacks.** The docs list `router_settings.fallbacks`, `litellm_settings.default_fallbacks` and other fallback keys. The B1 config contains none of them, and a unit test asserts the generated YAML has no `fallback` text.
- **Master key.** `general_settings.master_key: os.environ/LITELLM_MASTER_KEY`. A Bearer call with the master key worked. The docs say the proxy will not start with an unset, empty or "unsafe" key (docs, UNVERIFIED for the exact unsafe list).
- **MCP.** `POST /mcp` answered. With no MCP servers granted, `initialize` returned `"The key has no MCP servers granted..."`, and `tools/list` returned `{"tools":[]}`. `GET /a2a` returned 404 with no agents configured. The docs give `general_settings.mcp_disabled_capabilities` (turns off **prompts and resources** only) and `litellm_settings.enable_mcp_registry` (default `false`, an opt-in). **No documented switch turns the `/mcp` route off**: UNVERIFIED. Plan: never grant an MCP server, and assert `tools/list` is empty in readiness.
- **Network at boot.** The proxy tries to fetch the model cost map from `raw.githubusercontent.com`, retries three times with a `CERTIFICATE_VERIFY_FAILED` in this sandbox, then falls back to a local copy. The package contains the switch `LITELLM_LOCAL_MODEL_COST_MAP` (VERIFIED in the source text; its runtime effect is UNVERIFIED and the build spike checks that the fetch line disappears).
- **Database.** Not needed for B1 (no `DATABASE_URL` was set and the proxy served requests).
- **Memory at rest.** 690 MiB (`docker stats`, VERIFIED).

### 3.4 LibreChat details (VERIFIED unless marked)

- **Env that boots the app** (names only): `MONGO_URI`, `PORT`, `HOST`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, `ALLOW_REGISTRATION`, `CONFIG_PATH`. `HOST=127.0.0.1` gave `Server listening at http://127.0.0.1:3080` (VERIFIED).
- **Config.** The mount is `./librechat.yaml` to `/app/librechat.yaml` (docs). `CONFIG_PATH` pointed at it, and the log printed "Custom config file loaded". Newest config version is `1.3.13`.
- **MCP keys.** `mcpServers.<name>` with `type: streamable-http`, `url`, `headers`, `initTimeout`, `timeout`, `serverInstructions` (docs). `headers` values accept `${ENV_VAR}` (docs, UNVERIFIED at run time).
- **Allowlist.** `mcpSettings.allowedDomains` is a list of hostnames (wildcards and `host:port` allowed). Without it, `127.0.0.1` was refused: `Domain "http://127.0.0.1:4000" is not allowed`. With it, the MCP registry created the server (VERIFIED). The docs' `allowedAddresses` is an SSRF exemption (`host:port`), not a domain list.
- **Auth failure display.** A server that rejects the credential is logged as `OAuth Required: true` (VERIFIED with a probe target that rejects; see 3.6).
- **Custom endpoint.** `endpoints.custom[]` with `name`, `apiKey` (`${VAR}`), `baseURL`, `models.default`, `models.fetch`, `titleConvo`, `modelDisplayLabel` (docs). Accepted at boot. No chat call made (UNVERIFIED).
- **Create a user.** The fake owner creation command is UNVERIFIED (not run). B1 does not need a login.
- **RAG API.** Its absence logs a warning. It is not needed.

### 3.5 OpenClaw details (VERIFIED unless marked)

- **CLI.** The image entrypoint is `tini -s -- node /app/docker-entrypoint.mjs`, and the default command is `node openclaw.mjs gateway`. Running `--help` through the entrypoint fails ("activation command was not found"). Use `--entrypoint node` for CLI calls: `node openclaw.mjs config schema` printed the 2.6 MB JSON schema, and `node openclaw.mjs --help` lists `approvals`, `config`, `channels` and other commands.
- **Gateway start.** Needs `gateway.mode: "local"`. Without it the gateway exited 78. With the probe config (local mode, loopback bind, token auth, exec approval `ask: "always"`, `security: "allowlist"`, `agents.defaults.model.primary: "p4-litellm/p4-stub"`, and a `models.providers.p4-litellm` entry) it reached `http server listening (14 plugins ...)` and `/healthz` 200.
- **Writable state.** Runs `openclaw doctor` on start. A read-only mount failed (`Read-only file system`). A root-owned host directory failed (`EACCES ... /home/node/.openclaw/tmp`). The container user is uid 1000.
- **Secrets warning.** "openclaw.json contains plaintext secret-bearing config". The probe used literal values. The schema says to use secret or env substitution. UNVERIFIED whether `${VAR}` works in `gateway.auth.token` and `models.providers.<id>.apiKey`.
- **Approvals (schema).** `tools.exec.ask` enum `off | on-miss | always`; `tools.exec.security` enum `deny | allowlist | full`; `tools.exec.mode` enum `deny | allowlist | ask | auto | full`. `approvals.exec` has `enabled` (default `false`), `mode` (`session | targets | both`) and `targets`. Runtime behaviour: UNVERIFIED.
- **Channels (schema).** `channels.whatsapp` exists (`allowFrom`, `dmPolicy`, `groups`, ...). `channels.qa-channel` exists with `baseUrl`, `pollTimeoutMs`, `botUserId`, and no description. **No channel named "mock" exists** in the schema's channel list (`defaults, discord, feishu, googlechat, imessage, irc, line, matrix, mattermost, msteams, nextcloud-talk, nostr, qa-channel, raft, reef, signal, slack, sms, synology-chat, telegram, tlon, twitch, whatsapp, x, zalo, zalouser`). `qa-channel` is a candidate and is UNVERIFIED (its purpose is not documented in the schema). B1 enables no channel.
- **Provider.** `models.mode: "merge"`, `models.providers.<id>` accepted (`baseUrl`, `apiKey`, `api: "openai-completions"`, `models`). A call from OpenClaw to LiteLLM: UNVERIFIED.
- **Memory at rest.** 1.14 GiB (`docker stats`, VERIFIED, gateway with 14 plugins).
- **Health.** The image's own Docker healthcheck calls `dist/docker-healthcheck.js`, which reads `/healthz` on the gateway port.

### 3.6 Measured memory and disk

| Container (probe, at rest) | Memory (`docker stats`) | Image size (uncompressed, `docker images`) |
|---|---|---|
| litellm | 690.4 MiB | 1.9 GB |
| librechat | 584.8 MiB | 3.83 GB |
| mongo (librechat's DB) | 167.8 MiB | 1.16 GB |
| openclaw | 1138 MiB | 2.98 GB (slim) |
| **Sum of the three agent hosts plus Mongo** | **about 2.58 GiB** | **about 9.9 GB** |

- Part A (VERIFIED in `docs/plans/2026-11-18-harness-p4-adapters.md` section 18.1): the five products peaked at **4901.4 MiB** (per-instant sum) and their images were estimated at about 9 GB (INFERRED).
- Combined estimate: about **7.5 GiB** of RAM, well under the 14336 MiB budget (INFERRED: the sum of separate peaks, to be measured per instant in CI).
- Combined **disk** estimate: about **19 GB** of images. A public runner's free space after the job's cleanup step is about 14 GB (INFERRED, see R5). **Disk, not RAM, is the likely binding constraint.**

### 3.7 Findings that change or constrain the request

1. **Loopback-only ports and containers.** Part A binds every product to `127.0.0.1` on the host. A container that reaches the host through `host.docker.internal` cannot reach a host-loopback port. So LibreChat, LiteLLM and OpenClaw run with **host networking on Linux** (decision D12). Docker Desktop does not support host networking, so this is Linux-only (CI and both cloud sessions are Linux).
2. **Disk is the likely blocker.** About 19 GB of images against about 14 GB free on a public runner. The plan measures this and records a split (section 10).
3. **LiteLLM's MCP route cannot be turned off by any documented key.** Mitigation: no MCP server is granted, `tools/list` is asserted empty, and the bind is loopback.
4. **LiteLLM needs a network switch at boot** (`LITELLM_LOCAL_MODEL_COST_MAP`), or it retries a GitHub URL.
5. **LibreChat needs `mcpSettings.allowedDomains`** and config version `1.3.13`. Both are in the generated YAML.
6. **OpenClaw needs `gateway.mode: "local"` and a writable state volume owned by uid 1000.** Both are in the plan.
7. **The stub must be reachable from the host network.** The `p4-stub` route needs a live HTTP listener. A temporary listener is the only extra process (task 6).
8. **The request's mock WhatsApp channel does not exist as a named mock.** B1 enables no channel. See Q3.

## 4 Design decisions

Numbering continues from ADR 0006 (D1 to D10).

- **D11 `productRoot = .harness/<product>`** for `litellm`, `librechat`, `openclaw`, as in D1. Each adapter writes only under its own `.harness/<product>/` folder and `.harness/<product>-run.json`. `loadConfig()` is unchanged.
- **D12 Host networking on Linux (non-standard, flagged).** `network_mode: host` for `litellm`, `librechat`, `mongodb` (librechat stack) and `openclaw`, with each app bound to `127.0.0.1`. *Why:* the Part A MCP and app ports are loopback-only, and containers cannot reach them otherwise. *Standard alternative:* one user-defined network (`qa-harness-agents`) with service DNS. That needs each product's MCP container to join the network, which means editing Part A compose files and the Twenty overlay. Not done in B1. Recorded in ADR 0007 as the alternative to revisit if host networking is refused.
- **D13 LiteLLM: official image, pinned by digest, no fork.** Config is a per-run file with `os.environ/` references only. The master key comes in through the environment and is never written to the config file.
- **D14 Two aliases, no fallbacks, stub by default.** `p4-stub` (api_base from `P4_STUB_BASE_URL`) and `p4-nightly` (`gemini/gemma-4-31b-it`). `P4_LLM_MODE` defaults to `stub`. The `GEMINI_API_KEY` value is passed to the LiteLLM container **only** when `P4_LLM_MODE=nightly`; in stub mode it is passed as an empty string, so a key in a developer's shell never reaches the container.
- **D15 MCP for LiteLLM is unused.** No `mcp_servers`, no grants, no agents. Readiness asserts `tools/list` is empty.
- **D16 LibreChat MCP via `librechat.yaml` with env placeholders (standard).** The YAML holds URLs and `${VAR}` placeholders only. The Authorization values go in `.harness/librechat/librechat.env` (mode 0600), read by compose `env_file`. The YAML is generated per run under `.harness/librechat/` and is never committed.
- **D17 OpenClaw config written into its state volume (non-standard, flagged).** The config holds the gateway token and the LiteLLM key, so it must not sit in a host file that a container user cannot read. The adapter creates a named volume `qa-harness-openclaw-state`, writes `openclaw.json` into it through a one-off container that runs as root and streams the config on stdin, then `chown`s the volume to uid 1000. *Alternative:* `${VAR}` substitution in the config (UNVERIFIED for these fields). Switch if the build spike shows substitution works.
- **D18 OpenClaw pin is a calver release tag, not `main`.** `2026.10.33-slim`, with its digest. The `main` tags are rejected by a unit test.
- **D19 OpenClaw approvals on.** `tools.exec.ask: "always"`, `tools.exec.security: "allowlist"`, `approvals.exec.enabled: true`, `approvals.exec.mode: "session"`. Forwarding to channels stays off (no `targets`).
- **D20 No mock channel in B1.** `channels.*` stays empty. B2 decides whether `channels.qa-channel` is the mock (needs its source read first, Q3).
- **D21 Secrets per run, never committed or printed.** `crypto.randomBytes`. Passwords and gateway tokens are base64url, JWT secrets are base64url, `CREDS_KEY` is 64 hex characters and `CREDS_IV` is 32 hex characters. Stored in `.harness/<product>/secrets.json` (mode 0600). Errors name variables and paths, never values.
- **D22 Readiness for an agent host is its own health, plus the LiteLLM model check where relevant.** See section 8.
- **D23 Ports and bind.** Loopback only: LiteLLM 4000, LibreChat 3080, OpenClaw 18789, Mongo 27017, the temporary stub 9911. None overlaps Part A's ports (3000, 3001, 3002, 3010, 3011, 4401, 5433, 5434, 5450 to 5463, 8000, 8025, 8026, 8027, 8065, 8066, 8080, 8765, 9000, 9001, 9003).

## 5 Files

New (names follow the Part A `<product>.adapter.ts`, `<product>-env.ts`, `<product>-seed.ts` pattern):

```text
docs/plans/2026-11-18-harness-p4-agent-hosts.md        (this file, the only file in the plan PR)
docker/litellm.compose.yml
docker/librechat.compose.yml
docker/openclaw.compose.yml
src/adapters/llm-run-state.ts            src/adapters/llm-run-state.test.ts
src/adapters/litellm.adapter.ts
src/adapters/litellm-env.ts              src/adapters/litellm-env.test.ts
src/adapters/litellm-seed.ts             src/adapters/litellm-seed.test.ts
src/adapters/librechat.adapter.ts
src/adapters/librechat-env.ts            src/adapters/librechat-env.test.ts
src/adapters/librechat-seed.ts           src/adapters/librechat-seed.test.ts
src/adapters/openclaw.adapter.ts
src/adapters/openclaw-env.ts             src/adapters/openclaw-env.test.ts
src/adapters/openclaw-seed.ts            src/adapters/openclaw-seed.test.ts
scripts/p4-route-stub.mjs                (TEMPORARY route listener, see task 6; removed in part B2)
.github/workflows/p4-agent-hosts.yml
docs/adr/0007-p4-agent-hosts.md
```

Edited (additive only):

```text
src/types.ts                  P4ProductId gains "litellm" | "librechat" | "openclaw"; P4_PRODUCT_IDS too
src/config.ts                 new env keys, three config builders, p4ProductRoot id union, loadProductConfig overloads
src/config-p4.test.ts         regression cases for the three new ids and loadConfig() unchanged
src/adapters/types.ts         no change (waitMcp stays optional; the three new adapters do not implement it)
src/adapters/registry.ts      three cases in getAdapter()
src/adapters/p4-pins.test.ts  the three compose files join COMPOSE_FILES; no latest/main tags
scripts/lib.mjs               PRODUCT_IDS gains the three ids
scripts/ready.mjs             no code change (reads PRODUCT_IDS through the adapters)
scripts/p4-ram-probe.sh       start the route stub, order check, P4_RAM_OUT, LLM mode guard in CI
scripts/p4-ram-summary.mjs    no change
docs/pins/p4.md               three new rows and a notes block
.env.example                  P4_LLM_MODE, P4_STUB_BASE_URL, LITELLM_BASE_URL, LIBRECHAT_BASE_URL, OPENCLAW_BASE_URL, LIBRECHAT_MCP_PRODUCTS (no secrets)
README.md                     one section: agent hosts, stub mode, host networking note
CHANGELOG.md                  Unreleased entry
```

Never edited: any product fork, `docker/twenty.compose.yml`, any Part A compose file, the Cal, Documenso, Medusa and Twenty adapters, `.github/workflows/p4-adapters.yml`.

## 6 Build tasks, with code skeletons

Each task ends with `npm run check`. Then one small commit, lowercase Conventional Commits, `git add` by explicit path, no trailers, no `Co-authored-by`, no "Generated by" text. Do the tasks in this order.

### Task 1: ids, config and registry (no behaviour change for existing products)

**Steps**

1. Open `src/types.ts`. Replace the `P4ProductId` line and the `P4_PRODUCT_IDS` array:

```ts
/** P4 products: image-only, no fork. Their productRoot is .harness/<product> (ADR 0006 D1; ADR 0007 D11). */
export type P4ProductId =
  | "nextcloud"
  | "outline"
  | "penpot"
  | "mattermost"
  | "litellm"
  | "librechat"
  | "openclaw";

export const P4_PRODUCT_IDS: readonly P4ProductId[] = [
  "nextcloud",
  "outline",
  "penpot",
  "mattermost",
  "litellm",
  "librechat",
  "openclaw",
];
```

`isForkProductId()` already tests membership in `P4_PRODUCT_IDS`, so the three new ids are not forks with no further change.

2. Open `src/config.ts`. Add these keys inside `envSchema`, after the Mattermost keys:

```ts
  // Agent hosts (ADR 0007). Loopback only. Stub mode is the default; the Gemma route is not used in B1.
  LITELLM_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:4000"),
  P4_LLM_MODE: z.string().trim().default("stub"),
  P4_STUB_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:9911/v1"),
  LIBRECHAT_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3080"),
  LIBRECHAT_DB_URL: z.string().trim().min(1).default("mongodb://127.0.0.1:27017/LibreChat"),
  LIBRECHAT_MCP_PRODUCTS: z.string().trim().default("nextcloud,outline,twenty,penpot,mattermost"),
  OPENCLAW_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:18789"),
```

3. In `src/config.ts`, add the interfaces next to the Part A ones and extend the union:

```ts
export interface LiteLlmConfig extends ProductConfig {
  id: "litellm";
  /** "stub" (default) routes p4-stub to the stub URL. "nightly" also allows the Gemma alias to be used. */
  mode: "stub" | "nightly";
  stubBaseUrl: string;
}

export interface LibreChatConfig extends ProductConfig {
  id: "librechat";
  /** Part A product ids whose MCP servers go into librechat.yaml. Each must have a run-state file. */
  mcpProducts: string[];
}

export interface OpenClawConfig extends ProductConfig {
  id: "openclaw";
}

export type P4Config =
  | NextcloudConfig
  | OutlineConfig
  | PenpotConfig
  | MattermostConfig
  | LiteLlmConfig
  | LibreChatConfig
  | OpenClawConfig;
```

4. In `src/config.ts`, add the builders below `buildMattermostConfig`. `parseP4LlmMode` lives in `litellm-env.ts` (task 3), so import it there:

```ts
import { parseP4LlmMode } from "./adapters/litellm-env.js";

function buildLiteLlmConfig(parsed: ParsedEnv): LiteLlmConfig {
  return {
    id: "litellm",
    productRoot: p4ProductRoot("litellm"),
    baseUrl: parsed.LITELLM_BASE_URL.replace(/\/$/, ""),
    dbUrl: "", // B1 runs LiteLLM without a database (VERIFIED: it served requests with no DATABASE_URL)
    mode: parseP4LlmMode(parsed.P4_LLM_MODE),
    stubBaseUrl: parsed.P4_STUB_BASE_URL.replace(/\/$/, ""),
  };
}

function buildLibreChatConfig(parsed: ParsedEnv): LibreChatConfig {
  return {
    id: "librechat",
    productRoot: p4ProductRoot("librechat"),
    baseUrl: parsed.LIBRECHAT_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.LIBRECHAT_DB_URL,
    mcpProducts: parsed.LIBRECHAT_MCP_PRODUCTS.split(",").map((s) => s.trim()).filter((s) => s !== ""),
  };
}

function buildOpenClawConfig(parsed: ParsedEnv): OpenClawConfig {
  return {
    id: "openclaw",
    productRoot: p4ProductRoot("openclaw"),
    baseUrl: parsed.OPENCLAW_BASE_URL.replace(/\/$/, ""),
    dbUrl: "", // OpenClaw has no database in B1
  };
}
```

5. In `src/config.ts`, change `p4ProductRoot` to accept the new ids:

```ts
function p4ProductRoot(id: P4ProductId): string {
  return path.join(HARNESS_ROOT, ".harness", id);
}
```

Import `P4ProductId` from `./types.js`.

6. In `src/config.ts`, add three overloads to `loadProductConfig` and three cases to its `switch`:

```ts
export function loadProductConfig(id: "litellm"): LiteLlmConfig;
export function loadProductConfig(id: "librechat"): LibreChatConfig;
export function loadProductConfig(id: "openclaw"): OpenClawConfig;
// ...in the switch, before the exhaustive default:
    case "litellm":
      return buildLiteLlmConfig(parsed);
    case "librechat":
      return buildLibreChatConfig(parsed);
    case "openclaw":
      return buildOpenClawConfig(parsed);
```

Do **not** change `loadConfig()`. It still builds `cal`, `documenso`, `medusa`, `twenty` only (`HarnessConfig` is unchanged).

7. In `src/adapters/registry.ts`, add three imports and three cases to `getAdapter()`:

```ts
import { LiteLlmAdapter } from "./litellm.adapter.js";
import { LibreChatAdapter } from "./librechat.adapter.js";
import { OpenClawAdapter } from "./openclaw.adapter.js";
// ...
    case "litellm":
      return new LiteLlmAdapter(loadProductConfig("litellm"));
    case "librechat":
      return new LibreChatAdapter(loadProductConfig("librechat"));
    case "openclaw":
      return new OpenClawAdapter(loadProductConfig("openclaw"));
```

These imports fail to compile until tasks 3 to 5 exist. Do task 1 **together with** the stubs from tasks 3 to 5, or temporarily leave the three `case` lines out and add them at the end of task 5. Say which you did in the commit message body.

8. In `scripts/lib.mjs`, extend `PRODUCT_IDS`:

```js
export const PRODUCT_IDS = ["cal", "documenso", "medusa", "twenty", "nextcloud", "outline", "penpot", "mattermost", "litellm", "librechat", "openclaw"];
```

**Unit tests** (extend `src/config-p4.test.ts`, which already has `describe("P4 config and the fork split ...")`):

```ts
  it("keeps loadConfig() to the four fork products", () => {
    // Regression: loadConfig() must not gain the agent hosts (ADR 0006 D2; ADR 0007 D11).
    const cfg = loadConfig();
    assert.deepEqual(Object.keys(cfg).filter((k) => k !== "productsRoot").sort(), ["cal", "documenso", "medusa", "twenty"]);
  });

  it("loads each agent host without PRODUCTS_ROOT and under .harness/<id>", () => {
    process.env.PRODUCTS_ROOT = "/definitely/not/here";
    for (const id of ["litellm", "librechat", "openclaw"] as const) {
      const cfg = loadProductConfig(id);
      assert.equal(cfg.productRoot, path.join(HARNESS_ROOT, ".harness", id));
    }
  });

  it("defaults the LLM mode to stub and rejects other values", () => {
    delete process.env.P4_LLM_MODE;
    assert.equal(loadProductConfig("litellm").mode, "stub");
    process.env.P4_LLM_MODE = "live";
    assert.throws(() => loadProductConfig("litellm"), /P4_LLM_MODE/);
    delete process.env.P4_LLM_MODE;
  });

  it("P4_PRODUCT_IDS now lists eleven ids, none of them a fork", () => {
    assert.equal(P4_PRODUCT_IDS.length, 7); // 4 Part A + 3 agent hosts; the list is P4 only
    assert.equal(P4_PRODUCT_IDS.some((id) => isForkProductId(id)), false);
  });
```

`path`, `HARNESS_ROOT`, `loadConfig`, `loadProductConfig` and `isForkProductId` are already imported in that file (or import them the same way). `isForkProductId` for `"litellm"` is `false` (it is a P4 id). Keep the test that the four fork ids are `true`.

**Commit:** `feat(config): add the litellm, librechat and openclaw ids`.

### Task 2: run-state helper for LLM hosts (pure, shared)

File `src/adapters/llm-run-state.ts`. It mirrors `p4-run-state.ts` (mode 0600, named errors, never prints values). It reuses the two error constants.

```ts
import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { P4_RUN_STATE_INVALID, P4_RUN_STATE_MISSING } from "./p4-run-state.js";

/** Run state for an LLM host (LiteLLM). The api key is the LiteLLM master key; it is never printed. */
export interface LlmRunState {
  version: 1;
  product: "litellm";
  /** OpenAI-compatible base URL, for example http://127.0.0.1:4000/v1 */
  baseUrl: string;
  /** Bearer key for the proxy. Never logged. */
  apiKey: string;
}

export function llmRunStateFile(product: "litellm", harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", `${product}-run.json`);
}

export function writeLlmRunState(file: string, state: LlmRunState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function readLlmRunState(product: "litellm", file: string = llmRunStateFile(product)): LlmRunState {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${P4_RUN_STATE_MISSING}: ${file} does not exist. Run up for ${product} first.`);
    }
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} could not be read.`);
  }
  let parsed: Partial<LlmRunState> | undefined;
  try {
    parsed = JSON.parse(text) as Partial<LlmRunState>;
  } catch {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} is not JSON (content not printed).`);
  }
  if (
    parsed?.version !== 1 ||
    parsed.product !== product ||
    typeof parsed.baseUrl !== "string" ||
    !/^https?:\/\//.test(parsed.baseUrl) ||
    typeof parsed.apiKey !== "string" ||
    parsed.apiKey.trim() === ""
  ) {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
  }
  return { version: 1, product, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey };
}
```

**Unit tests** `src/adapters/llm-run-state.test.ts` (use `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, as `p4-run-state.test.ts` does):

```ts
describe("llm run state", () => {
  it("writes mode 0600 and reads back the same state", () => { /* write, stat().mode & 0o777 === 0o600, read */ });
  it("names the missing file without printing a value", () => { /* readLlmRunState on a missing path: message contains P4_RUN_STATE_MISSING, not the key */ });
  it("rejects a file for another product or a non-URL base", () => { /* product "librechat" file or baseUrl "ftp://x" -> P4_RUN_STATE_INVALID */ });
  it("never includes the api key in an error message", () => { /* write a file with an invalid shape that contains a key; the error does not contain the key string */ });
});
```

**Commit:** `feat(adapters): add the llm run-state helper`.

### Task 3: LiteLLM (env, seed, adapter, compose)

#### 3a `src/adapters/litellm-env.ts`

```ts
import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";

/** Pinned in docs/pins/p4.md. Official image, no fork (D13). */
export const LITELLM_IMAGE =
  "ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3";
export const LITELLM_COMPOSE_PROJECT = "qa-harness-litellm";
/** The only two aliases. Order matters for the readiness message only. */
export const LITELLM_ALIASES = ["p4-stub", "p4-nightly"] as const;
export const LITELLM_STUB_ALIAS = "p4-stub";
export const LITELLM_NIGHTLY_ALIAS = "p4-nightly";

export type P4LlmMode = "stub" | "nightly";

/** Blank or unset means stub. Anything other than stub or nightly throws. Never reads a key. */
export function parseP4LlmMode(raw: string | undefined): P4LlmMode {
  const value = (raw ?? "").trim();
  if (value === "" || value === "stub") return "stub";
  if (value === "nightly") return "nightly";
  throw new Error(`P4_LLM_MODE must be "stub" or "nightly" (got a value that is not one of them).`);
}

/** The per-run master key. "sk-" prefix as used in the B1 probe (VERIFIED accepted). Never logged. */
export function generateLiteLlmMasterKey(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return `sk-p4-${randomBytes(24).toString("base64url")}`;
}

/**
 * The proxy config. No secrets: the master key is read from LITELLM_MASTER_KEY, and the Gemma key from GEMINI_API_KEY.
 * Two aliases, no fallbacks (D14). The stub URL is injected; the stub listener is temporary (task 6).
 */
export function liteLlmConfigYaml(opts: { stubBaseUrl: string }): string {
  return [
    "model_list:",
    `  - model_name: ${LITELLM_STUB_ALIAS}`,
    "    litellm_params:",
    "      model: openai/stub-upstream-model",
    `      api_base: ${opts.stubBaseUrl}`,
    "      api_key: p4-stub-dummy-key-not-a-secret",
    `  - model_name: ${LITELLM_NIGHTLY_ALIAS}`,
    "    litellm_params:",
    "      model: gemini/gemma-4-31b-it",
    "      api_key: os.environ/GEMINI_API_KEY",
    "general_settings:",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "",
  ].join("\n");
}

/**
 * The environment for `docker compose` for LiteLLM. GEMINI_API_KEY is passed only in nightly mode. In stub mode it is an
 * empty string, which overrides any key in the caller's shell (D14).
 */
export function liteLlmComposeEnv(
  base: NodeJS.ProcessEnv,
  opts: { mode: P4LlmMode; masterKey: string; configFile: string },
): NodeJS.ProcessEnv {
  return {
    ...base,
    LITELLM_MASTER_KEY: opts.masterKey,
    LITELLM_CONFIG_FILE: opts.configFile,
    GEMINI_API_KEY: opts.mode === "nightly" ? (base.GEMINI_API_KEY ?? "") : "",
  };
}

/** Reads the saved master key from a secrets text, or makes a new one. Mirrors nextcloudSecretsFromText. */
export function litellmSecretsFromText(
  text: string | undefined,
  make: () => { masterKey: string } = () => ({ masterKey: generateLiteLlmMasterKey() }),
): { masterKey: string } {
  if (text === undefined) return make();
  try {
    const parsed = JSON.parse(text) as { masterKey?: unknown };
    if (typeof parsed.masterKey === "string" && parsed.masterKey.startsWith("sk-")) return { masterKey: parsed.masterKey };
  } catch {
    // damaged file: fall through and make a new key
  }
  return make();
}

export function litellmComposeFiles(): string[] {
  return [harnessComposeFile("litellm.compose.yml")];
}
```

#### 3b `src/adapters/litellm-seed.ts` (pure functions, no I/O)

```ts
import { LITELLM_ALIASES, LITELLM_NIGHTLY_ALIAS, LITELLM_STUB_ALIAS } from "./litellm-env.js";

/** Throws unless the live /v1/models list is exactly the two aliases (D14). Never echoes the body. */
export function assertLiteLlmModels(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("LITELLM_MODELS_MISSING: /v1/models has no data array (body not printed)");
  const ids = data
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
  const expected = [...LITELLM_ALIASES].sort();
  if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
    throw new Error(`LITELLM_ALIASES_WRONG: expected exactly ${expected.join(", ")}; got ${ids.length} model ids`);
  }
  return ids;
}

/**
 * Reads the stub route from the response headers of a p4-stub call (VERIFIED names in the B1 probe).
 * Throws unless the group is p4-stub and the upstream name is present.
 */
export function stubRouteFromHeaders(headers: { get(name: string): string | null }): { alias: string; upstream: string } {
  const alias = headers.get("x-litellm-model-group") ?? "";
  const upstream = headers.get("x-litellm-model-name") ?? "";
  if (alias !== LITELLM_STUB_ALIAS) throw new Error(`LITELLM_ROUTE_WRONG: model group is "${alias}", expected ${LITELLM_STUB_ALIAS}`);
  if (upstream === "") throw new Error("LITELLM_ROUTE_WRONG: no x-litellm-model-name header");
  return { alias, upstream };
}

/** The one request readiness makes. It is always p4-stub, never p4-nightly (D14). */
export function stubCompletionRequest(baseUrl: string, apiKey: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: LITELLM_STUB_ALIAS, messages: [{ role: "user", content: "p4 readiness ping" }], max_tokens: 4 }),
    },
  };
}

/** Guard: the readiness code must never name the Gemma alias in a request. */
export function assertNoNightlyCall(url: string, init: RequestInit): void {
  const body = typeof init.body === "string" ? init.body : "";
  if (body.includes(`"${LITELLM_NIGHTLY_ALIAS}"`)) throw new Error("LITELLM_NIGHTLY_CALL_REFUSED: readiness never calls p4-nightly");
  void url;
}
```

#### 3c `src/adapters/litellm.adapter.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import type { LiteLlmConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { readLlmRunState, llmRunStateFile, writeLlmRunState } from "./llm-run-state.js";
import { LITELLM_COMPOSE_PROJECT, litellmComposeFiles, liteLlmComposeEnv, liteLlmConfigYaml, litellmSecretsFromText } from "./litellm-env.js";
import { assertLiteLlmModels, assertNoNightlyCall, stubCompletionRequest, stubRouteFromHeaders } from "./litellm-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";

const POLL_MS = 2000;

/** LiteLLM proxy (ADR 0007). One OpenAI-compatible endpoint, two aliases, no fallbacks, no MCP use (D13 to D15). */
export class LiteLlmAdapter extends BaseAdapter<LiteLlmConfig> {
  readonly id = "litellm" as const;

  constructor(cfg: LiteLlmConfig) {
    super(cfg);
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private configFile(): string {
    return path.join(this.cfg.productRoot, "config.yaml");
  }

  private composeOpts(masterKey: string): ComposeOptions {
    return {
      projectName: LITELLM_COMPOSE_PROJECT,
      files: litellmComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: liteLlmComposeEnv(process.env, { mode: this.cfg.mode, masterKey, configFile: this.configFile() }),
    };
  }

  async up(): Promise<void> {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    const text = fs.existsSync(this.secretsFile()) ? fs.readFileSync(this.secretsFile(), "utf8") : undefined;
    const secrets = litellmSecretsFromText(text);
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    // The config has no secrets, so it may be world-readable. The container reads it as root.
    fs.writeFileSync(this.configFile(), liteLlmConfigYaml({ stubBaseUrl: this.cfg.stubBaseUrl }), { encoding: "utf8", mode: 0o644 });
    writeLlmRunState(llmRunStateFile("litellm"), { version: 1, product: "litellm", baseUrl: `${this.cfg.baseUrl}/v1`, apiKey: secrets.masterKey });
    await composeUp(this.composeOpts(secrets.masterKey), { wait: true });
    await this.waitHealthy();
    await this.waitModels();
    await this.waitStubRoute();
    console.log(`LiteLLM is up: ${this.cfg.baseUrl} (aliases p4-stub and p4-nightly; mode ${this.cfg.mode}). The master key is in ${llmRunStateFile("litellm")} and is not printed.`);
  }

  async down(): Promise<void> {
    fs.rmSync(llmRunStateFile("litellm"), { force: true });
    await composeDown(this.composeOpts(this.masterKeyOnDisk()), ["--remove-orphans"]);
  }

  private masterKeyOnDisk(): string {
    const text = fs.existsSync(this.secretsFile()) ? fs.readFileSync(this.secretsFile(), "utf8") : undefined;
    return litellmSecretsFromText(text).masterKey;
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/health/liveliness`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** Liveliness only. It does not need the Gemini key (D14). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/health/liveliness`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status === 200) return;
        last = `HTTP ${r.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for ${url} to be ready (last: ${last})`);
  }

  /** The live config lists exactly the two aliases. Uses GET /v1/models, which calls no model. */
  async waitModels(timeoutMs?: number): Promise<string[]> {
    const { baseUrl, apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
        if (r.status === 200) return assertLiteLlmModels(await r.json());
        last = `HTTP ${r.status}`;
      } catch (err) {
        last = err instanceof Error && err.message.startsWith("LITELLM_") ? err.message : "connection failed";
        if (last.startsWith("LITELLM_ALIASES_WRONG")) throw new Error(last);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for LiteLLM aliases (last: ${last})`);
  }

  /** One p4-stub call. Logs the route names from the headers, never the key. Never calls p4-nightly. */
  async waitStubRoute(): Promise<void> {
    const { baseUrl, apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    const req = stubCompletionRequest(baseUrl, apiKey);
    assertNoNightlyCall(req.url, req.init);
    const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30000) });
    if (r.status !== 200) throw new Error(`LiteLLM p4-stub call returned HTTP ${r.status}`);
    const route = stubRouteFromHeaders(r.headers);
    console.log(`LiteLLM route: ${route.alias} answered via ${route.upstream}`);
  }

  async seed(): Promise<SeedResult> {
    return { product: this.id, created: true, users: [], notes: "No users. The master key is written to the run state (not printed)." };
  }

  /** baseUrl is the HOST url (no /v1). The run state's baseUrl already ends in /v1, so it is not used here. */
  async authenticate(): Promise<AuthSession> {
    const { apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${apiKey}`, raw: { source: "run-state" } };
  }

  /** Proves the key with a model list (no model call). session.baseUrl is the host url, so /v1 is added once here. */
  async proveAuth(session: AuthSession): Promise<void> {
    const r = await fetch(`${session.baseUrl}/v1/models`, { headers: { authorization: session.authorizationHeader } });
    if (r.status !== 200) throw new Error(`LiteLLM proveAuth /v1/models returned HTTP ${r.status}`);
  }
}
```

Note for the junior engineer: `baseUrl` in the run state ends in `/v1`, so `waitModels` uses `${baseUrl}/models`. `waitStubRoute` uses `${baseUrl}/chat/completions`. `authenticate()` returns the same run-state base. `proveAuth` is written with `session.baseUrl` (the host URL, no `/v1`), so **check the path in the build**: use `${session.baseUrl}/v1/models` in `proveAuth` only, and keep `session.baseUrl` as the host URL. Make the two consistent in the build and cover both in a test.

#### 3d `docker/litellm.compose.yml`

```yaml
# LiteLLM proxy (ADR 0007, D12 to D15). Official image pinned by digest; no fork. Host networking on Linux so the
# loopback-only ports of the other products are reachable (D12). Nothing secret is written in this file.
#
#   node scripts/up.mjs litellm
name: qa-harness-litellm

services:
  litellm:
    image: ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3
    network_mode: host
    command:
      - --config
      - /etc/p4/litellm-config.yaml
      - --host
      - 127.0.0.1
      - --port
      - "4000"
    environment:
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:?set by the adapter}
      # Use the bundled model cost map. Stops the fetch from raw.githubusercontent.com at boot (VERIFIED in the probe log).
      LITELLM_LOCAL_MODEL_COST_MAP: "True"
      # Empty in stub mode (D14). Set only by the adapter in nightly mode.
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
    volumes:
      - ${LITELLM_CONFIG_FILE:?set by the adapter}:/etc/p4/litellm-config.yaml:ro
```

Flag for the build spike: confirm `--host` is accepted by 1.110.0 and that `ss -ltn` shows `127.0.0.1:4000` only.

**Unit tests**

`src/adapters/litellm-env.test.ts`:

```ts
describe("litellm-env", () => {
  it("pins the image by digest", () => { assert.match(LITELLM_IMAGE, /@sha256:[0-9a-f]{64}$/); });
  it("parses the mode: blank and stub are stub, nightly is nightly, others throw", () => {
    assert.equal(parseP4LlmMode(undefined), "stub"); assert.equal(parseP4LlmMode(" "), "stub");
    assert.equal(parseP4LlmMode("nightly"), "nightly"); assert.throws(() => parseP4LlmMode("live"));
  });
  it("writes exactly two aliases and no fallback text", () => {
    const y = liteLlmConfigYaml({ stubBaseUrl: "http://127.0.0.1:9911/v1" });
    assert.equal((y.match(/model_name: /g) ?? []).length, 2);
    assert.match(y, /model_name: p4-stub/); assert.match(y, /model_name: p4-nightly/);
    assert.doesNotMatch(y, /fallback/i);
    assert.match(y, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
    assert.doesNotMatch(y, /gemini-api-key|AIza/i);      // no key material in the file
  });
  it("uses the injected stub URL as api_base", () => { /* liteLlmConfigYaml({stubBaseUrl:"http://h:1/v1"}) contains "api_base: http://h:1/v1" */ });
  it("passes GEMINI_API_KEY only in nightly mode", () => {
    const base = { PATH: "/usr/bin", GEMINI_API_KEY: "should-not-leak" };
    assert.equal(liteLlmComposeEnv(base, { mode: "stub", masterKey: "sk-x", configFile: "/c" }).GEMINI_API_KEY, "");
    assert.equal(liteLlmComposeEnv(base, { mode: "nightly", masterKey: "sk-x", configFile: "/c" }).GEMINI_API_KEY, "should-not-leak");
    assert.equal(base.LITELLM_MASTER_KEY, undefined);     // base not mutated
  });
  it("generates an sk- master key that differs per call (injected source)", () => { /* fixed bytes -> same; real -> differs; starts with sk- */ });
  it("reuses a saved key and replaces a damaged one", () => { /* same pattern as nextcloud-env.test.ts */ });
  it("lists one compose file", () => { assert.equal(litellmComposeFiles().length, 1); });
});
```

`src/adapters/litellm-seed.test.ts`:

```ts
describe("litellm-seed", () => {
  it("accepts exactly the two aliases in any order", () => {
    assert.deepEqual(assertLiteLlmModels({ data: [{ id: "p4-nightly" }, { id: "p4-stub" }] }).sort(), ["p4-nightly", "p4-stub"]);
  });
  it("throws when an alias is missing or an extra one is present, without echoing the body", () => {
    assert.throws(() => assertLiteLlmModels({ data: [{ id: "p4-stub" }] }), /LITELLM_ALIASES_WRONG/);
    assert.throws(() => assertLiteLlmModels({ data: [{ id: "p4-stub" }, { id: "p4-nightly" }, { id: "gpt-x" }] }), /LITELLM_ALIASES_WRONG/);
    assert.throws(() => assertLiteLlmModels({ data: [{ id: "secret-sk-123" }] }), (e: Error) => !e.message.includes("secret-sk-123"));
  });
  it("reads the stub route from headers and refuses other groups", () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
    assert.deepEqual(stubRouteFromHeaders(h({ "x-litellm-model-group": "p4-stub", "x-litellm-model-name": "openai/stub-upstream-model" })), { alias: "p4-stub", upstream: "openai/stub-upstream-model" });
    assert.throws(() => stubRouteFromHeaders(h({ "x-litellm-model-group": "p4-nightly", "x-litellm-model-name": "gemini/x" })), /LITELLM_ROUTE_WRONG/);
  });
  it("never builds a request that names the Gemma alias", () => {
    const req = stubCompletionRequest("http://127.0.0.1:4000/v1", "sk-x");
    assert.doesNotThrow(() => assertNoNightlyCall(req.url, req.init));
    assert.throws(() => assertNoNightlyCall("u", { body: JSON.stringify({ model: "p4-nightly" }) }), /LITELLM_NIGHTLY_CALL_REFUSED/);
  });
});
```

Also add to `p4-pins.test.ts` (task 8): `docker/litellm.compose.yml` digest matches `LITELLM_IMAGE`.

**Commit:** `feat(adapters): add the litellm proxy adapter`.

### Task 4: LibreChat (env, seed, adapter, compose)

#### 4a `src/adapters/librechat-env.ts`

```ts
import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";
import type { P4ProductId } from "../types.js";

/** Pinned in docs/pins/p4.md. Official image (ghcr.io/librechat-ai namespace; same digest as danny-avila). */
export const LIBRECHAT_IMAGE =
  "ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9";
/** Pinned mongo, the database LibreChat needs. */
export const LIBRECHAT_MONGO_IMAGE = "mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd";
export const LIBRECHAT_COMPOSE_PROJECT = "qa-harness-librechat";
/** The newest config version the image reports (VERIFIED: "Latest version: 1.3.13" in the probe log). */
export const LIBRECHAT_CONFIG_VERSION = "1.3.13";
export const LIBRECHAT_MCP_HOSTS = ["127.0.0.1", "localhost"] as const;

export interface LibreChatMcpServer {
  name: string;
  url: string;
  /** Name of the env var that holds the full Authorization header value. null means no header (Penpot single-user). */
  authEnv: string | null;
}

/** The five Part A MCP endpoints, with the env var that carries each one's Authorization value (D16). */
export function librechatMcpServerFor(product: string): LibreChatMcpServer {
  switch (product) {
    case "nextcloud": return { name: "nextcloud", url: "http://127.0.0.1:8765/mcp", authEnv: "P4_NEXTCLOUD_MCP_AUTHORIZATION" };
    case "outline": return { name: "outline", url: "http://127.0.0.1:3011/mcp", authEnv: "P4_OUTLINE_MCP_AUTHORIZATION" };
    case "twenty": return { name: "twenty", url: "http://127.0.0.1:3002/mcp", authEnv: "P4_TWENTY_MCP_AUTHORIZATION" };
    case "penpot": return { name: "penpot", url: "http://127.0.0.1:4401/mcp", authEnv: null };
    case "mattermost": return { name: "mattermost", url: "http://127.0.0.1:8066/mcp", authEnv: "P4_MATTERMOST_MCP_AUTHORIZATION" };
    default: throw new Error(`LIBRECHAT_MCP_UNKNOWN: no MCP server is defined for "${product}"`);
  }
}

/** Builds librechat.yaml text. No secret value appears here: only ${VAR} placeholders (D16). */
export function librechatYaml(opts: { liteLlmBaseUrl: string; defaultModel: string; servers: LibreChatMcpServer[] }): string {
  const lines: string[] = [`version: ${LIBRECHAT_CONFIG_VERSION}`, "cache: true", "mcpSettings:", "  allowedDomains:"];
  for (const h of LIBRECHAT_MCP_HOSTS) lines.push(`    - "${h}"`);
  lines.push("mcpServers:");
  for (const s of opts.servers) {
    lines.push(`  ${s.name}:`, "    type: streamable-http", `    url: ${s.url}`, "    initTimeout: 30000", "    timeout: 60000");
    if (s.authEnv !== null) lines.push("    headers:", `      Authorization: "\${${s.authEnv}}"`);
  }
  lines.push(
    "endpoints:",
    "  custom:",
    '    - name: "P4 LiteLLM"',
    '      apiKey: "${P4_LITELLM_API_KEY}"',
    `      baseURL: "${opts.liteLlmBaseUrl}"`,
    "      models:",
    `        default: ["${opts.defaultModel}"]`,
    "        fetch: false",
    "      titleConvo: false",
    "",
  );
  return lines.join("\n");
}

/** Env file for compose (mode 0600, written by the adapter). Values are never printed. */
export function librechatEnvText(values: Record<string, string>): string {
  return Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

export function librechatComposeFiles(): string[] {
  return [harnessComposeFile("librechat.compose.yml")];
}

/** Random values. Hex lengths match LibreChat's CREDS_KEY (32 bytes) and CREDS_IV (16 bytes). */
export function librechatSecretValues(randomBytes: (n: number) => Buffer = crypto.randomBytes) {
  return {
    mongoPassword: randomBytes(24).toString("base64url"),
    jwtSecret: randomBytes(32).toString("base64url"),
    jwtRefreshSecret: randomBytes(32).toString("base64url"),
    credsKey: randomBytes(32).toString("hex"),
    credsIv: randomBytes(16).toString("hex"),
    ownerPassword: randomBytes(24).toString("base64url"),
  };
}
```

#### 4b `src/adapters/librechat-seed.ts`

```ts
import { readP4McpCredentials, p4RunStateFile } from "./p4-run-state.js";
import { librechatMcpServerFor, type LibreChatMcpServer } from "./librechat-env.js";

/** The Mongo URI with the per-run password, percent-encoded, and authSource=admin (root user, see the compose file). */
export function librechatMongoUri(password: string, host = "127.0.0.1:27017"): string {
  return `mongodb://librechat:${encodeURIComponent(password)}@${host}/LibreChat?authSource=admin`;
}

/**
 * For each Part A product in the list, reads its MCP URL and Authorization from the run state, and returns the
 * server entry plus the env var values to write. Throws P4_RUN_STATE_MISSING (named product) when a file is absent.
 */
export function librechatMcpEnv(products: string[], readCreds = readP4McpCredentials, stateFile = p4RunStateFile): {
  servers: LibreChatMcpServer[];
  env: Record<string, string>;
} {
  const servers: LibreChatMcpServer[] = [];
  const env: Record<string, string> = {};
  for (const product of products) {
    const server = librechatMcpServerFor(product);
    const creds = readCreds(product, stateFile(product));
    servers.push({ ...server, url: creds.mcpUrl });       // the run state is the source of the URL
    if (server.authEnv !== null) {
      if (creds.mcpAuthorization === null) throw new Error(`LIBRECHAT_MCP_AUTH_MISSING: ${product} has no MCP credential in its run state`);
      env[server.authEnv] = creds.mcpAuthorization;
    }
  }
  return { servers, env };
}
```

Note the `url` from the run state overrides the default URL (so a changed `P4_*_MCP_URL` flows through).

#### 4c `src/adapters/librechat.adapter.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import type { LibreChatConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { notImplemented } from "../errors.js";
import { readLlmRunState, llmRunStateFile } from "./llm-run-state.js";
import { LIBRECHAT_COMPOSE_PROJECT, LIBRECHAT_IMAGE, LIBRECHAT_MONGO_IMAGE, librechatComposeFiles, librechatEnvText, librechatSecretValues, librechatYaml } from "./librechat-env.js";
import { librechatMcpEnv, librechatMongoUri } from "./librechat-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";

/** LibreChat chat host (ADR 0007). B1 proves boot, health and the generated MCP config. No login in B1. */
export class LibreChatAdapter extends BaseAdapter<LibreChatConfig> {
  readonly id = "librechat" as const;

  constructor(cfg: LibreChatConfig) {
    super(cfg);
  }

  private dir(): string {
    return this.cfg.productRoot;
  }

  private secretsFile(): string {
    return path.join(this.dir(), "secrets.json");
  }

  private composeOpts(envFile: string, configFile: string, mongoPassword: string): ComposeOptions {
    return {
      projectName: LIBRECHAT_COMPOSE_PROJECT,
      files: librechatComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: { ...process.env, LIBRECHAT_ENV_FILE: envFile, LIBRECHAT_CONFIG_FILE: configFile, LIBRECHAT_MONGO_PASSWORD: mongoPassword },
    };
  }

  async up(): Promise<void> {
    fs.mkdirSync(this.dir(), { recursive: true });
    const secrets = this.secretsOnDisk();
    const liteLlm = readLlmRunState("litellm", llmRunStateFile("litellm"));  // throws P4_RUN_STATE_MISSING if LiteLLM is not up
    const mcp = librechatMcpEnv(this.cfg.mcpProducts);
    const configFile = path.join(this.dir(), "librechat.yaml");
    fs.writeFileSync(configFile, librechatYaml({ liteLlmBaseUrl: liteLlm.baseUrl, defaultModel: "p4-stub", servers: mcp.servers }), { encoding: "utf8", mode: 0o644 });
    const envFile = path.join(this.dir(), "librechat.env");
    const values: Record<string, string> = {
      MONGO_URI: librechatMongoUri(secrets.mongoPassword),
      PORT: "3080",
      HOST: "127.0.0.1",
      JWT_SECRET: secrets.jwtSecret,
      JWT_REFRESH_SECRET: secrets.jwtRefreshSecret,
      CREDS_KEY: secrets.credsKey,
      CREDS_IV: secrets.credsIv,
      ALLOW_REGISTRATION: "false",
      CONFIG_PATH: "/app/librechat.yaml",
      P4_LITELLM_API_KEY: liteLlm.apiKey,
      ...mcp.env,
    };
    fs.writeFileSync(envFile, librechatEnvText(values), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(envFile, 0o600);
    await composeUp(this.composeOpts(envFile, configFile, secrets.mongoPassword), { wait: true });
    await this.waitHealthy();
    console.log(`LibreChat is up: ${this.cfg.baseUrl}. MCP servers in librechat.yaml: ${mcp.servers.map((s) => s.name).join(", ")}. Values are in ${envFile} (mode 0600) and are not printed.`);
  }

  private secretsOnDisk() {
    const text = fs.existsSync(this.secretsFile()) ? fs.readFileSync(this.secretsFile(), "utf8") : undefined;
    if (text !== undefined) {
      try { return JSON.parse(text) as ReturnType<typeof librechatSecretValues>; } catch { /* replace below */ }
    }
    const made = librechatSecretValues();
    fs.writeFileSync(this.secretsFile(), JSON.stringify(made), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    return made;
  }

  /** Never creates secrets. Compose needs the variables to parse the file, so a placeholder is passed; down removes containers only. */
  async down(): Promise<void> {
    const envFile = path.join(this.dir(), "librechat.env");
    const configFile = path.join(this.dir(), "librechat.yaml");
    await composeDown(this.composeOpts(envFile, configFile, "unused-on-down"), ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/health`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** /health and /api/config both 200 (VERIFIED in the probe). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const a = await fetch(`${this.cfg.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const b = await fetch(`${this.cfg.baseUrl}/api/config`, { signal: AbortSignal.timeout(5000) });
        if (a.status === 200 && b.status === 200) return;
        last = `health ${a.status}, api/config ${b.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for ${this.cfg.baseUrl}/health and /api/config to be ready (last: ${last})`);
  }

  async seed(): Promise<SeedResult> {
    return { product: this.id, created: false, users: [], notes: "B1 creates no LibreChat user. The owner is a B2 decision (Q6)." };
  }

  async authenticate(): Promise<AuthSession> {
    return notImplemented(this.id, "authenticate", "LibreChat login is part B2");
  }
}
```

Note: `notImplemented` returns `never` and matches the signature used in `base.ts`. The `secretsOnDisk()` helper must be called once per run in `up()` and reused in `down()`. Keep the first version simple and fix the duplicate read in review if needed.

#### 4d `docker/librechat.compose.yml`

```yaml
# LibreChat chat host and its MongoDB (ADR 0007, D12 and D16). Host networking on Linux, so the Part A MCP endpoints on
# 127.0.0.1 are reachable (D12). Secrets come from the adapter's env file and environment. None is written here.
#
#   node scripts/up.mjs librechat   (run `up litellm` first; the adapter needs its run state)
name: qa-harness-librechat

services:
  mongodb:
    image: mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd
    network_mode: host
    command: ["mongod", "--bind_ip", "127.0.0.1", "--port", "27017", "--auth"]
    environment:
      MONGO_INITDB_ROOT_USERNAME: librechat
      MONGO_INITDB_ROOT_PASSWORD: ${LIBRECHAT_MONGO_PASSWORD:?set by the adapter}
    volumes:
      - librechat_harness_mongo:/data/db
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --port 27017 --eval 'db.adminCommand({ping:1}).ok' || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 40

  app:
    image: ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9
    network_mode: host
    depends_on:
      mongodb:
        condition: service_healthy
    env_file:
      - ${LIBRECHAT_ENV_FILE:?set by the adapter}
    volumes:
      - ${LIBRECHAT_CONFIG_FILE:?set by the adapter}:/app/librechat.yaml:ro

volumes:
  librechat_harness_mongo:
    name: qa-harness-librechat-mongo
```

Flags for the build spike: `mongosh` availability inside `mongo:8` (INFERRED: the official image ships it; if not, use a TCP check). `--bind_ip` and `--auth` (INFERRED: standard mongod flags).

**Unit tests**

`src/adapters/librechat-env.test.ts`:

```ts
describe("librechat-env", () => {
  it("pins the app and the mongo images by digest", () => { assert.match(LIBRECHAT_IMAGE, /@sha256:[0-9a-f]{64}$/); assert.match(LIBRECHAT_MONGO_IMAGE, /@sha256:[0-9a-f]{64}$/); });
  it("maps the five Part A products and rejects others", () => {
    for (const p of ["nextcloud", "outline", "twenty", "penpot", "mattermost"]) assert.ok(librechatMcpServerFor(p).url.endsWith("/mcp"));
    assert.throws(() => librechatMcpServerFor("cal"), /LIBRECHAT_MCP_UNKNOWN/);
  });
  it("writes a yaml with the pinned config version, allowlisted loopback and five servers", () => {
    const servers = ["nextcloud", "outline", "twenty", "penpot", "mattermost"].map(librechatMcpServerFor);
    const y = librechatYaml({ liteLlmBaseUrl: "http://127.0.0.1:4000/v1", defaultModel: "p4-stub", servers });
    assert.match(y, /^version: 1\.3\.13$/m);
    assert.match(y, /allowedDomains:\n    - "127\.0\.0\.1"/);
    assert.equal((y.match(/type: streamable-http/g) ?? []).length, 5);
    assert.match(y, /baseURL: "http:\/\/127\.0\.0\.1:4000\/v1"/);
  });
  it("puts no secret value in the yaml: only ${VAR} placeholders", () => {
    const servers = ["nextcloud", "penpot"].map(librechatMcpServerFor);
    const y = librechatYaml({ liteLlmBaseUrl: "http://127.0.0.1:4000/v1", defaultModel: "p4-stub", servers });
    assert.doesNotMatch(y, /Bearer |Basic |[0-9a-f]{32,}/);
    assert.match(y, /\$\{P4_NEXTCLOUD_MCP_AUTHORIZATION\}/);
  });
  it("has no headers block for Penpot (single-user, no token)", () => {
    const y = librechatYaml({ liteLlmBaseUrl: "http://x/v1", defaultModel: "p4-stub", servers: [librechatMcpServerFor("penpot")] });
    assert.doesNotMatch(y, /headers:/);
  });
  it("writes the env text as NAME=value lines", () => { assert.equal(librechatEnvText({ A: "1", B: "2" }), "A=1\nB=2\n"); });
  it("makes secrets of the right shape that differ per call", () => {
    const s = librechatSecretValues();
    assert.match(s.credsKey, /^[0-9a-f]{64}$/); assert.match(s.credsIv, /^[0-9a-f]{32}$/);
    assert.notEqual(librechatSecretValues().jwtSecret, s.jwtSecret);
  });
});
```

`src/adapters/librechat-seed.test.ts`:

```ts
describe("librechat-seed", () => {
  it("percent-encodes the password in the Mongo URI and keeps authSource=admin", () => {
    assert.equal(librechatMongoUri("a/b+c"), "mongodb://librechat:a%2Fb%2Bc@127.0.0.1:27017/LibreChat?authSource=admin");
  });
  it("reads each Part A run state for the URL and the Authorization value, and never prints the value", () => {
    const fake = (product: string) => ({ mcpUrl: `http://127.0.0.1:9/${product}`, mcpAuthorization: product === "penpot" ? null : `Bearer SECRET-${product}` });
    const out = librechatMcpEnv(["nextcloud", "penpot"], (p) => fake(p), (p) => `/x/${p}`);
    assert.equal(out.servers[0]?.url, "http://127.0.0.1:9/nextcloud");
    assert.equal(out.env.P4_NEXTCLOUD_MCP_AUTHORIZATION, "Bearer SECRET-nextcloud");
    assert.equal(Object.keys(out.env).includes("P4_PENPOT_MCP_AUTHORIZATION"), false); // Penpot has no header
  });
  it("throws a named error when a product has no MCP credential", () => {
    assert.throws(() => librechatMcpEnv(["nextcloud"], () => ({ mcpUrl: "http://127.0.0.1:1/mcp", mcpAuthorization: null }), () => "/x"), /LIBRECHAT_MCP_AUTH_MISSING/);
  });
  it("names the product when its run-state file is missing", () => {
    assert.throws(() => librechatMcpEnv(["outline"], () => { throw new Error("P4_RUN_STATE_MISSING: /x does not exist"); }, () => "/x"), /P4_RUN_STATE_MISSING/);
  });
});
```

**Commit:** `feat(adapters): add the librechat adapter`.

### Task 5: OpenClaw (env, seed, adapter, compose)

#### 5a `src/adapters/openclaw-env.ts`

```ts
import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";

/** Pinned in docs/pins/p4.md. Calver release tag, never main (D18). Slim variant. */
export const OPENCLAW_IMAGE =
  "ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503";
export const OPENCLAW_COMPOSE_PROJECT = "qa-harness-openclaw";
/** Named volume with the state and the config (D17). The name is fixed so the adapter can write into it. */
export const OPENCLAW_STATE_VOLUME = "qa-harness-openclaw-state";
export const OPENCLAW_GATEWAY_PORT = 18789;
export const OPENCLAW_PRIMARY_MODEL = "p4-litellm/p4-stub";

export function generateOpenClawGatewayToken(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The gateway config (VERIFIED accepted by the B1 probe). Loopback bind, token auth, exec approval asks every time,
 * approvals on, one custom provider (LiteLLM), no channel. The token and the key are literal here, so the file must
 * never be written to a host path a container user cannot read (D17).
 */
export function openClawConfig(opts: { gatewayToken: string; liteLlmBaseUrl: string; liteLlmKey: string }): Record<string, unknown> {
  return {
    gateway: {
      mode: "local",
      bind: "loopback",
      port: OPENCLAW_GATEWAY_PORT,
      auth: { mode: "token", token: opts.gatewayToken },
    },
    tools: { exec: { ask: "always", security: "allowlist" } },
    approvals: { exec: { enabled: true, mode: "session" } },
    agents: { defaults: { model: { primary: OPENCLAW_PRIMARY_MODEL } } },
    models: {
      mode: "merge",
      providers: {
        "p4-litellm": {
          baseUrl: `${opts.liteLlmBaseUrl}/v1`,
          apiKey: opts.liteLlmKey,
          api: "openai-completions",
          models: [{ id: "p4-stub", name: "p4-stub" }],
        },
      },
    },
    channels: {},
  };
}

export function openClawComposeFiles(): string[] {
  return [harnessComposeFile("openclaw.compose.yml")];
}

export function openClawComposeEnv(base: NodeJS.ProcessEnv, gatewayToken: string): NodeJS.ProcessEnv {
  return { ...base, OPENCLAW_GATEWAY_TOKEN: gatewayToken };
}

/** A pin is recorded as a calver tag or semver, never main or latest (D18). */
export function assertOpenClawPinIsRelease(image: string): void {
  if (/:(main|latest)/.test(image) || !/:\d{4}\.\d{1,2}\.\d{1,3}/.test(image)) {
    throw new Error(`OPENCLAW_PIN_NOT_RELEASE: the pin must be a dated release tag (got a non-release tag)`);
  }
}
```

#### 5b `src/adapters/openclaw-seed.ts`

```ts
/** The argv that writes openclaw.json into the state volume through a root one-off container (D17). The config travels on stdin. */
export function openClawWriteConfigArgs(image: string, volume: string): string[] {
  return [
    "run", "--rm", "-i", "--user", "0", "--entrypoint", "sh",
    "-v", `${volume}:/home/node/.openclaw`,
    image,
    "-c", "cat > /home/node/.openclaw/openclaw.json && chown -R 1000:1000 /home/node/.openclaw",
  ];
}

/** Parses /readyz. Ready only when the body says ready: true. */
export function readyzIsReady(body: unknown): boolean {
  return (body as { ready?: unknown } | null)?.ready === true;
}
```

Note: `--entrypoint sh` with `image` as the image name and `-c`: pass the image **with** its digest. The helper container has no network needs.

#### 5c `src/adapters/openclaw.adapter.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { run } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { readLlmRunState, llmRunStateFile } from "./llm-run-state.js";
import { OPENCLAW_COMPOSE_PROJECT, OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME, assertOpenClawPinIsRelease, generateOpenClawGatewayToken, openClawComposeEnv, openClawComposeFiles, openClawConfig } from "./openclaw-env.js";
import { openClawWriteConfigArgs, readyzIsReady } from "./openclaw-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";

/** OpenClaw gateway (ADR 0007). Approvals on, LiteLLM as the only provider, no channel in B1 (D19, D20). */
export class OpenClawAdapter extends BaseAdapter<OpenClawConfig> {
  readonly id = "openclaw" as const;

  constructor(cfg: OpenClawConfig) {
    super(cfg);
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private composeOpts(token: string): ComposeOptions {
    return { projectName: OPENCLAW_COMPOSE_PROJECT, files: openClawComposeFiles(), cwd: HARNESS_DOCKER_DIR, env: openClawComposeEnv(process.env, token) };
  }

  private tokenOnDisk(): string {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    if (fs.existsSync(this.secretsFile())) {
      const parsed = JSON.parse(fs.readFileSync(this.secretsFile(), "utf8")) as { gatewayToken?: unknown };
      if (typeof parsed.gatewayToken === "string" && parsed.gatewayToken !== "") return parsed.gatewayToken;
    }
    const token = generateOpenClawGatewayToken();
    fs.writeFileSync(this.secretsFile(), JSON.stringify({ gatewayToken: token }), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    return token;
  }

  async up(): Promise<void> {
    assertOpenClawPinIsRelease(OPENCLAW_IMAGE);
    const token = this.tokenOnDisk();
    const liteLlm = readLlmRunState("litellm", llmRunStateFile("litellm")); // LiteLLM must be up first
    // 1. The named volume exists. 2. The config goes into it through a root helper, so it never sits on the host (D17).
    await run("docker", ["volume", "create", OPENCLAW_STATE_VOLUME], {});
    const config = JSON.stringify(openClawConfig({ gatewayToken: token, liteLlmBaseUrl: liteLlm.baseUrl.replace(/\/v1$/, ""), liteLlmKey: liteLlm.apiKey }));
    await run("docker", openClawWriteConfigArgs(OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME), { input: config });
    // 3. Start the gateway with the same volume.
    await composeUp(this.composeOpts(token), { wait: true });
    await this.waitHealthy();
    console.log(`OpenClaw is up: ${this.cfg.baseUrl}. The gateway token is in ${this.secretsFile()} (mode 0600) and is not printed.`);
  }

  /** Never creates a token. Compose needs the variable to parse the file, so a placeholder is passed on down. */
  async down(): Promise<void> {
    await composeDown(this.composeOpts("unused-on-down"), ["--remove-orphans"]);
    if (process.env.OPENCLAW_DOWN_VOLUMES === "1") {
      await run("docker", ["volume", "rm", "-f", OPENCLAW_STATE_VOLUME], {});
      fs.rmSync(this.secretsFile(), { force: true });
    }
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/healthz`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** /healthz 200, then /readyz with ready: true (VERIFIED after warm-up). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const h = await fetch(`${this.cfg.baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
        if (h.status === 200) {
          const r = await fetch(`${this.cfg.baseUrl}/readyz`, { signal: AbortSignal.timeout(5000) });
          if (r.status === 200 && readyzIsReady(await r.json())) return;
          last = `readyz HTTP ${r.status}`;
        } else {
          last = `healthz HTTP ${h.status}`;
        }
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for ${this.cfg.baseUrl}/healthz and /readyz (last: ${last})`);
  }

  async seed(): Promise<SeedResult> {
    return { product: this.id, created: true, users: [], notes: "Config written into the state volume (not printed). No channel and no user in B1." };
  }

  async authenticate(): Promise<AuthSession> {
    return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${this.tokenOnDisk()}`, raw: { source: "secrets.json" } };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    // Health only in B1. The authenticated gateway call is a B2 proof.
    const r = await fetch(`${session.baseUrl}/healthz`);
    if (r.status !== 200) throw new Error(`OpenClaw proveAuth /healthz returned HTTP ${r.status}`);
  }
}
```

Note: `run()` must accept an `input` option for stdin. Check `src/internal/run.ts` in task 5 and add an optional `input?: string` that is written to the child's stdin. This is a small additive change to a shared helper: add a unit test in `run.test.ts`. If you do not want to touch `run.ts`, use `child_process.spawn` inside `openclaw.adapter.ts` instead. Choose one and say which in the commit body.

#### 5d `docker/openclaw.compose.yml`

```yaml
# OpenClaw gateway (ADR 0007, D12, D17 to D19). Host networking on Linux, loopback bind. The config and the gateway
# token come through the adapter, and the state lives in a named volume the adapter wrote into. Nothing secret is here.
#
#   node scripts/up.mjs openclaw   (run `up litellm` first)
name: qa-harness-openclaw

services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503
    network_mode: host
    restart: "no"
    environment:
      OPENCLAW_CONFIG_PATH: /home/node/.openclaw/openclaw.json
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN:?set by the adapter}
    volumes:
      - qa-harness-openclaw-state:/home/node/.openclaw

volumes:
  qa-harness-openclaw-state:
    external: true
    name: qa-harness-openclaw-state
```

`external: true` makes compose require the volume to exist; the adapter creates it first (task 5c, step 1). Flag for the build spike: confirm compose accepts `external` with this name.

**Unit tests**

`src/adapters/openclaw-env.test.ts`:

```ts
describe("openclaw-env", () => {
  it("pins a dated release tag by digest, never main or latest", () => {
    assert.match(OPENCLAW_IMAGE, /@sha256:[0-9a-f]{64}$/);
    assert.doesNotThrow(() => assertOpenClawPinIsRelease(OPENCLAW_IMAGE));
    assert.throws(() => assertOpenClawPinIsRelease("ghcr.io/openclaw/openclaw:main-slim@sha256:" + "a".repeat(64)));
    assert.throws(() => assertOpenClawPinIsRelease("ghcr.io/openclaw/openclaw:latest@sha256:" + "a".repeat(64)));
  });
  it("sets local mode, loopback bind, token auth, approvals on and one LiteLLM provider with no channel", () => {
    const c = openClawConfig({ gatewayToken: "t", liteLlmBaseUrl: "http://127.0.0.1:4000", liteLlmKey: "k" }) as any;
    assert.equal(c.gateway.mode, "local"); assert.equal(c.gateway.bind, "loopback");
    assert.equal(c.gateway.auth.mode, "token"); assert.equal(c.tools.exec.ask, "always");
    assert.equal(c.approvals.exec.enabled, true);
    assert.equal(c.models.providers["p4-litellm"].baseUrl, "http://127.0.0.1:4000/v1");
    assert.deepEqual(c.channels, {});
  });
  it("puts the gateway token in the compose env and not in the base env", () => {
    const base = { PATH: "/usr/bin" };
    assert.equal(openClawComposeEnv(base, "tok").OPENCLAW_GATEWAY_TOKEN, "tok");
    assert.equal(base.OPENCLAW_GATEWAY_TOKEN, undefined);
  });
  it("generates a url-safe gateway token that differs per call", () => { /* base64url, length 32, differs */ });
});
```

`src/adapters/openclaw-seed.test.ts`:

```ts
describe("openclaw-seed", () => {
  it("writes the config into the named volume through a root helper, with the config on stdin", () => {
    const args = openClawWriteConfigArgs("img@sha256:" + "a".repeat(64), "vol");
    assert.ok(args.includes("--user") && args[args.indexOf("--user") + 1] === "0");
    assert.ok(args.includes("vol:/home/node/.openclaw"));
    assert.ok(args.some((a) => a.includes("chown -R 1000:1000")));
    assert.ok(!args.some((a) => a.includes("gatewayToken")));  // config is never an argument
  });
  it("reads /readyz only when ready is true", () => {
    assert.equal(readyzIsReady({ ready: true }), true);
    assert.equal(readyzIsReady({ ready: false }), false);
    assert.equal(readyzIsReady(null), false);
  });
});
```

**Commit:** `feat(adapters): add the openclaw gateway adapter`.

### Task 6: RAM probe, route stub and ordering (extend, never change the budget)

#### 6a `scripts/p4-route-stub.mjs` (TEMPORARY, removed in part B2)

```js
// TEMPORARY route listener for the B1 readiness proof only (ADR 0007). The suite's fixture server replaces it in part B2,
// and this file is deleted then. It answers an OpenAI chat-completion shape, names no model, and logs no request body.
import http from "node:http";

const port = Number(process.env.P4_STUB_PORT ?? 9911);
http
  .createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "p4-route-stub",
          object: "chat.completion",
          created: 0,
          model: "stub-upstream-model",
          choices: [{ index: 0, message: { role: "assistant", content: "stub-ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`TEMPORARY p4 route stub on 127.0.0.1:${port}`));
```

#### 6b `scripts/p4-ram-probe.sh` (additive edits)

Add after `cd "$repo"`:

```bash
# Agent hosts (ADR 0007). LiteLLM must start first: LibreChat and OpenClaw read its run state.
mode="${P4_LLM_MODE:-stub}"
if [ "${CI:-}" = "true" ] && [ "$mode" != "stub" ]; then
  echo "P4_LLM_MODE must be stub in CI (got a non-stub value). Refusing to run." >&2
  exit 2
fi
export P4_LLM_MODE="$mode"
out="${P4_RAM_OUT:-evidence/ram-probe.json}"
```

Then add this block right after `products=("$@")`. It needs `products` to be set first:

```bash
needs_litellm=0
for p in "${products[@]}"; do
  case "$p" in librechat|openclaw) needs_litellm=1 ;; esac
done
if [ "$needs_litellm" -eq 1 ]; then
  if [ "${products[0]}" != "litellm" ]; then
    echo "litellm must be the first product when librechat or openclaw is started (they read its run state)." >&2
    exit 2
  fi
fi
```

Then:

1. Start the temporary stub before the first `up`, only when `litellm` is in the list:

```bash
stub_pid=0
if printf '%s\n' "${products[@]}" | grep -qx litellm; then
  node scripts/p4-route-stub.mjs >/dev/null 2>&1 &
  stub_pid=$!
  sleep 1
fi
```

2. In `cleanup()`, after the `down` loop, add `if [ "$stub_pid" -ne 0 ]; then kill "$stub_pid" 2>/dev/null || true; fi`. Run `down` in **reverse** order: change `for p in "${products[@]}"` in `cleanup` to iterate the array backwards.

3. Replace the final write with `> "$out"`, and change the two later references from `evidence/ram-probe.json` to `"$out"`. Keep the exact budget check: `RAM_BUDGET_MIB` is unchanged (14336).

4. **Bind check, inside the probe and before `down`.** The probe's `cleanup` stops every container on exit, so a bind check in a later CI step would find nothing listening and pass for the wrong reason. Put it right after `ready_ms=...`:

```bash
ss -ltn > evidence/listen.txt
for port in 4000 3080 18789 27017 9911; do
  if grep -E "[ ]((0\.0\.0\.0|\*|\[::\]):)${port}[ ]" evidence/listen.txt; then
    echo "port ${port} is bound beyond loopback" >&2
    exit 1
  fi
done
```

The probe fails on a non-loopback bind. The workflow has no separate bind step.

**Unit tests**: none for the bash script. The CI job's output is the evidence. Add a `node --check scripts/p4-route-stub.mjs` step in the workflow, and a `bash -n scripts/p4-ram-probe.sh` step.

#### 6c `scripts/lib.mjs`

Already covered in task 1 step 8.

**Commit:** `chore(scripts): start the route stub and check agent host order in the ram probe`.

### Task 7: CI, sibling advisory workflow

File `.github/workflows/p4-agent-hosts.yml`:

```yaml
# P4 agent hosts (ADR 0007): LiteLLM, LibreChat and OpenClaw, in stub mode only. Starts each stack through the harness
# scripts, waits for readiness, measures memory, and uploads only the RAM report. Advisory, not a required check.
# No GEMINI_API_KEY and no Gemma call. The .harness/ folder (run-state credentials) is never uploaded.
name: P4 agent hosts

on:
  workflow_dispatch:
    inputs:
      run_full:
        description: "Also run the full set in one job (needs the disk; see plan section 10)."
        type: boolean
        default: false
  pull_request:
    paths:
      - "src/adapters/litellm*"
      - "src/adapters/librechat*"
      - "src/adapters/openclaw*"
      - "src/adapters/llm-run-state*"
      - "src/config.ts"
      - "src/types.ts"
      - "docker/litellm*"
      - "docker/librechat*"
      - "docker/openclaw*"
      - "scripts/p4-*"
      - "scripts/lib.mjs"
      - "docs/pins/p4.md"
      - ".github/workflows/p4-agent-hosts.yml"

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    shell: bash

jobs:
  agent-hosts:
    name: ${{ matrix.stack }}
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        include:
          - stack: stack-a
            products: "litellm librechat nextcloud outline"
            lib_mcp: "nextcloud,outline"
            clone_twenty: "0"
          - stack: stack-b
            products: "litellm librechat twenty penpot mattermost"
            lib_mcp: "twenty,penpot,mattermost"
            clone_twenty: "1"
          - stack: stack-oc
            products: "litellm openclaw"
            lib_mcp: ""
            clone_twenty: "0"
    env:
      P4_LLM_MODE: stub
      TWENTY_MCP: "1"
      LIBRECHAT_MCP_PRODUCTS: ${{ matrix.lib_mcp }}
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

      - name: Free runner disk space
        run: |
          set -euo pipefail
          sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc
          df -h /

      - name: Install harness, clone the Twenty fork when needed, build
        run: |
          set -euo pipefail
          npm ci
          if [ "${{ matrix.clone_twenty }}" = "1" ]; then HARNESS_PRODUCTS=twenty bash scripts/cloud-install.sh; fi
          npm run build

      - name: Check the stub script and the probe script
        run: |
          set -euo pipefail
          node --check scripts/p4-route-stub.mjs
          bash -n scripts/p4-ram-probe.sh

      - name: Start, wait for readiness, measure memory
        run: |
          set -euo pipefail
          P4_RAM_OUT="evidence/ram-probe-${{ matrix.stack }}.json" bash scripts/p4-ram-probe.sh ${{ matrix.products }}

      - name: Upload RAM evidence
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: ram-probe-${{ matrix.stack }}
          path: evidence/ram-probe-${{ matrix.stack }}.json
          if-no-files-found: warn
          retention-days: 30

      - name: No harness containers left
        if: always()
        run: |
          set -euo pipefail
          docker ps -a --filter name=qa-harness --format '{{.Names}}' | tee left.txt
          test ! -s left.txt
```

The optional full-set job is added only after the split runs measure disk and RAM (task 9). Do not add it in the first commit.

Notes: `${{ matrix.* }}` values are fixed strings in this file, not user input. actionlint in `ci.yml` lints this file. The three action SHAs are the ones `p4-adapters.yml` already pins.

**Commit:** `ci(p4): add the advisory agent hosts workflow`.

### Task 8: pins, ADR, docs

1. `docs/pins/p4.md`: add these rows to the pin table (pin text is the same as the constants):

| Product / role | Upstream · licence | Pin | Notes |
|---|---|---|---|
| LiteLLM | BerriAI/litellm · MIT (core package, image dist-info); `litellm_enterprise` licence UNVERIFIED | `ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3` | official image, no fork; latest stable at 2026-11-18 (`latest`, `main-stable`); `v1.111.0-rc.1` is a release candidate and is not used |
| LibreChat | danny-avila/LibreChat · MIT (`/app/LICENSE` in the image) | `ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9` | same digest as `ghcr.io/danny-avila/librechat:v0.8.7`; config version `1.3.13` |
| LibreChat database | mongo · SSPL (UNVERIFIED) | `mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd` | needs AVX |
| OpenClaw | openclaw/openclaw · MIT (image label) | `ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503` | calver release tag; GitHub release tag UNVERIFIED (API denied in session) |

2. Add a notes bullet: "**Agent hosts (ADR 0007):** the image licences above come from the images. Upstream GitHub release notes were not readable in the session (UNVERIFIED)."

3. ADR `docs/adr/0007-p4-agent-hosts.md`. Draft (content for the file; the build phase writes it):

```markdown
# 0007. Add LiteLLM, LibreChat and OpenClaw as image-only P4 agent hosts

- Status: Proposed (plan PR), then Accepted with the build
- Date: 2026-11-18

## Context

Part B of P4 Lane 1 needs three agent hosts that the suite can start like the Part A products: a chat host (LibreChat), a
personal agent (OpenClaw) and one OpenAI-compatible proxy (LiteLLM) that logs which model answered. ADR 0006 sets the
architecture (D1 productRoot, D7 run state, pins by digest). This ADR records the choices that are new: host networking,
the proxy's aliases and MCP use, the OpenClaw config path, and the disk plan.

## Decision

1. **Same architecture as ADR 0006.** Three adapters extend `BaseAdapter`. Pure helpers sit beside them, each with a test.
   `productRoot = .harness/<product>` (D11). `loadConfig()` is unchanged.
2. **Official images, pinned by digest, no fork.** LiteLLM `v1.110.0`, LibreChat `v0.8.7`, OpenClaw `2026.10.33-slim`,
   and `mongo:8` for LibreChat. Recorded in `docs/pins/p4.md`.
3. **Host networking on Linux (D12, non-standard).** The Part A products publish loopback-only ports. A container cannot
   reach them through `host.docker.internal`. *Alternative:* a user-defined network with service DNS, which needs each
   MCP container to join it. Not chosen now. Linux only; Docker Desktop is not supported for this stack.
4. **LiteLLM: two aliases, no fallbacks, stub by default (D13, D14).** The GEMINI key reaches the container only in nightly mode.
5. **LiteLLM MCP is not used (D15).** No documented key turns the `/mcp` route off; no server is granted; readiness asserts an
   empty tool list.
6. **LibreChat MCP through `librechat.yaml` with env placeholders (D16).** Config version `1.3.13`, `mcpSettings.allowedDomains`.
7. **OpenClaw config is written into its state volume (D17, non-standard).** *Alternative:* `${VAR}` substitution (UNVERIFIED).
8. **OpenClaw pinned to a calver release tag (D18); approvals on (D19); no channel in B1 (D20).**

## Alternatives considered

- LiteLLM `mock_response` on `p4-stub` instead of a stub URL. Rejected: the suite needs a real HTTP route to prove the wiring.
- LiteLLM virtual keys with a database. Rejected for B1: the master key is enough, and a database adds memory and a service.
- A user-defined network. Deferred (see 3).
- A Part A compose overlay change for MCP networking. Rejected: changes Part A files.

## Consequences

- Linux only for the agent hosts. macOS developers run the Part A products but not this stack until the alternative in 3 exists.
- Disk, not RAM, is the first limit (about 19 GB of images). The split in section 10 of the plan applies if CI cannot hold the full set.
- The temporary route stub is removed in part B2 with the suite's fixture server.
- Licences: LiteLLM core MIT; `litellm_enterprise` in the image is UNVERIFIED; LibreChat MIT; OpenClaw MIT; mongo SSPL (UNVERIFIED here).
- If the split is needed, it is recorded as `docs/adr/0008-p4-stack-split.md`. ADR 0006 names `0007` for that split;
  the reviewer decides whether ADR 0006 gets an addendum that points to 0008.
```

4. README section "Agent hosts (P4 part B1)": say the three products are Linux-only with host networking, stub mode is the default, nothing calls Gemma, and how to run `npm run up -- litellm`.

5. `.env.example`: add these lines (names and defaults only, no values for secrets):

```text
# --- P4 agent hosts (ADR 0007). Stub mode is the default. Nothing calls Gemma in B1. ---
# P4_LLM_MODE=stub
# P4_STUB_BASE_URL=http://127.0.0.1:9911/v1
# LITELLM_BASE_URL=http://127.0.0.1:4000
# LIBRECHAT_BASE_URL=http://127.0.0.1:3080
# LIBRECHAT_MCP_PRODUCTS=nextcloud,outline,twenty,penpot,mattermost
# OPENCLAW_BASE_URL=http://127.0.0.1:18789
# GEMINI_API_KEY is read only in nightly mode and is not set here.
```

6. `CHANGELOG.md`: under `## Unreleased`, one line: `- P4 agent hosts (LiteLLM, LibreChat, OpenClaw): harness adapters, pins and an advisory CI job (ADR 0007).`

**Commit:** `docs(p4): record the agent host pins and adr 0007`.

### Task 9: evidence and verification

1. Run `npm run check` locally. Paste the tail of the output into the PR body (real output only).
2. Run the advisory workflow with `workflow_dispatch` on the PR branch. Record each job's result, the `ram-probe-stack-*.json` numbers and the `df` lines in the PR body.
3. If all three split jobs are green and the measured RAM peak per stack is under the budget, decide with the reviewer whether to add the full-set job (`run_full`). Disk is the deciding number: the full set needs the disk free after the cleanup step.
4. Confirm no product fork changed: `git -C <fork> status --short` is empty for each fork that exists in `products/`.
5. Confirm `docker/twenty.compose.yml` is unchanged: `git diff main -- docker/twenty.compose.yml` is empty.

**Commit:** none (evidence goes in the PR body).

## 7 Pins: `docs/pins/p4.md` (rows added in task 8)

| Product / role | Pin | Source of the digest | Licence (source) | Release tag |
|---|---|---|---|---|
| LiteLLM | `v1.110.0@sha256:4295b064…` | `imagetools` on `ghcr.io/berriai/litellm:v1.110.0` (same digest as `docker.io/litellm/litellm:v1.110.0` and `latest`) | MIT (image: `litellm-1.110.0.dist-info/licenses/LICENSE`) | `v1.110.0` (Docker tag; GitHub release page UNVERIFIED) |
| LibreChat | `v0.8.7@sha256:c5db3331…` | `imagetools` on `ghcr.io/librechat-ai/librechat:v0.8.7`; `ghcr.io/danny-avila/librechat:v0.8.7` is the same digest | MIT (image: `/app/LICENSE`) | `v0.8.7` (Docker tag) |
| mongo | `mongo:8@sha256:05b334b0…` | `imagetools` on `mongo:8` | SSPL (UNVERIFIED here) | `8` |
| OpenClaw | `2026.10.33-slim@sha256:dcd5925b…` | `imagetools` on `ghcr.io/openclaw/openclaw:2026.10.33-slim`; `2026.10.33` and `extended-stable` are the same digest | MIT (image label and docs) | `2026.10.33` (calver; GitHub release tag UNVERIFIED) |

A unit test (`p4-pins.test.ts`) parses the three new compose files and fails when an image has no digest or when a digest is not in `docs/pins/p4.md`. The compose and the constants must match.

## 8 Readiness (every agent host waits for its own health, then its proof)

Order inside `up()`: compose `--wait` → app health → seed or config → proof. Budget: `P4_WAIT_MS` (default 600000, floor 120000, the Part A rule). Errors name the product and URL and never contain a key or a token.

| Product | App health (must pass) | Proof | Calls a model? |
|---|---|---|---|
| litellm | `GET /health/liveliness` → 200 | `GET /v1/models` (with the master key) returns **exactly** `p4-stub` and `p4-nightly` (`assertLiteLlmModels`) | No |
| litellm | (same) | One `POST /v1/chat/completions` with `model: p4-stub`, `max_tokens: 4`. Headers name the route: `x-litellm-model-group: p4-stub` and a non-empty `x-litellm-model-name` (`stubRouteFromHeaders`) | Stub only. The request is refused if it names `p4-nightly` (`assertNoNightlyCall`) |
| librechat | `GET /health` → 200 and `GET /api/config` → 200 | none in B1 | No |
| openclaw | `GET /healthz` → 200 and `GET /readyz` → body `ready: true` | none in B1 (authenticated call is B2) | No |

The MCP servers that LibreChat attaches are proved by **their own Part A adapters** (`waitMcp`), which `scripts/ready.mjs` already runs when the products are started. LibreChat's own MCP connection status is UNVERIFIED as a readiness signal (Q7).

## 9 Seed and run state

| Product | What is generated per run | Where it lives | Mode | Read by |
|---|---|---|---|---|
| litellm | master key `sk-p4-…` | `.harness/litellm/secrets.json` and `.harness/litellm-run.json` | 0600 | `readLlmRunState` (LibreChat, OpenClaw, readiness) |
| litellm | config (no secrets) | `.harness/litellm/config.yaml` | 0644 | container, read-only mount |
| librechat | Mongo password, JWT secrets, `CREDS_KEY`, `CREDS_IV` | `.harness/librechat/secrets.json` | 0600 | adapter |
| librechat | the compose env file (secret values) | `.harness/librechat/librechat.env` | 0600 | compose `env_file` |
| librechat | `librechat.yaml` (placeholders only) | `.harness/librechat/librechat.yaml` | 0644 | container, read-only mount |
| openclaw | gateway token | `.harness/openclaw/secrets.json` | 0600 | adapter |
| openclaw | `openclaw.json` (with token and LiteLLM key) | **inside the named volume `qa-harness-openclaw-state`** only (D17) | in the volume, owned by uid 1000 | container |

Rules: nothing prints a key, token or password (names and paths only); no secret goes in a committed file, a log or the uploaded evidence; `.harness/` is gitignored and never uploaded; the fake owner is `qa-owner@p4.test` (`.test` is reserved), created only when B2 needs a login.

## 10 Memory, disk and the split fallback

**RAM (measured in the probe, INFERRED for the sum).** About 2.58 GiB for the three agent hosts plus Mongo, added to Part A's measured 4901 MiB peak: about **7.5 GiB** against the 14336 MiB budget. The probe measures the per-instant sum in CI, so this number is checked there.

**Disk (INFERRED, the binding constraint).** Images: LiteLLM 1.9 GB, LibreChat 3.83 GB, Mongo 1.16 GB, OpenClaw slim 2.98 GB (about 9.9 GB), plus Part A's estimated 9 GB: about **19 GB**. A public runner has about 14 GB free after the cleanup step (INFERRED). **The full set probably does not fit on disk in one job.**

**Recommendation.** Start CI with the **split**, three jobs in the workflow's matrix:

- **Stack A:** `litellm librechat nextcloud outline`
- **Stack B:** `litellm librechat twenty penpot mattermost`
- **Stack OC:** `litellm openclaw`

Each job starts its own subset through the same harness scripts, writes `evidence/ram-probe-<stack>.json`, and checks the budget. LibreChat appears in A and B, so the two jobs run in separate runners and never share ports. Within one job, `litellm` starts first (`p4-ram-probe.sh` enforces this).

**Full set.** Attempted only as a `workflow_dispatch` job (`run_full`) after the split is green, and only if `df` after the cleanup step leaves room. Record the result either way.

**If a split is needed, the record is `docs/adr/0008-p4-stack-split.md`** (ADR 0006 names 0007 for it; the reviewer decides on an addendum). The split needs no adapter change: every product has its own compose project, ports and run state.

## 11 Commands and expected output (for the build phase)

Expected output **shapes** are shown. Numbers are placeholders (`<n>`) and come from the build run. Nothing here is a measured value.

```bash
# 0. Once per session: Node from .nvmrc, dependencies, build
npm ci
npm run build

# 1. The full check (before every push)
npm run check
# expected end: typecheck clean, "# pass <n>" and "# fail 0" from node --test, then the build with no errors

# 2. Start the three hosts through the harness (LiteLLM first)
npm run up -- litellm
# expected: "LiteLLM route: p4-stub answered via openai/stub-upstream-model" and "LiteLLM is up: http://127.0.0.1:4000 ..."
npm run up -- librechat
# expected: "LibreChat is up: http://127.0.0.1:3080. MCP servers in librechat.yaml: nextcloud, outline ..."
npm run up -- openclaw
# expected: "OpenClaw is up: http://127.0.0.1:18789. The gateway token is in .../secrets.json (mode 0600) ..."

# 3. Readiness (app health and each product's MCP proof, where it has one)
node scripts/ready.mjs litellm librechat openclaw
# expected: "ready litellm ..." / "ready librechat ..." / "ready openclaw ..." lines, exit 0

# 4. RAM probe for one stack (LiteLLM first; the probe stops and cleans up). LibreChat's MCP list must match the stack.
LIBRECHAT_MCP_PRODUCTS=nextcloud,outline P4_RAM_OUT=evidence/ram-probe-stack-a.json bash scripts/p4-ram-probe.sh litellm librechat nextcloud outline
# expected: the JSON report on stdout, and "RAM probe fits the budget." with exit 0

# 5. Shut down (LibreChat and OpenClaw before LiteLLM) and confirm nothing is left
npm run down -- openclaw
npm run down -- librechat
npm run down -- litellm
docker ps -a --filter name=qa-harness --format '{{.Names}}'
# expected: no output
```

**Manual checks in the build, with commands:**

```bash
# Only loopback binds (no 0.0.0.0, no [::])
ss -ltn | grep -E ':(4000|3080|18789|27017|9911)\s'
# Config has exactly two aliases, and no fallback text (from the generated file, not the network)
grep -c 'model_name:' .harness/litellm/config.yaml          # expected: 2
grep -ci fallback .harness/litellm/config.yaml               # expected: 0
# No Gemma call and no Google host in the proxy log
docker logs qa-harness-litellm-litellm-1 2>&1 | grep -ci 'generativelanguage\|gemma'   # expected: 0
# Run-state and secret files are mode 0600 and not in git
stat -c '%a %n' .harness/*/secrets.json .harness/*/librechat.env .harness/litellm-run.json   # expected: 600 each
git status --short                                           # expected: no .harness/ entries
```

## 12 ADR draft

The ADR text is in section 6, task 8, step 3. The build writes it to `docs/adr/0007-p4-agent-hosts.md`.

## 13 Environment notes (for Cursor cloud and Claude Code cloud)

**Automatic from the repo:** Node from `.nvmrc`; `npm ci`; the compose files; per-run secret generation; `P4_LLM_MODE` defaults to `stub`; `LITELLM_MASTER_KEY` is generated per run and kept in `.harness/` (never a long-lived value).

**Paste by hand, once:**

- **Cursor cloud:** set environment variable `P4_LLM_MODE=stub` (visible is fine). If the session must pull images, allow the Docker registries (`docker.io`, `registry-1.docker.io`, `auth.docker.io`, `index.docker.io`, `production.cloudflare.docker.com` for Docker Hub blobs, `ghcr.io` and `pkg-containers.githubusercontent.com` for GHCR blobs). Record any others the pulls need. Do **not** allowlist `generativelanguage.googleapis.com`. Do **not** set `GEMINI_API_KEY`. The LiteLLM cost-map host (`raw.githubusercontent.com`) is not needed: the build sets `LITELLM_LOCAL_MODEL_COST_MAP=True` (UNVERIFIED that it removes the fetch; the spike checks).
- **Claude Code cloud:** the same `P4_LLM_MODE=stub` in the environment's `.env`, the same registry list, no `GEMINI_API_KEY`, no Gemini host. Docker is present (VERIFIED in this session). Pre-pull the pinned digests in the setup script so runs stay inside the timeout: `ghcr.io/berriai/litellm:v1.110.0@sha256:4295…`, `ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db…`, `mongo:8@sha256:05b334…`, `ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5…`.
- **If Docker is missing in Cursor cloud:** say so in the session. The agent only edits code and runs `npm run check` (unit tests and build). GitHub Actions runs the stack.

**Not in the repo, not stored:** no key, no token, no `.env` written by the harness.

## 14 Acceptance criteria for the build

1. `npm run check` passes. New unit tests cover: env building and mode parsing (`litellm-env.test.ts`), the two-alias config with no fallbacks (`litellm-env.test.ts`), readiness parsing and the no-Gemma guard (`litellm-seed.test.ts`), LibreChat yaml and placeholders (`librechat-env.test.ts`), LibreChat seed and MCP env (`librechat-seed.test.ts`), OpenClaw config and pin (`openclaw-env.test.ts`, `openclaw-seed.test.ts`), run state (`llm-run-state.test.ts`), and the regression that `loadConfig()` still lists only the four fork products (`config-p4.test.ts`).
2. Advisory CI `P4 agent hosts`: each split job reports `ready` for its products, the probe JSON is uploaded with real numbers and `fit: true`, and the bind check passes. If the full set is attempted, its result is recorded either way.
3. Existing products unchanged: all existing tests pass; no default changes; `docker/twenty.compose.yml` untouched; `loadConfig()` returns the same four products.
4. No product fork edited. No secret printed (the CI log grep for generated values finds nothing). No Gemma call (the proxy log has no `generativelanguage` or `gemma` line).
5. `docker ps -a --filter name=qa-harness` is empty after every run.
6. Only `docs/plans/2026-11-18-harness-p4-agent-hosts.md` is in the plan PR. The build PR adds the rest, one commit per task.

## 15 Risks and open questions

| # | Item | Label |
|---|---|---|
| R1 | Upstream GitHub release notes, repo metadata and licences were not readable (GitHub API denied for this session's repo scope). Licences come from the images. | UNVERIFIED |
| R2 | LiteLLM `/mcp` cannot be turned off by any documented key. Mitigated by no grants and an empty-tools assertion. | UNVERIFIED (docs only) |
| R3 | `LITELLM_LOCAL_MODEL_COST_MAP=True` stops the GitHub fetch at boot. | UNVERIFIED at run time (env name VERIFIED in source) |
| R4 | LiteLLM `--host 127.0.0.1` flag name and bind, and that nothing binds `0.0.0.0`. | UNVERIFIED (`ss` check in CI) |
| R5 | Disk: about 19 GB of images against about 14 GB free on a public runner (the cleanup step frees more; amount unknown). | INFERRED |
| R6 | RAM: about 7.5 GiB combined (sum of separate peaks). | INFERRED |
| R7 | LibreChat `${VAR}` substitution in `mcpServers.headers` and `endpoints.custom.apiKey` at run time. | UNVERIFIED (docs say yes) |
| R8 | LibreChat's own MCP connection status is not a readiness signal yet. | UNVERIFIED |
| R9 | LibreChat owner creation command (`create-user`) inside the container. | UNVERIFIED (B2 spike) |
| R10 | OpenClaw approval behaviour at run time (`tools.exec.ask: "always"`, `approvals.exec.enabled`). Keys and enums VERIFIED in the schema. | UNVERIFIED (runtime) |
| R11 | OpenClaw calls LiteLLM through `models.providers.p4-litellm`. Not exercised. | UNVERIFIED |
| R12 | OpenClaw `${VAR}` in `gateway.auth.token` and `apiKey`. The B1 design writes the literal values into the volume (D17). | UNVERIFIED (switch if substitution works) |
| R13 | Whether a `mock` channel is needed in B1. None exists by name. `channels.qa-channel` is a candidate with a `baseUrl` and no description. | UNVERIFIED (Q3) |
| R14 | OpenClaw extra listeners beyond the gateway port (browser, canvas, dev profile ports). `ss` check in CI. | UNVERIFIED |
| R15 | mongo 8 needs AVX on the runner CPU. GitHub's `ubuntu-latest` runners support it (INFERRED). | INFERRED |
| R16 | `litellm_enterprise` and `litellm_admin_mcp` packages in the image: licence and whether they run by default. | UNVERIFIED |
| R17 | Host networking is Linux-only. macOS developers cannot run this stack until D12's alternative exists. | VERIFIED (Docker Desktop limitation, by design) |
| R18 | Container env is visible in `docker inspect`. Acceptable on a throwaway loopback stack (as ADR 0006 R14). | VERIFIED by design |
| R19 | Part A ports do not clash with 4000, 3080, 18789, 27017, 9911 (the list in D23). | VERIFIED against the Part A compose files |

**Questions for the reviewer**

- **Q1 Host networking (D12).** Accept host networking on Linux for B1 (non-standard, flagged), with the user-defined network as the recorded alternative in ADR 0007? Or require the network alternative now (it means editing the Part A MCP compose files)?
- **Q2 Disk and split.** Start CI with the three-job split (A, B, OC) and try the full set only after it is measured? Or require the full set in one job?
- **Q3 Mock WhatsApp channel.** The pin has `channels.whatsapp` but no mock by name. Candidate: `channels.qa-channel` (undocumented). Approve B1 with **no channel**, and decide in B2 after reading its source? Or do you want a specific mock?
- **Q4 LiteLLM MCP.** Accept "no grants + empty tool list + loopback" as the mitigation, since no documented key disables `/mcp`?
- **Q5 OpenClaw config in the volume (D17).** Accept the root helper container that writes the config into the named volume, instead of `${VAR}` substitution (unverified)?
- **Q6 LibreChat login.** B1 creates no user and proves no login. Is that fine, with the owner creation decided in B2 (`qa-owner@p4.test`)?
- **Q7 LibreChat MCP readiness.** Accept that B1 proves each MCP through its Part A adapter and only proves LibreChat's health and config, not its MCP connection?
- **Q8 ADR number.** This ADR is `0007`. A split would be `0008` (ADR 0006 names 0007 for the split). OK to add an addendum to ADR 0006 that says so?
- **Q9 Temporary route stub.** Approve `scripts/p4-route-stub.mjs` as clearly temporary, deleted in B2 when the suite's fixture server exists?
- **Q10 Licences.** `litellm_enterprise` (in the image) and the mongo SSPL licence are UNVERIFIED. Is an image-level licence read required before the build, or only the upstream check the owner does?

## 16 Commit plan and what will not be done

**After approval**, on `feat/2026-11-18-harness-p4-agent-hosts`, one commit per task. Lowercase Conventional Commits, `git add` by explicit path, no `-A`, no trailers, no `Co-authored-by`, no "Generated by" footers, no force-push, no rebase, no amend. Each commit runs `npm run check` first.

1. `docs(plan): harness p4 agent hosts` (this file, the only commit in the plan PR; the PR stays a **draft**)
2. `feat(config): add the litellm, librechat and openclaw ids` (task 1)
3. `feat(adapters): add the llm run-state helper` (task 2)
4. `feat(adapters): add the litellm proxy adapter` (task 3)
5. `feat(adapters): add the librechat adapter` (task 4)
6. `feat(adapters): add the openclaw gateway adapter` (task 5)
7. `chore(scripts): start the route stub and check agent host order in the ram probe` (task 6)
8. `ci(p4): add the advisory agent hosts workflow` (task 7)
9. `docs(p4): record the agent host pins and adr 0007` (task 8)
10. Evidence in the PR body only (task 9)

**Will not do:** edit any product fork (including the reference forks `Jayami123/openclaw` and `Jayami123/LibreChat`); change `docker/twenty.compose.yml`, any Part A compose file or any Part A default; touch the Cal, Documenso, Medusa or Twenty adapters; write a `.env` for a product; call Gemma or set `GEMINI_API_KEY`; add the Gemini host to any allowlist; invent L1 case IDs or close any suite case; add the suite's fixture server to this repo; run CodeRabbit; use the Bridge-bss account; merge, tag, squash, rebase or force-push; write a personal name in any file, commit or PR.
