# Changelog

## Unreleased

- Cal: the API v2 spawn env now sets `DATABASE_URL` from `CAL_DB_URL` and passes `CALENDSO_ENCRYPTION_KEY` from the product root `.env` (shared value). Before, `POST /v2/bookings` answered 500 with "Can't reach database server at 127.0.0.1:5432" (Prisma's fallback), and `GET /v2/me` answered 500 ("CALENDSO_ENCRYPTION_KEY environment variable is not set"). `CAL_DB_URL` now defaults to `postgresql://postgres:@127.0.0.1:5450/calendso` (was `localhost`).
- Cal seed: a failed `yarn db-seed` is accepted only when the output names exactly `free@example.com` (so `teamfree@example.com` no longer matches) and the `users` row exists. Before, the output match alone was enough.
- Documenso: `documensoMailApiUrl` is exported from `src/config.ts` and `src/index.ts` (`http://127.0.0.1:9003/api/v1/mailbox`), with a test that it matches the compose port.
- Documenso: opt-in `DOCUMENSO_GOTENBERG=1` adds a pinned Gotenberg 8 service on `127.0.0.1:3010` (`docker/documenso.gotenberg.compose.yml`) and sets `NEXT_PRIVATE_DOCUMENT_CONVERSION_URL` in the app env. Unset keeps the compose argv and app env unchanged.
- Documenso: `down documenso` passes `--remove-orphans`, so the Gotenberg container is removed even when the flag is unset at `down` time.
- Medusa: opt-in `MEDUSA_FF_CACHING=true` (needs `MEDUSA_REDIS=1`) registers `@medusajs/medusa/caching` with the `caching-redis` provider. The legacy `cache-redis` entry stays. Unset keeps the rendered config unchanged. The provider writes `mc:*` keys.
- Twenty: `IS_MULTIWORKSPACE_ENABLED` is forwarded when set to a non-blank value. `docker/twenty.compose.yml` still sets it to `false`, and a forwarded value overrides that.
  STR-002 (create and delete a workspace through the API) is deferred to the P2 Twenty lane build, which uses a fresh database per run. Measured blockers on this stack: the create route refuses a sixth workspace without an enterprise key (`Cannot create more than 5 workspaces without a valid enterprise key`, FORBIDDEN); and the workspace-token exchange returns `WORKSPACE_NOT_FOUND` for a new workspace when the origin is an IP-based host (`127.0.0.1`), so delete was not verified.
- Twenty: opt-in `TWENTY_SERVER_REPLICAS=2` adds `server-2` on `127.0.0.1:3003` with `DISABLE_DB_MIGRATIONS=true` and `DISABLE_CRON_JOBS_REGISTRATION=true` (`docker/twenty.replicas.compose.yml`, ADR 0003). Any other non-blank value fails `up()` by name. `down twenty` passes `--remove-orphans`.
- Cloud (Claude Code): the session-start hook runs `docker login --password-stdin` when `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set, prints `harness: docker login ok`, and never prints the token. An uppercase letter in `DOCKERHUB_USERNAME` is rejected with a `harness:` error (Docker Hub names are lowercase). `index.docker.io` is added to the README domain list.

**Upgrade note.** Consumers who set none of the new variables keep the v0.3.0 compose argv, Medusa config and Documenso app env. Two changes apply to everyone: Cal's `CAL_DB_URL` default is now `127.0.0.1:5450`, and the Cal API v2 spawn env now includes `DATABASE_URL` and `CALENDSO_ENCRYPTION_KEY`. A Cal consumer whose `CAL_DB_URL` points elsewhere sees the same value as before.

## v0.3.0 — 2026-11-01

- Cal `up()` starts the Cal API v2 on `127.0.0.1:5555` (`apps/api/v2`, built with the fork's `build:docker` and `build` scripts, detached, pid in `.harness/cal-api.pid`) and Redis on `127.0.0.1:6381` (`docker/cal.redis.compose.yml`, `REDIS_URL` passed in the API's spawn env). `up()` returns only when the web root and `$CAL_API_BASE_URL/health` both answer 200, and the listeners are the recorded pids. A process the harness did not start that holds 5555 or 3000 makes `up()` fail and names it. `down()` stops the API, then the web, then compose (Postgres and Redis).
- Cal and Documenso processes merge a default `--max-old-space-size` into an existing `NODE_OPTIONS` (new helper `withHeapDefault`). Cal stays at 8192 MB. Documenso gets 7168 MB, which passed the build in the P2 probe (exit 134 at about 2 GB before). A caller's own heap limit is kept, with no second flag.
- Twenty: `docker/twenty.compose.yml` adds `extra_hosts: host.docker.internal:host-gateway` to `server` and `worker` (ADR 0002).
- Twenty forwards `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`, `IS_BILLING_ENABLED`, `BILLING_STRIPE_API_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET` and `BILLING_STRIPE_PUBLISHABLE_KEY` by name, only when set. Compose reads the value from the environment of `up`; no value is written to `.harness/twenty.runtime.compose.yml`.
- `down documenso` stops only the process tree tied to the pid record, and deletes the record only after port 3001 is free. A record whose root had already exited, with its server still on the port, no longer loses track of the server; a listener is signaled only when the record is its ancestor. If the port is still held, `down` exits non-zero and names the recorded pid and the listeners.
- Cal API v2 is started with `NODE_ENV=production`, a per-run generated `JWT_SECRET` (never written to disk), and the shared web values from the Cal `.env`. `STRIPE_API_KEY` is a real credential: it comes from the environment or the harness `.env`, and a missing one fails `up` by name. The API log line redacts every secret.
- Deviations from the plan, recorded for the record: (1) `NODE_ENV=production` is passed to the Cal API. Without it, `apps/api/v2/src/swagger/generate-swagger.ts:32` throws `Missing environment variable: NODE_ENV`; `generateSwaggerForApp` (`generate-swagger.ts:21`) is async and `src/main.ts:71` does not await it, so the rejection is unhandled and Node exits with code 1 (reproduced, exit 1 within 60 s; with `NODE_ENV=production` the API stays up with health 200). (2) `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` are external credentials (`apps/api/v2/src/config/app.ts:39-40`): they are never generated, and a missing `STRIPE_API_KEY` fails `up` by name. (3) On Docker Desktop, `host.docker.internal` resolves to an IPv6 gateway, not IPv4 (see ADR 0002). (4) `down documenso` signals only the tree owned by the pid record and removes the record only after port 3001 is free.

**Upgrade note.** Consumers who set none of the new variables get the same Cal web, Twenty and Documenso behaviour, with two exceptions: `up cal` now also starts the API v2 and Redis (both stop in `down cal`), and Documenso now sets a 7168 MB heap default when `NODE_OPTIONS` is unset. The Cal compose `up` now waits for the Redis healthcheck as well as Postgres.

## v0.2.18 — 2026-10-29

- With `HARNESS_PG_STATS=1`, Cal `up()` waits only on the fork's `postgres` service (`up -d --wait postgres`). `--wait` on every service failed because the fork's one-shot `postgres_is_ready` container exits by design. Unset or `true` keeps the v0.2.17 argv (`up -d`).

## v0.2.17 — 2026-10-29

- Optional `HARNESS_EL_PRELOAD` (an absolute path to a readable file) and `HARNESS_EL_OUT` (an absolute directory, created when missing) add `--require=<preload>` to the Node processes of Cal's web server, the Medusa backends, the Documenso app (and its build and seed, which share its env) and the Twenty server and worker, and set `HARNESS_EL_OUT` and `HARNESS_EL_ROLE` in each. Unset or blank keeps every process env byte-identical to v0.2.16. An invalid path makes `up()` fail before any file is written.
- Optional `HARNESS_PG_STATS=1` (exact value) starts the Medusa, Documenso, Cal and Twenty Postgres with `pg_stat_statements` preloaded and `track_io_timing` on, then runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` once the database is healthy. Unset, `true` or blank keeps the stock command and creates no extension. A failed `CREATE EXTENSION` makes `up()` fail, with the psql message.

## v0.2.16 — 2026-10-29

- Optional API_RATE_LIMITING_SHORT_TTL_IN_MS, API_RATE_LIMITING_SHORT_LIMIT, API_RATE_LIMITING_LONG_TTL_IN_MS, API_RATE_LIMITING_LONG_LIMIT, APPLICATION_API_RATE_LIMITING_TTL_IN_MS and APPLICATION_API_RATE_LIMITING_LIMIT are written into the Twenty server and worker when set to a whole number of at least 1. Blank or unset keeps the image default. Nothing else is forwarded.

## v0.2.15 — 2026-10-24

- Cal `up()` and `down()` read the port listener on Linux from `/proc/net/tcp`, `/proc/net/tcp6` and `/proc/<pid>/fd`. lsof skipped the Next.js server because its name `next-server (v16.x)` has an unbalanced parenthesis, so `up()` failed with "no listener pid could be read" on Linux. lsof stays as the fallback and the macOS lookup; Windows is unchanged.

## v0.2.14 — 2026-10-24

- Cal `up()` returns once Cal is healthy. The web server is the Next.js server itself: node runs the fork's `next` bin from `apps/web` with the arguments of the fork's `start` script, with no shell and no yarn in between. It is detached on every platform, and its pid and start mark are recorded in `.harness/cal-web.pid`. After Cal is healthy, `up()` fails unless the port-3000 listener is the recorded pid.
- Cal `down()` stops the recorded pid when its start mark matches: `taskkill /T` on Windows, the process group on POSIX. It keeps `.harness/cal-web.pid` while the port is still held, and throws naming the recorded pid and start mark when the listener does not match. It never signals a pid whose start mark differs, and it removes the database container only after the port is free.
- Cal's seed presence check reads the `users` table (the fork maps `model User` to `users`); before, it failed on every `up` and re-ran `yarn db-seed`.
- The seeded API key is no longer printed in the `up` log (`Created seeded API Key: ***`).

## v0.2.13 — 2026-10-24

- security: upgrade zod to 4.x (GHSA-mrhx-c7xc-m3w5). `npm audit --audit-level=high` now passes. Config validation uses `z.url()` and `z.email()` with an explicit trim. Behaviour is unchanged except one edge case: a blank `TWENTY_EMAIL` now loads as the default admin email (zod 3 loaded it as undefined).
- `MEDUSA_SECOND_BASE_URL` (optional, unset = none) starts a second Medusa backend on the same database after the primary is healthy. It must be `127.0.0.1` on a different port. Its pid record stores `baseUrl`, so `down()` stops it even if the env var is removed. If the primary is already healthy while the variable is set, `up()` throws and asks you to run `down` first. A listener already answering on the second port is accepted only when `medusa-backend-2.pid` records a live pid for that URL.
- `MEDUSA_LOCK` (`memory` default, or `redis`) adds the Redis locking provider to the runtime Medusa config. `redis` requires `MEDUSA_REDIS=1`. A blank value means `memory`. The `memory` output is unchanged.

## v0.2.12 — 2026-10-23

- Package entry re-exports `TWENTY_DEFAULT_ADMIN_EMAIL` and `TWENTY_DEV_SEED_PASSWORD`, so consumers can import the Twenty dev-seeder login. These are the fork's public dev-seeder values, not production secrets.

## v0.2.11 — 2026-10-17

- Medusa `up()` runs `medusa build` with `NODE_ENV=production`. Stock `medusa build` sets development, which shipped a development admin bundle (error boundary "Error Details (Development Mode)" with stack traces, dev React warnings).
- `.medusa/server/harness-build.json` now records `"mode":"production"`. A cached build whose marker lacks it (every build made before v0.2.11) is rebuilt once on the next `up()`.

## v0.2.9 — 2026-10-15

- Medusa adapter targets `medusa-dtc-starter`: harness Postgres (and opt-in Redis), production backend on **127.0.0.1:9000**, storefront on **127.0.0.1:8000**, `seed()` (German Warehouse, Featured collection, `QA10`, US region, customer), `proveAuth()`, and gitignored runtime `medusa-config.js` when `MEDUSA_REDIS=1` or `MEDUSA_STRIPE=1` (default off). Stripe CLI webhook path: `/hooks/payment/stripe_stripe`.

## v0.2.8 - 2026-10-14

- Twenty `seed()` reports the real docker exec error when the seed command fails but the seed user is already present, instead of asserting an already-seeded database.

## v0.2.7 — 2026-10-13

- Twenty pins `twentycrm/twenty:v2.44.0` in `docker/twenty.compose.yml`, rejects `latest`, and inspects the running server image after `docker compose up -d --wait`. Server `healthcheck.start_period` is 300s so compose `--wait` tolerates a slow first boot.
- Twenty `health()` / `waitHealthy()` require HTTP **200** on `GET /healthz` (default wait budget 10 minutes, override with `TWENTY_WAIT_MS`). Default `TWENTY_BASE_URL` is `http://127.0.0.1:3002`.
- Twenty `up()` bootstraps gitignored `packages/twenty-docker/.env` secrets (`ENCRYPTION_KEY`, `APP_SECRET`) when missing or placeholder. If harness Twenty volumes already exist, it refuses to generate new keys while either secret is still missing or a placeholder (reset with `down -v`); it does not detect a mismatch between existing real keys and volume contents.
- Twenty `authenticate()` uses the fork’s `signIn` metadata mutation (workspace `loginToken` + `getAuthTokensFromLoginToken` when needed). Defaults: Admin `jane.austen@apple.dev` and the shared dev-seeder `TWENTY_PASSWORD` (override in harness `.env`). `proveAuth()` posts `currentUser` on `/metadata` with the Bearer token.
- Twenty `seed()` skips when Jane is already present; fails with reset instructions if re-seed errors on a populated DB. `down()` keeps volumes; optional `TWENTY_DOWN_VOLUMES=1` runs `down -v`.
- P1 notes: browser session is an httpOnly cookie (`useMarkSessionActive.ts`); client flag `isCookieAuthActiveState` in `localStorage` (`isCookieAuthActiveState.ts`). Mailpit **8025** / **1025** vs Documenso Inbucket **9003** / **2525**.

## v0.2.6 — 2026-10-13

- Documenso `up()` records the harness-started web server pid in `.harness/documenso-web.pid`. `down()` stops only that process tree (Windows: `taskkill /PID … /T /F`; Linux: process group `SIGTERM`) and removes the pid file. A missing or stale pid file does not throw. If the listen port is still in use after that stop, `down()` fails with the listener report and does not kill any other process.
- Optional `DANGEROUS_BYPASS_RATE_LIMITS=true` on the harness process (test/CI only) is forwarded into the Documenso app env when the value is exactly `true`. Unset or any other value leaves rate limits enabled.

## v0.2.5 — 2026-10-12

- Documenso `up()` sets local PDF signing to the fork example certificate at `apps/remix/example/cert.p12` (`NEXT_PRIVATE_SIGNING_TRANSPORT=local`, absolute `NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH`, empty passphrase). Remix start is `NODE_ENV=production`, so Documenso will not load `./example/cert.p12` by itself. If that file is missing, `up()` stops before Docker and prints the path.
- `.harness/documenso-web.log` is appended on each web start. A spawn banner marks the new process, so earlier seal and job errors stay in the log.

## v0.2.4 — 2026-10-11

- Optional `DOCUMENSO_PUBLIC_URL` (for example `http://p1.lvh.me:3001`) sets `NEXT_PUBLIC_WEBAPP_URL` so WebAuthn can use a hostname RP ID. `NEXT_PRIVATE_INTERNAL_WEBAPP_URL`, listen, and health stay on `DOCUMENSO_BASE_URL` (`http://127.0.0.1:3001`). Unset keeps v0.2.3 behaviour.
- `DOCUMENSO_PUBLIC_URL` must be http(s), its port must match the listen port, and its hostname must not be localhost or an IP. Before `up()`, the hostname must resolve to `127.0.0.1` (hosts file); there is no localhost fallback.
- When the public URL is set, a process that already answers on `127.0.0.1:3001` with a different `NEXT_PUBLIC_WEBAPP_URL` is reported as stale. The harness never kills it.

## v0.2.3 — 2026-10-11

- Documenso `up()` starts the harness-owned Postgres (127.0.0.1:5451) and Inbucket (SMTP 127.0.0.1:2525), then migrates, seeds, builds, and starts the stock Remix app on 127.0.0.1:3001. It no longer depends on the fork's `docker/development/compose.yml`.
- Documenso `up()` requires Node 24 or newer and stops before any side effect on older Node.
- Documenso health requires HTTP 200 on `/signin` and `/api/auth/csrf` on 127.0.0.1. A localhost-only answer is reported as an `ENVIRONMENT finding`, never a pass.
- A port that is in use by an unhealthy process is reported with its PID and executable (Windows). The harness never stops it.
- Default `DOCUMENSO_BASE_URL` is `http://127.0.0.1:3001` and `DOCUMENSO_DB_URL` uses port 5451. `localhost` is rejected.
- Add `npm test` (node:test, no new dependency) and `npm run check`. CI runs `npm test`. The packed tarball includes `docker/documenso.compose.yml`.
- `composeUp` accepts `{ wait: true }` (`docker compose up -d --wait`). `pollHealth` accepts `isOk` and `alternateLoopback`. Defaults are unchanged for Cal.

## v0.2.2 — 2026-10-09

- Add MIT `LICENSE`, `SECURITY.md`, `.github/CODEOWNERS`, pull request template, and `CONTRIBUTING.md`.
- Add CI workflow: actionlint, `npm ci` / `prepare`, typecheck, build, `npm pack --dry-run` contents checks, import smoke, and `npm audit --audit-level=high`.
- Add PR title validation, CodeQL (TypeScript and GitHub Actions), and Dependabot for npm and GitHub Actions.
- Add `.nvmrc` (Node 22) and `.editorconfig`.
- Security: bump `@faker-js/faker` to 10.6.0 (GHSA-qxc2-j82w-r537). Harness factory helpers already used v10-compatible APIs (`faker.person.*`, `faker.internet.email`); no source changes required.

## v0.2.1 — 2026-10-08

- Generate Cal tRPC types with `yarn turbo run build --filter=@calcom/trpc` before `next build`, then require `packages/trpc/types/server/routers/_app.d.ts`.
- Skip Cal `next build` only when `apps/web/.next/required-server-files.json` exists and `harness-build.json` `gitSha` matches product `HEAD`. Uncommitted Cal working-tree edits are not detected; use `CAL_WEB_REBUILD=1` after local Cal edits.
- `CAL_TRPC_BUILD_MS` overrides the tRPC turbo timeout (default 600000, min 120000).
- Add `npm run typecheck` (`tsc --noEmit`).

## v0.2.0 — 2026-10-08

- Default Cal `up()` to `next build` then `next start`.
- Skip `next build` when a production `.next` marker exists unless `CAL_WEB_REBUILD=1`.
