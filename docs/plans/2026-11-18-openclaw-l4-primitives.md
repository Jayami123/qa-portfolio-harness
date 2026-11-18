# Harness v0.6.4: OpenClaw L4 primitives (H1 to H6)

- Branch: `feat/2026-11-18-openclaw-l4-primitives`, from `main` at `4650a17` (merge of #65). One release, `v0.6.4`. This file and the code are in one draft PR.
- Source: the suite's L4 plan, section 8 ("Harness repository"), table H1 to H6. That file is **not on the suite's `main`** (`docs/plans/` there holds only the L1 and L2 plans). It is on the suite branch `docs/2026-11-18-l4-openclaw-plan` (head `378794108756d9dfe98e61990a3c422490533916`), and that is what was read.
- Rules kept: every option is off by default and an unset option leaves the written config byte-identical to 0.6.3; the `tools.exec` object (`ask: "always"`, `security: "allowlist"`) is never touched; no product fork is edited; no secret is printed or stored in a file other than the existing 0600 `secrets.json` and env file.

## How the docs were obtained

Same method as #65: the docs were copied out of the pinned image by digest, not read from the web.

```bash
IMG="ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503"
docker pull "$IMG"
CID=$(docker create "$IMG")
docker cp "$CID":/app/docs ./openclaw-docs     # image path /app/docs
docker rm "$CID"
```

Quotes below are verbatim from `/app/docs/<path>` in that image. They are labelled VERIFIED (a quote from the pinned docs) or UNVERIFIED (not shown by the docs; a live run decides).

## Config keys and their pinned-docs quotes

| Key written | Pinned doc and quote |
|---|---|
| `channels.telegram.botToken` | `gateway/config-channels/personal-messaging.md`: "Bot token: `channels.telegram.botToken` or `channels.telegram.tokenFile` (regular file only; symlinks rejected), with `TELEGRAM_BOT_TOKEN` as fallback for the default account." |
| `channels.telegram.apiRoot` | same file: "`apiRoot` is the Telegram Bot API root only. Use `https://api.telegram.org` or your self-hosted/proxy root, not `https://api.telegram.org/bot<TOKEN>`". `channels/telegram.md`: "custom API root: `apiRoot` (Bot API root only; do not include `/bot<TOKEN>`)". |
| `channels.telegram.dmPolicy` | `channels/telegram/access-control.md`: "`channels.telegram.dmPolicy` controls direct message access: `pairing` (default), `allowlist` (requires at least one sender ID in `allowFrom`), `open` (requires `allowFrom` to include `"*"`), `disabled`". |
| `channels.telegram.allowFrom` | same file: "`channels.telegram.allowFrom` accepts numeric Telegram user IDs. `telegram:` / `tg:` prefixes are accepted and normalized." |
| `channels.telegram.groups`, `groupPolicy` | same file: "`groups` configured: acts as an allowlist (explicit IDs or `"*"`)"; "`open` / `allowlist` (default) / `disabled`". |
| `channels.telegram.groupAllowFrom` | same file: "`groupAllowFrom` entries should be numeric Telegram user IDs ... Do not put group or supergroup chat IDs here — negative chat IDs belong under `channels.telegram.groups`." and "Common mistake: `groupAllowFrom` is not a group allowlist." |
| `commands.ownerAllowFrom` | `gateway/config-channels/commands.md`: "`ownerAllowFrom` is the explicit owner allowlist for owner-only commands and owner-gated channel actions. It is separate from `allowFrom`." `channels/telegram/access-control.md`: "For owner-only commands, make sure `commands.ownerAllowFrom` contains `telegram:<your user id>`." |
| `tools.loopDetection.enabled` | `tools/loop-detection.md`: "Loop detection (`enabled`) - disabled by default." and the field table "`enabled` | `false` | Master switch for the rolling-history detectors." |
| `tools.web.fetch.ssrfPolicy.allowedHostnames` | `tools/web-fetch.md`: "`tools.web.fetch.ssrfPolicy.allowedHostnames` allows exact trusted hosts while leaving other private/internal targets blocked". |
| `tools.web.fetch.ssrfPolicy.dangerouslyAllowPrivateNetwork` | same file: "`tools.web.fetch.ssrfPolicy.dangerouslyAllowPrivateNetwork` broadly permits private-network targets; enable it only when model-selected URLs are trusted in this deployment". `gateway/config-tools/built-in-tools.md`: `dangerouslyAllowPrivateNetwork: false, // broad private-network opt-in; keep false by default`. |
| `agents.defaults.workspace` (path used by H2) | `concepts/agent-workspace.md`: "Default: `~/.openclaw/workspace`". |
| Skill location (H2) | `tools/skills.md`: "`<workspace>/skills/research/SKILL.md          ✓ found as "research"`". |
| Memory files (H2) | `concepts/memory.md`: "**`MEMORY.md`** — long-term memory." and "**`memory/YYYY-MM-DD.md`** (or `memory/YYYY-MM-DD-<slug>.md`) — daily notes." |
| Approvals store and CLI (H3) | `tools/exec-approvals.md`: "`$OPENCLAW_STATE_DIR/state/openclaw.sqlite#exec_approvals_config`". `cli/approvals.md`: "`openclaw approvals get`", "`openclaw approvals pending --json`", "`openclaw approvals get --json`" (named in "inspect `openclaw approvals get --json` before retrying"). |
| Cron seed (H2) | `automation/cron-jobs/managing-jobs.md`: `openclaw automations create "0 7 * * *" "Summarize overnight updates." --name "Morning brief" ... --session isolated`. |
| Primary model (H5) | `agents.defaults.model.primary` is already written by 0.6.3 (see `openclaw-env.ts`). The LiteLLM alias `p4-nightly` exists since 0.5 (`litellm-env.ts`). |

## H1: mock Telegram channel config

- **Files:** `src/adapters/openclaw-env.ts` (`openClawConfig`, constants, env text), `src/adapters/openclaw.adapter.ts` (token), `src/config.ts` (parse), `.env.example`, `README.md`.
- **Option:** `OPENCLAW_CHANNEL_MOCK=1` (exact `"1"`; anything else throws `OPENCLAW_CHANNEL_MOCK_INVALID` without echoing the value).
- **Effect:** `channels.telegram` = `{ enabled: true, botToken: "${OPENCLAW_MOCK_TELEGRAM_TOKEN}", apiRoot: "http://p4-mock-channel:8788", dmPolicy: "pairing", allowFrom: ["1001"], groupPolicy: "allowlist", groupAllowFrom: ["1001"], groups: { "-100777": {} } }` and `commands.ownerAllowFrom: ["telegram:1001"]`. The token is a per-run value kept in `secrets.json` (0600) and written to the env file only when the option is on; the config holds the `${...}` placeholder only. `OPENCLAW_ENV_NAMES` is unchanged; the extra name is a separate constant.
- **Unit tests** (`openclaw-env.test.ts`, `config-p4.test.ts`): default config has `channels: {}` and no `commands`; option on writes the keys above, no token value, `groupAllowFrom` has no negative id, groups key is the negative chat id; token generator shape; env text has the extra name only when on; flag parsing.
- **Off by default:** flag unset gives `channels: {}` and the config object is deep-equal to 0.6.3's.
- **UNVERIFIED:** that the slim image's Telegram plugin starts against a plain-HTTP `apiRoot` on a private host, and which Bot API methods it calls. That is the suite's spike S2.

## H2: seed primitive (workspace files, skills, memory, cron)

- **Files:** `src/adapters/openclaw-seed.ts` (pure builders and path validation), `src/adapters/openclaw.adapter.ts` (methods `seedWorkspaceFile`, `seedMemory`, `seedSkill`, `seedCron`).
- **Option:** none. These are methods; nothing calls them unless a test does. No config change.
- **Effect:** files are written into the state volume by a one-off container (`--network none`, `--user 1000:1000`, content on stdin), the same pattern as the config write. Targets: `workspace/<rel>`, `workspace/MEMORY.md` or `workspace/memory/<name>.md`, `workspace/skills/<name>/SKILL.md`. Cron runs `openclaw automations create ...` inside the running container with `docker compose exec`.
- **Path rules:** relative only; no `..`, no empty segment, no NUL, no leading `/`, a length cap, and a name check for skills and memory files.
- **Unit tests:** argv builders (no network, uid 1000, volume mount, path under workspace), path rejection table, cron argv (no shell string, arguments passed as separate argv entries).
- **UNVERIFIED:** the live write of a skill is picked up without a restart; the `automations create` flags are from the docs example only.

## H3: approvals read primitive

- **Files:** `openclaw-seed.ts` (argv builders, parsers), `openclaw.adapter.ts` (`readApprovals`, `readPendingApprovals`).
- **Option:** none (read-only methods).
- **Effect:** runs `openclaw approvals get --json` and `openclaw approvals pending --json` in the running container (`docker compose exec -T`), parses the JSON, and **drops the `socket` object** (it holds a token) before returning. Non-JSON output throws `OPENCLAW_APPROVALS_UNPARSEABLE` and prints no part of the output.
- **Unit tests:** parser strips `socket.token`; accepts a bare array or `{ approvals: [...] }` for pending; rejects non-JSON and non-object without echoing text.
- **UNVERIFIED:** the exact JSON shape of `approvals pending --json` (the docs name the flag, not the shape).

## H4: config knobs

- **Files:** `openclaw-env.ts`, `config.ts`, `.env.example`, `README.md`.
- **Options:** `OPENCLAW_LOOP_DETECTION=1` writes `tools.loopDetection: { enabled: true }`. `OPENCLAW_WEB_FETCH_ALLOWED_HOSTS=a,b` writes `tools.web.fetch.ssrfPolicy.allowedHostnames` (the narrow opt-in, exact hosts). `OPENCLAW_WEB_FETCH_PRIVATE_NETWORK=1` writes `dangerouslyAllowPrivateNetwork: true` (the broad one; named as such in the docs).
- **Unit tests:** each option alone writes only its key; default has none of them; `tools.exec` deep-equals `{ ask: "always", security: "allowlist" }` for every combination of options; host list validation (exact hostnames only, no scheme, port, path or wildcard).
- **Off by default:** all three unset leaves `tools` as in 0.6.3.
- **Not built:** `tools.exec.security` and `askFallback`. See Findings F2 and F3.

## H5: primary model by mode

- **Files:** `openclaw-env.ts`, `config.ts`.
- **Option:** `OPENCLAW_NIGHTLY_MODEL=1` (exact `"1"`). With `P4_LLM_MODE=nightly` it sets `agents.defaults.model.primary` to `p4-litellm/p4-nightly` and adds `p4-nightly` to the provider's model list. With `P4_LLM_MODE=stub` it throws `OPENCLAW_NIGHTLY_MODEL_NEEDS_NIGHTLY` (same stance as LibreChat's `LIBRECHAT_MODEL_NOT_ALLOWED`), so a stub run can never be pointed at Gemma by accident. OpenClaw still talks to LiteLLM only; it never gets the Gemini key.
- **Unit tests:** default primary stays `p4-litellm/p4-stub` in both modes; flag plus nightly gives `p4-nightly`; flag plus stub throws; flag parsing.
- **Off by default:** flag unset, config unchanged in both modes.

