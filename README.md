# qa-portfolio-harness

[![CI](https://github.com/Jayami123/qa-portfolio-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayami123/qa-portfolio-harness/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Jayami123/qa-portfolio-harness/actions/workflows/codeql.yml/badge.svg)](https://github.com/Jayami123/qa-portfolio-harness/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/github/license/Jayami123/qa-portfolio-harness)](LICENSE)
[![tag](https://img.shields.io/github/v/tag/Jayami123/qa-portfolio-harness?label=latest%20tag)](https://github.com/Jayami123/qa-portfolio-harness/tags)

Shared TypeScript package for Jayami’s QA portfolio. This is the **only** place that knows how to start each product, wait until it is healthy, seed a test user, mint an auth token, and open a **read-only** Postgres connection.

Consumers: **P1** (web e2e), **P2** (backend/webhooks), **P5** (appsec), **P6** (load). Mobile (P3) and AI (P4) are out of scope.

Profile hub (later): [github.com/Jayami123](https://github.com/Jayami123)

## Folder layout

```
qa-portfolio-harness/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── README.md
├── docker/
│   ├── cal.compose.yml          # overlay after upstream compose; do not change product defaults
│   ├── documenso.compose.yml    # standalone (not layered with a product compose file)
│   ├── medusa.compose.yml       # standalone (the DTC starter has no product compose file)
│   └── twenty.compose.yml       # overlay after upstream compose
├── scripts/
│   ├── up.mjs                   # node scripts/up.mjs cal|documenso|medusa|twenty
│   ├── down.mjs
│   └── smoke.mjs                # health + seed + token + SELECT 1
└── src/
    ├── index.ts                 # public exports
    ├── config.ts
    ├── types.ts
    ├── adapters/
    │   ├── types.ts
    │   ├── cal.adapter.ts
    │   ├── documenso.adapter.ts
    │   ├── medusa.adapter.ts
    │   └── twenty.adapter.ts
    ├── db/pg.ts
    ├── data/factories.ts
    └── wait/health.ts
```

## Prerequisites

- Node 22 (see `.nvmrc`; `package.json` still lists `engines.node >= 20` until v0.2.2)
- Docker Desktop
- npm (this repo)
- Local forks (not copied into this package):

| Product   | Path                                      | Typical ports (harness)      |
|-----------|-------------------------------------------|------------------------------|
| Cal.diy   | `../products/cal`                         | web 3000, API v2 5555, pg 5450 |
| Documenso | `../products/documenso`                   | web **3001**, pg **5451** (harness compose), SMTP 2525 |
| Medusa    | `../products/medusa-dtc-starter`          | backend **9000**, pg **5433** (harness compose) |
| Twenty    | `../products/twenty-CRM`                  | app **3002**, pg 5434          |

Cal defaults to web **3000**. Documenso is started by the harness on **127.0.0.1:3001**. Twenty’s compose overlay publishes **3002**. This harness does **not** change product defaults.

## Setup

```powershell
cd D:\Jayami\Portfolio\qa-portfolio-harness
copy .env.example .env
# Fill placeholders in .env — never commit it
npm i
npm run build
```

Database URLs in `.env.example` match each **fork’s own** local compose / `.env.example`. They are not production secrets. Leave token/password fields empty until you copy values from a running app into `.env`.

## Public API

```ts
import {
  getAdapter,
  createPgClient,
  fakeEmail,
  fakePerson,
  fakeOrg,
  setFactorySeed,
} from "qa-portfolio-harness";
import type { ProductId, ProductAdapter, AuthSession } from "qa-portfolio-harness";

const adapter = getAdapter("cal");
await adapter.waitHealthy();
await adapter.seed();
const session = await adapter.authenticate();
const pool = createPgClient(adapter.dbUrl); // read-only intent; no migrations
```

`ProductId` is `'cal' | 'documenso' | 'medusa' | 'twenty'`.

## Usage from P1

For local development, point at the sibling folder:

```json
{
  "dependencies": {
    "qa-portfolio-harness": "file:../qa-portfolio-harness"
  }
}
```

Build this repo first (`npm i && npm run build`) so `dist/` exists. TypeScript lives in `devDependencies`; `prepare` compiles when you install **in this repo**.

Released consumer pin:

```json
{
  "dependencies": {
    "qa-portfolio-harness": "github:Jayami123/qa-portfolio-harness#v0.2.8"
  }
}
```

## How to start Documenso

Documenso needs **Node 24 or newer** (`engines.node >= 24.0.0` in the fork). The harness itself stays on Node 22. Use Node 24 only for the Documenso commands:

```bash
nvm install 24
nvm use 24
node -v    # expect v24.x or newer
npm -v     # expect 11.17.0 or newer
cd /d/Jayami/Portfolio/products/documenso
npm ci     # once, under Node 24
cd /d/Jayami/Portfolio/qa-portfolio-harness
node scripts/up.mjs documenso
nvm use 22 # switch back for the harness
```

If `node -v` is below 24, `up()` stops before Docker starts and prints `Documenso needs Node 24 or newer`.

`up()` does this in order:

1. Checks that `apps/remix/example/cert.p12` exists under the Documenso product root. If it is missing, `up()` stops before Docker and prints the path. Run `npm ci` in the fork. The harness does not generate a certificate.
2. Starts the harness compose (`docker/documenso.compose.yml`): Postgres on **127.0.0.1:5451** and Inbucket SMTP on **127.0.0.1:2525** (UI **127.0.0.1:9003**).
3. Probes `http://127.0.0.1:3001/signin` and `/api/auth/csrf`. Both must return HTTP 200. If they already do, it returns, unless `DOCUMENSO_PUBLIC_URL` is set and the running app still advertises a different `NEXT_PUBLIC_WEBAPP_URL` (stale passkey RP ID). In that case `up()` stops and prints the listener; it never kills the process.
4. Copies the fork's `.env.example` to `.env` if that file is missing. This is a local, uncommitted file. Secrets are the stock placeholders, passed as env vars.
5. Runs `prisma:migrate-deploy`, then `prisma:seed` if `example@documenso.com` is missing.
6. Builds the Remix app, unless `apps/remix/build/harness-build.json` matches the product `HEAD`. Set `DOCUMENSO_WEB_REBUILD=1` to force a rebuild.
7. Starts `npm run start -w @documenso/remix`. Logs append to `.harness/documenso-web.log`. Each start adds a spawn banner, so earlier job errors stay in the file. The harness writes the web pid to `.harness/documenso-web.pid`. The server is left running after `up()` returns until you run `down`.

Completing a document runs the seal job, which signs the PDF. The harness sets `NEXT_PRIVATE_SIGNING_TRANSPORT=local`, `NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH` to the absolute path of that example `.p12`, and `NEXT_PRIVATE_SIGNING_PASSPHRASE` to empty (the bundled dev cert). Remix `npm run start` is `NODE_ENV=production`, so Documenso will not fall back to `./example/cert.p12`. Upstream CI sets the path for the same reason.

Health uses **127.0.0.1 only**. `localhost` is never accepted as a pass. If `localhost` answers but `127.0.0.1` does not, `up()` stops with an `ENVIRONMENT finding` (IPv6 bind).

If port 3001 is in use by something that is not a healthy Documenso, `up()` prints the listener PID and executable (Windows) and stops. It never kills a process. Decide what to do with that process, then retry.

Optional `DOCUMENSO_PUBLIC_URL` (for example `http://p1.lvh.me:3001`) is for passkeys. WebAuthn rejects an IP as RP ID. The Remix process still listens on **127.0.0.1:3001**. Health probes and `NEXT_PRIVATE_INTERNAL_WEBAPP_URL` stay on that address so the server can talk to itself without the public name. Only `NEXT_PUBLIC_WEBAPP_URL` becomes the public URL (cookie domain and RP ID). Use **http** locally: harness start is `NODE_ENV=production`, and an `https://` public URL would set `__Secure-` cookies without TLS.

The public hostname must not be `localhost` or an IP, its port must match the listen port, and it must resolve to `127.0.0.1` before `up()` starts Docker. Add a hosts-file line (no localhost fallback):

```text
127.0.0.1 p1.lvh.me
```

- Windows: `C:\Windows\System32\drivers\etc\hosts`
- Linux/macOS: `/etc/hosts`

CI:

```bash
echo "127.0.0.1 p1.lvh.me" | sudo tee -a /etc/hosts
```

Open the app in the browser at `http://p1.lvh.me:3001`, not `http://127.0.0.1:3001`, when the public URL is set.

Environment knobs: `DOCUMENSO_SKIP_WEB_START=1` (compose only), `DOCUMENSO_WEB_BUILD_MS`, `DOCUMENSO_WEB_WAIT_MS`, `DOCUMENSO_WEB_REBUILD=1`, `DOCUMENSO_PUBLIC_URL`.

**Test-only rate-limit bypass:** set `DANGEROUS_BYPASS_RATE_LIMITS=true` on the harness process before `up()` (exact string `true`; `1` or unset leaves limits on). The harness passes it into the Remix app env; never set it in the Documenso fork `.env`. P1 uses a second `down`/`up` cycle after **P1-DOC-RL-001**.

`node scripts/down.mjs documenso` stops the pid recorded in `.harness/documenso-web.pid` (process tree only), then tears down the harness compose stack. If the listen port is still busy, `down()` prints the listener report and exits without killing unrelated processes.

## How to start Cal and run smoke

Cal `up()` starts **Postgres** and, if the web app is down, spawns the Cal web process (logs in `.harness/cal-web.log`). Default is **`next build` then `next start`** (`CAL_WEB_MODE=prod`). Set `CAL_WEB_MODE=dev` for next-dev (Windows: `next dev --webpack`; Cal’s `yarn dev --turbopack` dies on `instrumentation.ts`).

`up()` returns once Cal answers healthy. The web server is the Next.js server itself: node runs the fork's `next` bin from `apps/web` with the arguments of the fork's `start` script, with no shell and no yarn process in between. It is detached, and its pid and start mark are recorded in `.harness/cal-web.pid`. After Cal answers, `up()` fails unless the port-3000 listener is that recorded pid. `down()` stops the recorded pid when its start mark matches (`taskkill /T` on Windows, the process group on POSIX). The pid file stays while port 3000 is held, and `down()` throws, naming the recorded pid and start mark. It never signals a pid whose start mark differs. The database container is removed only once the port is free.

Before `next build`, the adapter runs `yarn turbo run build --filter=@calcom/trpc` and checks that `packages/trpc/types/server/routers/_app.d.ts` exists. That file is gitignored output of `@calcom/trpc#build`; `packages/trpc/react/trpc.ts` imports `AppRouter` from it. Turbo’s `@calcom/web#build` graph gets it via `^build`; a direct `next build` does not. Override the tRPC turbo timeout with `CAL_TRPC_BUILD_MS` (default 600000, min 120000).

Skip a rebuild only when `apps/web/.next/required-server-files.json` exists **and** `apps/web/.next/harness-build.json` records the same `gitSha` as `git rev-parse HEAD` in the Cal product root. Uncommitted changes in the Cal working tree are **not** detected (skip is keyed on HEAD only); set `CAL_WEB_REBUILD=1` after local Cal edits. Otherwise the adapter logs why and rebuilds. `npm run smoke -- cal` calls `up()` first. Override the dev bundler with `CAL_WEB_BUNDLER=webpack` or `turbopack`.

```powershell
cd D:\Jayami\Portfolio\qa-portfolio-harness
copy .env.example .env
npm i
npm run build
npm run smoke -- cal
```

First-time Cal fork setup (once):

```powershell
cd D:\Jayami\Portfolio\products\cal
yarn
# copy .env.example → .env; set NEXTAUTH_SECRET and CALENDSO_ENCRYPTION_KEY
```

Docker Desktop must be running. Set `CAL_SKIP_WEB_START=1` to keep `up()` Postgres-only.

Optional API v2:

```powershell
cd D:\Jayami\Portfolio\products\cal\apps\api\v2
yarn dev         # http://localhost:5555/health → OK
```

Copy the `Created seeded API Key: cal_…` line from `yarn db-seed` into harness `.env` as `CAL_API_KEY`. Do not rely on a hardcoded key.

Then:

```powershell
cd D:\Jayami\Portfolio\qa-portfolio-harness
npm run smoke -- cal
```

Live smoke: `waitHealthy` → `seed` → `authenticate` (requires `CAL_API_KEY` or the key printed by `yarn db-seed`) → **auth probe** (`GET` API v2 `/me` if that process is up; otherwise the hashed key must exist in `"ApiKey"`) → `SELECT 1`.

If the app is not running, smoke exits 1 with those same start steps. Config-only check:

```powershell
npm run smoke -- cal --dry-run
```

## Smoke per product

```powershell
node scripts/up.mjs cal|documenso|medusa|twenty
npm run smoke -- cal
npm run smoke -- documenso
npm run smoke -- medusa
npm run smoke -- twenty
npm run smoke -- cal --dry-run
node scripts/down.mjs cal
```

Live smoke: `waitHealthy` → `seed` → `authenticate` (token truncated in logs) → `proveAuth` → `SELECT 1` via the read-only pg helper.

## CI (this repo)

On every pull request and on pushes to `main`:

- **actionlint** on `.github/workflows`
- **typecheck and build**: `npm ci` (runs `prepare` → `tsc`), `npm run typecheck`, `npm run build`, dist file checks, `npm pack --dry-run` contents checks, import smoke of `dist/index.js`, `npm audit --audit-level=high`
- **PR title** conventional commit check
- **CodeQL** for TypeScript and workflow files

Live product smoke and Docker are not run here; P1 CI covers Cal E2E against a pinned harness tag.

## Limitations / TODOs

Honest gaps:

- **Cal** `up()` starts Postgres and will spawn the web process unless the app is already healthy or `CAL_SKIP_WEB_START=1`. Default web mode is `next start` after `next build` (tRPC types first; skip only when `.next` matches product HEAD). `CAL_WEB_MODE=dev` keeps next-dev (Windows webpack via `CAL_WEB_BUNDLER`).
- **Cal** web has no `/api/health` in this fork. Health falls back to `GET /` (any HTTP &lt; 500). API v2 exposes `GET /health` (unauthenticated — smoke does **not** treat that as proof of the API key).
- **Cal** `authenticate()` **requires** `CAL_API_KEY`. It no longer hardcodes the seed key from `scripts/seed.ts`.
- **Cal** `proveAuth()` tries `GET $CAL_API_BASE_URL/api/v2/me` (API v2 on 5555 is optional). If that process is down, it proves the hashed `CAL_API_KEY` exists in `"ApiKey"`. Override the HTTP path with `CAL_AUTH_PROBE_URL`.
- **Documenso** `up()` needs Node 24 (see below). It starts only the harness-owned Postgres and Inbucket, plus the Remix app on 127.0.0.1:3001. Optional `DOCUMENSO_PUBLIC_URL` sets the passkey RP ID; health and the internal webapp URL stay on 127.0.0.1. Seal needs the fork example cert at `apps/remix/example/cert.p12` (local transport, empty passphrase). The web log is appended across restarts. It does not start Redis, MinIO, or Gotenberg. The first API token cannot be minted without a logged-in session (`tRPC api-token-router`). Set `DOCUMENSO_API_TOKEN` after creating one in Settings → API tokens. **TODO(verify)** if a later seed script creates a token.
- **Medusa** `up()` uses the DTC starter (`products/medusa-dtc-starter`), not the engine monorepo. Harness Postgres **127.0.0.1:5433**; optional Redis **127.0.0.1:6380** when `MEDUSA_REDIS=1`. `medusa db:migrate`, production `medusa start` from `apps/backend/.medusa/server`, gitignored runtime `medusa-config.js` when Redis/Stripe switches are on. Storefront **127.0.0.1:8000** when a publishable key exists (`MEDUSA_SKIP_STOREFRONT=1` to skip). Build runs with `NODE_ENV=production` (stock `medusa build` forces development, which ships a development admin bundle with "Error Details (Development Mode)"). Build skip: `harness-build.json` under `.medusa/server` matches product HEAD and records `"mode":"production"`; an older marker without it triggers a rebuild. Health: `GET /health` **200** only. `down()` stops storefront and backend pids, compose down without `-v`. Default fake Redis: `docs/adr/0001-medusa-fake-redis.md`.
- **Medusa** `seed()`: admin user, German Warehouse, Featured collection (4 products), promo `QA10`, customer, US region; Stripe provider on Europe when `MEDUSA_STRIPE=1` + `STRIPE_API_KEY`. `proveAuth()`: `GET /admin/users/me`. Admin JWT: `POST /auth/user/emailpass`. Stripe CLI → `http://127.0.0.1:9000/hooks/payment/stripe_stripe`. German admin: `/app` → Profile → Language → **Deutsch**. On an http `MEDUSA_BASE_URL` the runtime config drops `Secure` from the admin session cookie (`medusa start` forces it in production), so `/app` login works on plain http; https keeps Medusa's defaults. P1 storefront path: `/dk/products/t-shirt`.

### Which project turns on what (Medusa harness switches)

| Portfolio project | `MEDUSA_REDIS` | `MEDUSA_STRIPE` |
|---|---|---|
| P1 (default) | off | off |
| P2, P6 | `1` | off |
| Webhook / payment cases | `1` | `1` |

Switches live in the harness `.env` and default off.

| Env | Default | What it does |
|---|---|---|
| `MEDUSA_SECOND_BASE_URL` | unset (no second backend) | Starts an optional second Medusa backend on the same database, after the first is healthy. Must be `http://127.0.0.1:<port>` with a port different from `MEDUSA_BASE_URL`. |
| `MEDUSA_LOCK` | `memory` | `redis` uses the Redis locking provider for the backend. It needs `MEDUSA_REDIS=1`. |
| `HARNESS_PG_STATS` | off | Exactly `1` turns on `pg_stat_statements` for the four harness-owned Postgres databases (Medusa, Documenso, Cal, Twenty). Each database gets `shared_preload_libraries=pg_stat_statements` and `track_io_timing=on` through an opt-in `docker/<product>.pg-stats.compose.yml` overlay, and `CREATE EXTENSION IF NOT EXISTS` runs once after the database is healthy, as the compose superuser (`POSTGRES_USER`). Any other value, including empty, is off. |
- **Twenty** pins `twentycrm/twenty:v2.44.0` (overlay + `TWENTY_IMAGE_TAG`; `latest` is rejected). Compose `healthcheck.start_period` is 300s so `--wait` survives a slow first boot. App is on **127.0.0.1:3002**; health requires HTTP **200** on `/healthz`. `up()` bootstraps gitignored `ENCRYPTION_KEY` / `APP_SECRET` when missing or placeholder; if Twenty volumes already exist, it refuses to generate new keys while either value is still missing or a placeholder (reset with `down -v`; see CHANGELOG). It does not verify keys against volume contents. Mailpit UI **8025** and SMTP **1025** do not overlap Documenso Inbucket **9003** / **2525**.
- **Twenty** smoke defaults: Admin `jane.austen@apple.dev` and shared dev-seeder `TWENTY_PASSWORD` (fork `seed-users.util.ts`; set overrides in harness `.env`, do not commit). `authenticate()` uses `signIn` on `/metadata`, then `getAuthTokensFromLoginToken` with workspace `subdomainUrl` when needed. `proveAuth()` reads `currentUser.email` on `/metadata`. Optional `TWENTY_API_KEY` bypasses login.
- **Twenty** harness compose is fork `docker-compose.yml` + `docker/twenty.compose.yml` only (no fork `docker-compose.validation.yml`). Mailpit and SMTP live in the overlay; `IS_MULTIWORKSPACE_ENABLED=false` so smoke auth uses `127.0.0.1:3002` without workspace subdomains.
- **Twenty** rate-limit knobs (optional): `API_RATE_LIMITING_SHORT_TTL_IN_MS`, `API_RATE_LIMITING_SHORT_LIMIT`, `API_RATE_LIMITING_LONG_TTL_IN_MS`, `API_RATE_LIMITING_LONG_LIMIT`, `APPLICATION_API_RATE_LIMITING_TTL_IN_MS` and `APPLICATION_API_RATE_LIMITING_LIMIT` are read from the harness process at `up()` and written into the Twenty server and worker when set to a whole number of at least 1. Exact-name allowlist: nothing else is forwarded. Unset or blank keeps the image default (`1000`, `100`, `60000`, `100`, `60000`, `500` in that order); a blank value is never written, because Twenty reads an empty value as 0. With no variable set, no override file is written (`.harness/twenty.runtime.compose.yml` is removed if a previous run left it). A value that is not a whole number of at least 1 makes `up()` fail before any file is written.
- **Twenty** P1 later: listen/health at `TWENTY_BASE_URL`. Multi-workspace forks may use `workspaceUrls.subdomainUrl` in the browser; harness smoke does not. Tokens: httpOnly session cookie (`packages/twenty-front/src/modules/auth/hooks/useMarkSessionActive.ts` lines 8–10); client flag `isCookieAuthActiveState` in `localStorage` (`…/states/isCookieAuthActiveState.ts` lines 3–10).
- No Playwright, page objects, k6, ZAP, or P1–P7 test suites in this repo.
- `createPgClient` does **not** run migrations. Use a read-only DB role in shared environments.

### Known gaps (post v0.2.2)

- ESLint and Prettier (same setup as P1).
- Unit tests for pure modules (config parsing, timeouts, URL handling, redaction) plus a `test` script and CI job.
- Bump `package.json` `engines.node` to `>=22` (Node 20 reached end-of-life in April 2026; CI uses Node 22 via `.nvmrc`).

## License

[MIT](LICENSE) — Copyright (c) 2026 Jayami Hettigoda. Not published to npm; consumers install from Git tags.
