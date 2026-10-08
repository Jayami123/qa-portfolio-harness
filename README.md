# qa-portfolio-harness

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
│   ├── cal.compose.yml          # port/project overlays; do not change product defaults
│   ├── documenso.compose.yml
│   ├── medusa.compose.yml
│   └── twenty.compose.yml
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

- Node 20+
- Docker Desktop
- npm (this repo)
- Local forks (not copied into this package):

| Product   | Path                                      | Typical ports (harness)      |
|-----------|-------------------------------------------|------------------------------|
| Cal.diy   | `../products/cal`                         | web 3000, API v2 5555, pg 5450 |
| Documenso | `../products/documenso`                   | web **3001**, pg 54320         |
| Medusa    | `../products/medusa`                      | HTTP 9000, pg 5433, redis 6380 |
| Twenty    | `../products/twenty-CRM`                  | app **3002**, pg 5434          |

Cal and Documenso both default to web **3000**. This harness does **not** change product defaults. Documenso is started with `PORT=3001`; Twenty’s compose overlay publishes **3002**.

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

**Until a GitHub tag exists** (after live Cal smoke is green and this branch is on `main`), use the local package:

```json
{
  "dependencies": {
    "qa-portfolio-harness": "file:../qa-portfolio-harness"
  }
}
```

Build this repo first (`npm i && npm run build`) so `dist/` exists. TypeScript lives in `devDependencies`; `prepare` compiles when you install **in this repo**.

Consumer pin:

```json
{
  "dependencies": {
    "qa-portfolio-harness": "github:Jayami123/qa-portfolio-harness#v0.2.0"
  }
}
```

## How to start Cal and run smoke

Cal `up()` starts **Postgres** and, if the web app is down, spawns the Cal web process (logs in `.harness/cal-web.log`). Default is **`next build` then `next start`** (`CAL_WEB_MODE=prod`). Set `CAL_WEB_MODE=dev` for next-dev (Windows: `next dev --webpack`; Cal’s `yarn dev --turbopack` dies on `instrumentation.ts`). Skip a rebuild when `apps/web/.next` exists unless `CAL_WEB_REBUILD=1`. `npm run smoke -- cal` calls `up()` first. Override the dev bundler with `CAL_WEB_BUNDLER=webpack` or `turbopack`.

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

## Limitations / TODOs

Honest gaps:

- Tag `v0.2.0` from `main` after this production-start work is merged.
- **Cal** `up()` starts Postgres and will spawn the web process unless the app is already healthy or `CAL_SKIP_WEB_START=1`. Default web mode is `next start` after `next build`. `CAL_WEB_MODE=dev` keeps next-dev (Windows webpack via `CAL_WEB_BUNDLER`).
- **Cal** web has no `/api/health` in this fork. Health falls back to `GET /` (any HTTP &lt; 500). API v2 exposes `GET /health` (unauthenticated — smoke does **not** treat that as proof of the API key).
- **Cal** `authenticate()` **requires** `CAL_API_KEY`. It no longer hardcodes the seed key from `scripts/seed.ts`.
- **Cal** `proveAuth()` tries `GET $CAL_API_BASE_URL/api/v2/me` (API v2 on 5555 is optional). If that process is down, it proves the hashed `CAL_API_KEY` exists in `"ApiKey"`. Override the HTTP path with `CAL_AUTH_PROBE_URL`.
- **Documenso** web must be started with `PORT=3001`. First API token cannot be minted without a logged-in session (`tRPC api-token-router`). Set `DOCUMENSO_API_TOKEN` after creating one in Settings → API tokens. **TODO(verify)** if a later seed script creates a token.
- **Medusa** `up()` starts validation Postgres/Redis/MinIO only. MinIO host ports are remapped to **9011/9012** so they do not collide with Documenso. **TODO(verify)** which store starter Jayami runs (`medusa develop` at :9000). `seed()` still throws — P1/P2 need that starter decision before Medusa journeys.
- **Medusa** admin JWT: `POST /auth/user/emailpass`. Store APIs also need `x-publishable-api-key`.
- **Twenty** uses image `twentycrm/twenty:2.44.0` (fork validation pin). App is published on **3002**. `ENCRYPTION_KEY` must already exist in `products/twenty-CRM/packages/twenty-docker/.env` — this package will not invent secrets. Prefer the fork’s `scripts/validation/anchor-b-up.ps1` if that env is not set.
- **Twenty** sign-in posts to `/metadata` (`getLoginTokenFromCredentials`). **TODO(verify)** whether `origin` must be a workspace subdomain (e.g. apple.localhost) in some configs.
- No Playwright, page objects, k6, ZAP, or P1–P7 CI in this repo.
- `createPgClient` does **not** run migrations. Use a read-only DB role in shared environments.

## License

Private portfolio package. Not published to npm. Tag `v0.2.0` from `main` after the production-start work is merged.
