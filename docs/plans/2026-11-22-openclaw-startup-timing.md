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

## Results

Source: run `44986901129` (run 72, head `ed134a9`, job `137099341656`, success). Step `Start, wait for readiness, check binds, measure memory and disk` ran 04:53:52 to 05:04:40, which is 10m48s. OpenClaw is the last product in that sequence. `up.mjs openclaw` started at 05:03:13.31, after LibreChat was healthy at 05:03:06.75.

| Phase | Start | End | Duration | Source |
| --- | --- | --- | --- | --- |
| `up.mjs openclaw` (whole `up()`) | 05:03:13.31 | 05:03:59.71 | **46.4 s** | job log |
| Volume create, then one-off config write (includes the image pull, inferred) | 05:03:13.31 | 05:03:38.77 | 25.5 s | job log; `openclaw.adapter.ts:226-234` |
| Compose network and container create | 05:03:38.77 | 05:03:39.01 | 0.2 s | job log |
| Container started, then Docker reports Healthy | 05:03:39.01 | 05:03:57.51 | 18.5 s | job log; image healthcheck |
| `waitHealthy`: `/healthz` 200, then `/readyz` ready | 05:03:57.51 | 05:03:59.71 | 2.2 s | `openclaw.adapter.ts:257-278` |

Cold pull of the pinned image on the CI-equivalent container here, with a `docker pull`: 30.4 s. This is a different network, so it is only indicative. Compose logged no `Pulling` line for OpenClaw, so the image was local before compose ran. The pull therefore sits inside the one-off config write.

Harness-side waits and budgets:

- Compose healthcheck: the compose file sets none (`docker/openclaw.compose.yml:8-23`). The image sets `Test` `node dist/docker-healthcheck.js`, `Interval` 180 s, `Timeout` 10 s, `StartPeriod` 15 s and `Retries` 3. The container was Healthy 18.5 s after start, a few seconds past the 15 s start period. The 180 s interval did not gate it: the check passed soon after the gateway answered `/healthz`. Docker's exact probe schedule during the start period is inferred from this timing, not read from Docker's source.
- `composeUp --wait` has no timeout set by the harness (`src/internal/compose.ts:22-38`). Only Docker's healthcheck retries bound it. The 10-minute `P4_WAIT_MS` budget starts only after compose returns.
- `waitHealthy` polls every 2 s (`openclaw.adapter.ts:275`) with 5 s per request (`:262`, `:264`). It returned 2.2 s after Healthy. The 2 s interval is the floor of that wait.
- The default budget is 10 minutes (`src/adapters/p4-wait.ts:2`). It was not reached.

Post-readiness work: the adapter's `up()` only logs one line (`openclaw.adapter.ts:237-239`). In the default path nothing is seeded and no channel is set up. The probe's own check at 05:04:00.83 read `ready openclaw health=ok … in 15 ms`. That is a check, not start-up.

What `/readyz` waits on in the pinned image: described in the plan section above. In this run the gate was already open by the time compose reported Healthy, because `waitHealthy` passed 2.2 s later.

### Decision

No code change in this PR.

1. **The healthcheck is not a wait the harness can shorten.** The harness sets no `start_period` or `interval` for OpenClaw, and the container was Healthy before any budget would have applied. Changing the image's healthcheck values would be a product default change, which the harness rules do not allow in this file.
2. **`waitHealthy` costs 2.2 s.** Its 2 s poll is already the floor.
3. **The largest harness-controlled item is the serial image pull inside the config write, about 25 s of the 46 s.** It is not waste to remove: the image has to be downloaded before the gateway can start. The saving would come from overlapping that pull with the products that start before OpenClaw. That changes the start order in `scripts/p4-ram-probe.sh` and in the suite's own sequence, which this PR does not own. The gain on the suite's L4 job cannot be measured from here, because its logs are not readable from this session. It is recorded as a follow-up candidate, not implemented.
4. **Known floor:** about 46 s for OpenClaw's `up()` in this CI shape, of which about 25 s is the image pull and about 18 s is the gateway's own boot to Healthy, plus 2 s for readiness.

### Open items

- The suite's `l4 openclaw stub` job logs and run id are not in this repository, so the suite's 6-minute figure is not attributed here. The next step is to read that job's timestamps with the same split as the table above. The suite is outside this session's repository scope.
- If the suite's OpenClaw step is slower than this 46 s, the extra time sits inside the gateway's readiness (channel connect with `OPENCLAW_CHANNEL_MOCK=1`, or a slow `startup-sidecars`). That is OpenClaw's own work and would need a timing change in the suite, not in the harness.
- `composeUp --wait` has no harness timeout. A gateway that never becomes healthy is bounded only by Docker's healthcheck retries, not by `P4_WAIT_MS`. This is noted, not changed.
