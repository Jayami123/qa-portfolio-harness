# OpenClaw start-up timing

- Branch: `chore/2026-11-22-openclaw-startup-timing`, from `origin/main` at `b33edbf`. One draft PR. The owner waived a separate plan PR, so this plan is the first commit of that PR and the findings follow in later commits.
- Question: where the roughly 6 minutes of OpenClaw start-up in the suite's L4 gate job go. The suite reports a stack start of 8m29s, against a 20-minute gate target.
- Fix only what the evidence shows the harness controls. If the time is OpenClaw's own work, make no code change and record the breakdown as the known floor.

## Evidence this plan uses

1. **A real run in this repository.** The `P4 agent hosts` workflow (`.github/workflows/p4-agent-hosts.yml:146`) starts `litellm nextcloud outline twenty penpot mattermost librechat openclaw` one after another through `scripts/p4-ram-probe.sh`. OpenClaw starts last, with default options (no channel mock). The latest completed run at planning time is `44986901129` (run 72, head `ed134a9`, success). Its job log supplies the timestamps.
2. **The pinned image.** Its healthcheck, its entrypoint, and its readiness code come from `ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b…cf503`. They are read with `docker inspect`, `docker create` and `docker cp`. The container is never started.
3. **The harness code.** The adapter, the compose wrapper, the budget constants and the compose file, cited by file and line.

## Not available to this session

The suite's `l4 openclaw stub` job logs and its PR run id are in `Jayami123/ai-agent-mcp-eval-suite`. That repository is outside this session's repository scope, so they are not read here. The suite's 6-minute figure stays unverified in this PR. The harness-side numbers below are a proxy for it, not a substitute.

## Phases to split

| Phase | Source of the boundary |
| --- | --- |
| Image pull | Not logged by compose. Happens inside the one-off config write (`writeConfigInVolume`), inferred from the timestamps. Measured separately as a cold pull on this container. |
| Config write and volume create | `src/adapters/openclaw.adapter.ts:226-234` |
| Container create and start | Compose log lines `Container … Created` and `Started` |
| Docker healthcheck | Image config, `Test`, `Interval`, `StartPeriod`, `Retries`. The compose file sets no healthcheck of its own (`docker/openclaw.compose.yml:8-23`). |
| First `/healthz` 200 and `/readyz` 200 | `waitHealthy`, `src/adapters/openclaw.adapter.ts:257-278` |
| Work after readiness | `up()` ends with one log line (`openclaw.adapter.ts:237-239`). No seeding or channel setup runs in the default path. |

## Harness-owned waits and budgets (cited)

- `up()` runs `composeUp(…, { wait: true })` (`openclaw.adapter.ts:235`). That call is `docker compose up -d --wait` with no timeout (`src/internal/compose.ts:22-38`). Docker's own healthcheck retries bound it.
- `waitHealthy` default budget is `p4WaitBudgetMs()`, which is 10 minutes (`src/adapters/p4-wait.ts:2`, `:7-14`). Its poll interval is 2 s (`openclaw.adapter.ts:275`). Each probe has a 5 s timeout (`openclaw.adapter.ts:262`, `:264`).
- No `start_period` is set by the harness for OpenClaw. The image sets `StartPeriod` 15 s, `Interval` 180 s, `Timeout` 10 s and `Retries` 3.
- `OPENCLAW_CHANNEL_MOCK=1` adds a Telegram channel (`src/adapters/openclaw-env.ts:53`, `:198`). That path is not in the default CI run, so it is out of this measurement.

## What `/readyz` waits on (pinned image)

From `dist/worker/gateway-prewarm.js`, the readiness checker in the pinned image, in order:

1. Startup not pending. Pending reasons include `startup-sidecars` (for example around lines 5593, 5923, 8908).
2. The state database is not failing.
3. No agent database is pending.
4. No plugin reload is running.
5. Channel accounts are healthy, with a connect grace period. If `shouldSkipChannelReadiness` is set, this step is skipped.

The result is cached for 1 s (`DEFAULT_READINESS_CACHE_TTL_MS = 1e3`, line 5583). `/healthz` is the `live` probe class and `/readyz` the `ready` class (`dist/gateway-http-route-contracts-*.mjs`, lines 4-6). The image's own healthcheck calls `/healthz` on the gateway port (`dist/docker-healthcheck.js`).

## Decision rule

- A harness-owned wait longer than it needs to be: fix it the standard way, and show before and after CI timings.
- Time spent in OpenClaw's own boot: no code change. Record the breakdown in the docs as the known floor.
- No sleeps, no shortened budgets without a cited basis, and no retries that hide slowness.

## Deliverables

- This plan (commit 1).
- A results section with the timing table, the decision and the CI run ids (commit 2).
- No version bump and no CHANGELOG entry, unless the decision changes code.