## H6: restart primitive

- **Files:** `openclaw.adapter.ts` (`restart()`), `src/internal/compose.ts` (`composeRestartArgs`, `composeExecArgs`).
- **Option:** none (method). Runs `docker compose restart openclaw`, then waits for `/healthz` and `/readyz`. It keeps the volume, the env file and the config as they are, so it does not rewrite config and cannot change any option. It is not a start or stop of the product by a test: it is a harness method, and `up`/`down` stay the only start and stop commands.
- **Unit tests:** argv builders for restart and exec (project name, files, service, `-T`, argv passthrough with no shell).
- **UNVERIFIED:** live restart time against the readiness budget.

## Order of work and release

1. This plan (first commit, docs only).
2. `feat:` commits, one per change (H1, H4, H5 in config; H2 and H3 in seed; H6 in compose and adapter), each with its unit tests.
3. `docs:` README and `.env.example`; `chore: release 0.6.4` (CHANGELOG `[0.6.4]`, `package.json`, `package-lock.json`).
4. `npm run check`, push, one draft PR with the plan and the code. No merge, no tag.

## Findings

- **F1. The L4 plan is not on the suite's `main`.** The task named `docs/plans/2026-11-18-l4-openclaw.md` on `main`. It is not there; it is on the branch `docs/2026-11-18-l4-openclaw-plan`. Read from that branch. If the plan changes on a later merge, H1 to H6 should be rechecked against it.
- **F2. `tools.exec.security` is not built.** The task says to keep the `tools.exec` ask/allowlist lock untouched. A config knob for `tools.exec.security` is exactly a change to that object, so it is skipped. The suite's `security: deny` variant of `P4-OC-APPR-007` can still be reached per turn: the docs say "Send `/exec security=deny` ... `security` and `ask` apply to the **current message only**" (`tools/exec.md`), and "per-turn `/exec` overrides can only tighten" a session's policy. That is a suite-side choice, not a harness change.
- **F3. `askFallback` is not built, and not needed.** It is not an `openclaw.json` key. It is a field of the host approvals document (`exec-approvals.json`, stored in `state/openclaw.sqlite#exec_approvals_config`): "`askFallback` ... Defaults to `deny` when omitted" (`tools/exec-approvals.md`). The harness does not set it, so the default already is `deny`, which is what the unattended variant of APPR-007 needs. Setting a different value would mean editing that store through `openclaw exec-policy set`, which also carries `--security` and `--ask`, so it would reach into the lock. Skipped for that reason.
- **F4. Nothing here was run against a live gateway.** No `up`, no channel start, no restart. Unit tests only, plus the docs quotes above. The UNVERIFIED lines under each item are what a live run must settle.
