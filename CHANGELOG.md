# Changelog

## Unreleased

- Cal `up()` returns once Cal is healthy: the web server is started detached, its pid is recorded in `.harness/cal-web.pid`, and the process is unref'd. A second `up()` while the recorded process is still starting waits for it.
- Cal `down()` stops the recorded web process group, waits for the port to close, then removes the database container. It never kills a listener it did not start.
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
