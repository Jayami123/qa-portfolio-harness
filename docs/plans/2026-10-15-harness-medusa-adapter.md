# Harness v0.2.9 Medusa adapter

## 1 Header

- Repo: `qa-portfolio-harness` · [Jayami123/qa-portfolio-harness](https://github.com/Jayami123/qa-portfolio-harness) · harness
- Branch: `feat/2026-10-15-harness-medusa-adapter` from `main` at **742c651**. Do not commit on `main`. Target **v0.2.9**. Do not merge, tag, or open a PR without Jayami's go-ahead.
- Package version today: `0.2.8`. Tag `v0.2.8` is two docs commits behind HEAD.
- Product (read-only, never edit): `D:\Jayami\Portfolio\products\medusa-dtc-starter` · [Jayami123/medusa-dtc-starter](https://github.com/Jayami123/medusa-dtc-starter) HEAD **`f677db438f27294fc50e4c7c6612e71ff38eeff5`** (`f677db4`, 2026-10-09, upstream `fix/remove-static-params`). Pin this SHA in the README when the adapter lands.
- Engine fork `D:\Jayami\Portfolio\products\medusa` stays untouched. After this rewrite the adapter must not read `scripts/portfolio-validation`, MinIO, or that folder.
- Date: 2026-10-15. Probe ran against a scratch clone of the same SHA; that scratch clone is deleted after this plan commit. Task 2 landed (adapter up/down, fake Redis ADR `docs/adr/0001-medusa-fake-redis.md`, harness-build marker under `.medusa/server/`). Branch head after task 2 fixes: **`14587db`**.
- Start and stop Medusa only through `node scripts/up.mjs medusa` and `node scripts/down.mjs medusa` once the adapter exists. Reset volumes with a documented `down -v`, not by editing the fork.

Labels in this file: **verified** (this session's probe, 2026-10-15), **inferred**, **NOT MEASURED**.

## 2 Goal and scope — full Medusa v0.2.9

**Product:** `medusa-dtc-starter` (`apps/backend` + `apps/storefront`). Engine monorepo `products/medusa` stays untouched.

**Default (P1-light):** Postgres 15 only; fake Redis; `pp_system_default`; no storefront spawn until task 5; `seed()` still throws until task 3. Opt-in harness env switches stay **off** so portfolio P1 does not pay Redis/Stripe cost unless a project opts in.

**In scope (tasks 3–6):**

- Idempotent **full seed** (section 4 `seed()`).
- **Opt-in switches** (section 4): `MEDUSA_REDIS=1`, `MEDUSA_STRIPE=1` (harness `.env`, default off).
- **Config overlay** without editing tracked fork files (section 4); prove `git status --short` empty in the product after `up`.
- Storefront on :8000; `npm run smoke -- medusa` with switches on and off; `proveAuth`; CHANGELOG; README including **Which project turns on what**; version **0.2.9**; tag after Jayami merge.

**Out of scope:** tracked edits under `medusa-dtc-starter`; Cal/Documenso/Twenty adapters; P1 Playwright in this repo; harness CI Docker live smoke; real Stripe live keys; CodeRabbit CLI; merge, tag, or PR without Jayami.

## 3 Probe results (2026-10-15)

Host: Node **v24.21.0**, npm 11.19.0, Docker 29.8.2. Corepack activated **pnpm 10.11.1**. Cal, Documenso, and Twenty were already up. Probe ports 8000, 9000, 5433, and 6380 were free.

### 3.1 Install

| Item | Value | Label |
|---|---|---|
| `package.json` `engines.node` | `>=22.22.0` (root README "v20+" is stale) | verified in source |
| `packageManager` | `pnpm@10.11.1` · lockfile `pnpm-lock.yaml` | verified |
| `pnpm install --frozen-lockfile` | exit 0, **276.8 s** (4 m 36.6 s), 1492 packages, cold (reused 0) | verified |
| pnpm warning | ignored build scripts: `@swc/core`, `esbuild`, `msgpackr-extract`, `protobufjs`, `sharp`, `unrs-resolver` | verified |

Task 2 must prove whether `sharp`, `@swc/core`, and `esbuild` are required for `medusa build` / `medusa start` and `next build` / `next start`. Approve only those proven necessary, via harness-side config (gitignored product file or `pnpm rebuild` from the adapter). Do not edit tracked `pnpm-workspace.yaml`.

### 3.2 Backend env, Postgres, Redis, migrate, admin user

`apps/backend/.env.template` keys: `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, `REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `DATABASE_URL`, `DB_NAME`. Probe pointed `DATABASE_URL` at `127.0.0.1:5433` in a gitignored `.env`. Do not log those values.

| Item | Value | Label |
|---|---|---|
| Postgres | `postgres:15` disk **633 MB** · runtime **15.19** · `127.0.0.1:5433` · RSS **57.6 MiB** | verified |
| Redis image (started, unused) | `redis:7` disk **182 MB** · runtime **7.4.11** · `127.0.0.1:6380` · RSS **3.8 MiB** | verified |
| Redis used by Medusa? | **No.** Every CLI and boot log: `redisUrl not found. A fake redis instance will be used.` Product `apps/backend/medusa-config.ts` sets `databaseUrl` and `http` only. It does not pass `projectConfig.redisUrl`. `REDIS_URL` in the template is unused. | verified |
| MinIO / S3 | Not in template or config. Product images are remote Medusa public URLs. | verified |
| Migrate | `cd apps/backend && pnpm medusa db:migrate` exit 0, **27.3 s**. Runs core migrations and `apps/backend/src/migration-scripts/initial-data-seed.ts` (0.95 s). | verified |
| Root `pnpm backend:seed` | turbo `seed` filter, but `@dtc/backend` has **no `seed` script**. Do not use it. | verified in source |
| Extra demo products | `npx medusa exec ./src/scripts/seed-demo-products.ts` (50 products). Not run. | NOT MEASURED |
| Second migrate | exit 0, **88.6 s**, `Database already up-to-date`. Did not re-run store seed. | verified |
| Admin user | `pnpm medusa user -e admin@test.com -p <MEDUSA_ADMIN_PASSWORD>` exit 0, **7.7 s**. Seed does not create an admin. | verified |
| Second user create | exit **1**, `User with email: admin@test.com, already exists.` Adapter must skip, not re-run. | verified |

Seed created (SQL + admin API):

- 1 sales channel `Default Sales Channel`
- 1 publishable API key `Default Publishable API Key` (type `publishable`; token length 67; prefix `pk_`). **Never print the token** in harness logs, README, or chat. Storefront `next dev` printed it in stdout during the probe. Harness logs must redact.
- 1 store `Default Store` (eur default, usd)
- 1 region `Europe` / `eur` / countries dk, fr, de, it, es, se, gb
- payment provider on the region: **`pp_system_default` only**
- 1 stock location `European Warehouse` / Copenhagen / `DK`
- 4 published products: Medusa T-Shirt (`t-shirt`), Sweatshirt, Sweatpants, Shorts. 20 variants. 20 inventory levels at 1_000_000
- **0 product collections**
- admin `admin@test.com` only after `medusa user`

### 3.3 Boot, health, admin login

Command used: `cd apps/backend && pnpm dev` (`medusa develop`). Production `medusa build` / `medusa start` was **NOT MEASURED**. Task 2 measures those and records the numbers in this file (section 5).

| Item | Value | Label |
|---|---|---|
| Listen | port **9000**. Log: `Admin URL → http://localhost:9000/app` | verified |
| Medusa internal timer | `Server is ready on port: 9000 – 7383ms` | verified |
| Wall-clock to ready log | about **19.6 s** from `pnpm dev` spawn | verified |
| `GET http://127.0.0.1:9000/health` | **HTTP 200**, body `OK` (Content-Type `text/html`). Same on `localhost` | verified |
| `GET /app` | HTTP 200 | verified |
| Login UI | `/app/login`. Email, Password, Continue with Email | verified |
| Login | works as `admin@test.com`. Lands on `/app/orders` | verified |
| Auth API | `POST /auth/user/emailpass` HTTP 200, JWT present (existing adapter already does this) | verified |
| proveAuth candidate | `GET /admin/users/me` HTTP 200, email `admin@test.com` | verified |

### 3.4 Medusa version and German locale

| Item | Value | Label |
|---|---|---|
| Installed | `@medusajs/medusa` **2.21.2** (framework, dashboard, cli, admin-sdk same) | verified `pnpm list` |
| Admin languages | `@medusajs/dashboard` `src/i18n/languages.ts` includes `{ code: "de", display_name: "Deutsch" }`. File `src/i18n/translations/de.json` has German strings | verified |
| UI | Settings, Profile, Edit Profile, Language combobox lists **Deutsch** (English checked). Copy: "The language you want to use in the admin dashboard. This doesn't change the language of your store." | verified |
| Starter overlay | `apps/backend/src/admin/i18n/index.ts` exports `{}` | verified |

No fork change is required for German admin. Task 4 documents this in the README. P1 can assert the option later.

### 3.5 Stripe (no keys added)

`apps/backend/medusa-config.ts` has **no `modules` block**. Region uses `pp_system_default`. Storefront already maps `pp_stripe_stripe` and reads `NEXT_PUBLIC_STRIPE_KEY`.

Industry register (Medusa docs, not live-run):

```ts
modules: [{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [{
      resolve: "@medusajs/medusa/payment-stripe",
      id: "stripe",
      options: {
        apiKey: process.env.STRIPE_API_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      },
    }],
  },
}]
```

Provider id: **`pp_stripe_stripe`**. Then enable it on the Europe region. Backend needs `STRIPE_API_KEY` (Stripe secret test key). Storefront needs `NEXT_PUBLIC_STRIPE_KEY` (Stripe publishable test key). `STRIPE_WEBHOOK_SECRET` is required for async `payment_intent.succeeded` (local Stripe CLI to `{backend}/hooks/payment/stripe_stripe`). Test keys without the module block and without enabling the provider on the region are not enough.

**Forks stay read-only.** There is no Stripe fork PR. Task 4 must find a harness overlay that does not edit tracked fork files. If none works, **stop** and report options with evidence. Do not pick a workaround in that task.

### 3.6 Second stock location (probe)

Seed makes **one** location. Live `POST /admin/stock-locations` with admin JWT:

```http
POST /admin/stock-locations
Authorization: Bearer <token>
Content-Type: application/json

{"name":"German Warehouse","address":{"address_1":"Alexanderplatz 1","city":"Berlin","country_code":"de"}}
```

**Verified:** HTTP 200, `count=2`. `DELETE /admin/stock-locations/{id}` HTTP 200 restored `count=1`. Inventory levels and sales-channel link for that location were **NOT MEASURED**. Task 3 measures those extra calls and keeps the location (idempotent).

### 3.7 Storefront

`apps/storefront/.env.template`: required `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`; `NEXT_PUBLIC_MEDUSA_BACKEND_URL` default `http://localhost:9000`; `NEXT_PUBLIC_DEFAULT_REGION=dk`; `NEXT_PUBLIC_BASE_URL`; optional `NEXT_PUBLIC_STRIPE_KEY`.

| Item | Value | Label |
|---|---|---|
| Command used | `cd apps/storefront && pnpm dev` (`next dev --turbopack -p 8000`) | verified |
| Next ready | **1821 ms**. First `/[countryCode]` compile **9.2 s** | verified |
| `GET http://127.0.0.1:8000/dk` | HTTP **200** | verified |
| `GET /` | HTTP **307** to `/dk` | verified |
| `GET /store/products` with publishable key | HTTP 200, count **4** | verified |
| Home `/dk` | Hero only. No product rail. `page.tsx` renders `FeaturedProducts` from **collections**. Seed created **zero** collections. | verified |
| Product page | `/dk/products/t-shirt` shows Medusa T-Shirt at €10.00 | verified |
| `next build` / `next start` | not run | NOT MEASURED |

### 3.8 RAM and image sizes vs a 16 GB CI runner

Develop-mode RSS, one sample:

- Backend node: 192.6 + 466.9 MB
- Storefront node: 81.6 + 1068.3 + 92.1 MB
- Probe Postgres + Redis: 57.6 + 3.8 MiB
- Sum about **1.96 GB**

Disk: `postgres:15` 633 MB + `redis:7` 182 MB = **815 MB**. No Medusa app image (host-spawned). Production `build`/`start` RSS is **NOT MEASURED**.

**Inferred:** a sequential Medusa smoke fits a 16 GB runner. This PC's Docker VM is 9.6 GiB. Twenty was already about 2.3 GB RSS. Do not start Cal, Documenso, Twenty, and Medusa on one job.

### 3.9 Existing adapter pattern

Contract: `ProductAdapter` in `src/adapters/types.ts` (`up`, `down`, `health`, `waitHealthy`, `seed`, `authenticate`, `proveAuth`). CLI: `scripts/up.mjs`, `down.mjs`, `smoke.mjs`. Compose: `src/internal/compose.ts`. Spawn: `src/internal/spawn-detached.ts`.

| Product | HTTP | Deps | Logs | Pin |
|---|---|---|---|---|
| Cal | spawn `next`, port 3000 | fork compose pg 5450 | `.harness/cal-web.log` | none |
| Documenso | spawn Remix 127.0.0.1:3001, pid file, `down` kills tree | harness-owned compose pg 5451 + Inbucket | `.harness/documenso-web.log` | Node ≥24, `postgres:15` |
| Twenty | compose app 3002 | overlay + fork compose, pg 5434 | docker logs | `twentycrm/twenty:v2.44.0` |
| Medusa today | HTTP not started | engine `scripts/portfolio-validation` + MinIO 9011/9012, pg 5433, redis 6380 | none | `seed()` throws |

**Chosen:** follow Documenso. The DTC starter has no product compose and is not a Docker app image.

Ports (no clash with 3000 / 3001 / 3002 / 5434): backend **9000**, storefront **8000**, Postgres **5433**, Redis **6380** only if the app actually uses it. Default URLs: **127.0.0.1**, not `localhost`.

## 4 Design

```mermaid
flowchart TD
  upStart[up]
  nodeGate[assert Node >= 22.22 and pnpm]
  envFiles[bootstrap gitignored backend and storefront env]
  compose[composeUp postgres and redis if MEDUSA_REDIS=1]
  migrate[medusa db:migrate]
  user[medusa user or skip if email exists]
  extras[collection plus German Warehouse]
  captureKey[read publishable token and redact]
  spawnApi[spawn production start or develop]
  waitApi["waitHealthy GET /health HTTP 200"]
  spawnSf[spawn storefront 8000]
  waitSf["GET /dk HTTP 200"]
  auth[POST /auth/user/emailpass]
  prove["GET /admin/users/me email match"]
  downKeep[stop pid trees then composeDown no dash v]
  upStart --> nodeGate --> envFiles --> compose --> migrate --> user --> extras --> captureKey
  captureKey --> spawnApi --> waitApi --> spawnSf --> waitSf
  waitSf --> auth --> prove --> downKeep
```

### Product root

**Chosen:** `MEDUSA_PRODUCT_DIR` default `../products/medusa-dtc-starter` (`path.join(productsRoot, "medusa-dtc-starter")`). `loadConfig()` already uses `resolveExistingDir`. `up()` must fail with that path in the message if `apps/backend/medusa-config.ts` is missing. Do not fall back to `../products/medusa`.

P1 CI that stubs `products/medusa` for `loadConfig()` must stub `medusa-dtc-starter` too after the tag. That is a separate P1 change.

**Rejected:** overwrite the engine fork; keep `scripts/portfolio-validation/docker-compose.yml`.

### Compose

**Chosen (task 2, default):** harness-owned `postgres:15` on `127.0.0.1:5433`. No Redis. See ADR 0001 (fake Redis when switches are off).

**Opt-in `MEDUSA_REDIS=1` (task 4):** add `redis:7` to `docker/medusa.compose.yml` (or a small overlay file) on `127.0.0.1:6380`, healthcheck, same project name. Start Redis **only** when this switch is on. Do not start an idle Redis when the switch is off.

**Rejected:** keep the engine validation overlay; default-on Redis for all consumers.

### HTTP mode

**Chosen rule:** in task 2, measure cold `medusa build` + `medusa start` and `next build` + `next start -p 8000`. If **total** cold time is **under 10 minutes**, use production mode (Cal/Documenso bar). If it is 10 minutes or more, use `medusa develop` / `next dev --turbopack -p 8000` and write the measured times plus the reason into this plan (section 5) and the README.

Develop-mode probe (not the production gate): backend ready about 19.6 s; Next ready 1.8 s plus 9.2 s first page compile.

Logs: `.harness/medusa-backend.log`, `.harness/medusa-storefront.log`. Pids: `.harness/medusa-backend.pid`, `.harness/medusa-storefront.pid`. `down()` stops only those trees (Documenso pid helper), then `composeDown` without `-v`. Never kill foreign listeners.

Health: `GET {baseUrl}/health` status **=== 200**. Storefront: `GET {storefrontUrl}/dk` === 200. Wait budget: floor 2 minutes until production times replace it.

### Opt-in switches (harness `.env`, default off)

| Switch | When on | Compose | Backend config / env |
|---|---|---|---|
| *(none)* | Default | Postgres only | Tracked `medusa-config.ts` behaviour via built server; fake Redis (ADR 0001). |
| `MEDUSA_REDIS=1` | P2, P6, webhook cases | `redis:7` @ `127.0.0.1:6380` | `projectConfig.redisUrl`; register Medusa **Redis** event-bus, cache, and workflow-engine modules (exact `resolve` paths from `@medusajs/medusa` 2.21.2 docs or package exports). Set `REDIS_URL` in gitignored backend `.env`. |
| `MEDUSA_STRIPE=1` | Stripe webhook / payment tests | No extra service | Register `@medusajs/medusa/payment-stripe`; forward `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` from harness `.env` into gitignored backend `.env`; storefront `NEXT_PUBLIC_STRIPE_KEY` when storefront runs. `seed()` enables **`pp_stripe_stripe`** on the Europe region when the secret key is set. Document local webhook forwarding: Stripe CLI → `http://127.0.0.1:9000/hooks/payment/stripe_stripe`. |

Unit tests: pure helpers for each switch (compose file list, env lines written, module list in generated config, stripe provider enable predicate). No live Redis/Stripe in unit tests.

README section **Which project turns on what** (task 4 or 6): **P1** — neither switch; **P2 / P6** — `MEDUSA_REDIS=1`; webhook / payment cases — `MEDUSA_REDIS=1` and `MEDUSA_STRIPE=1`.

### Config without editing tracked fork files (investigate in task 4)

Fork constraint: after `node scripts/up.mjs medusa`, `git -C medusa-dtc-starter status --short` must be **empty** (no modified tracked files, no new tracked paths). Harness may write only gitignored product paths (`.env`, `.medusa/**`, `apps/storefront/.env.local`).

**Evidence (framework 2.21.2, verified in `node_modules` on this PC):**

| Approach | Result |
|---|---|
| `MEDUSA_CONFIG` / CLI `--config` | **Not found** in `@medusajs/cli@2.21.2` `create-cli.js` (no config path flag on `build` / `start` / `develop`). |
| Official merge of a second config file | **Not found.** `@medusajs/utils` `get-config-file.js` loads `require(join(rootDir, "medusa-config"))` only. No documented override filename. |
| `REDIS_URL` / env-only module registration | **Insufficient.** Task 2 proved `REDIS_URL` alone does not set `projectConfig.redisUrl`; modules (Stripe, Redis bus) need a `modules` block in config. |
| New file `apps/backend/medusa-config.js` | **Dirty tree.** Not gitignored; would appear as `??` in `git status`. **Do not use.** |
| Gitignored `.medusa/server/medusa-config.js` | **Candidate.** `apps/backend/.gitignore` ignores `.medusa`. Production start cwd is `.medusa/server` (task 2). A `medusa-config.js` already exists there after `medusa build`. Harness can **regenerate** that file from a **tracked harness template** (`docker/medusa.harness-config.mjs` or similar) immediately before `node …/cli.js start`, merging tracked defaults plus switch-dependent `projectConfig` / `modules`. `medusa db:migrate` and `medusa build` keep using tracked `medusa-config.ts`; runtime start uses the gitignored generated file. |

**Task 4 gate:** implement the candidate; boot with `MEDUSA_REDIS=1` and grep logs for absence of `redisUrl not found` / `Local Event Bus`; boot with `MEDUSA_STRIPE=1` and confirm `pp_stripe_stripe` in admin region providers after seed; **`git status --short` empty** after each `up`. If the candidate fails (e.g. start ignores overwritten `medusa-config.js`), **stop task 4** and report the three rows above plus boot logs — do not edit tracked `medusa-config.ts`.

### seed() — full (task 3)

**Chosen:** all steps idempotent with **presence checks** (admin API or SQL). `up()` may still run `medusa db:migrate`; `seed()` owns the rest.

1. Admin user: `medusa user` only if `MEDUSA_ADMIN_EMAIL` is absent (exit 1 if duplicate — skip).
2. Publishable key: read from DB; redact in logs; write gitignored storefront env when task 5 exists.
3. **German Warehouse** (Berlin, `de`): create if missing; **inventory levels** for all variants at that location; **sales-channel** link to default channel.
4. **One collection** containing the **four** seeded products (home rail / storefront collections).
5. **One promo code** (e.g. `QA10`, **10%** off) with presence check.
6. **One customer** account (email/password from harness env or fixed fixture).
7. **Second region** (e.g. **US** / `usd`) with presence check; do not remove Europe.

Do not run `seed-demo-products.ts`. Paste measured admin API durations into this plan after task 3.

P1 storefront smoke URL remains **`/dk/products/t-shirt`** (README). This repo does not add Playwright.

### Publishable key redaction

`scripts/lib.mjs` `redactSecret` keeps 8 + 4 characters. That is too much of a `pk_` token for logs. Add a helper in `src/adapters/medusa-env.ts` (for example `redactPublishableKey`) used by seed and smoke. Unit tests: a realistic-length `pk_` value never appears in the returned string; empty and short inputs; the helper must not throw. Never write the token into README examples (placeholder only).

### Stripe + German admin (task 4)

Stripe follows the config overlay above and `MEDUSA_STRIPE=1`. Smoke with the switch **off** still passes on `pp_system_default`. With the switch **on**, seed enables `pp_stripe_stripe` on the Europe region when `STRIPE_API_KEY` is set in harness `.env` (test keys only in `.env.example` comments).

German admin: README-only (probe §3.4 — Deutsch in dashboard language combobox; starter `src/admin/i18n` exports `{}`).

### Env contract (`.env.example`)

- `MEDUSA_PRODUCT_DIR` (default `../products/medusa-dtc-starter`)
- `MEDUSA_BASE_URL=http://127.0.0.1:9000`
- `MEDUSA_STOREFRONT_URL=http://127.0.0.1:8000`
- `MEDUSA_DB_URL=postgres://medusa:medusa@127.0.0.1:5433/medusa`
- `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` (required for authenticate; empty in the example)
- `MEDUSA_PUBLISHABLE_API_KEY` (optional override; empty in the example)
- `MEDUSA_SKIP_WEB_START`, `MEDUSA_SKIP_STOREFRONT`, wait/build timeouts
- `MEDUSA_REDIS=1`, `MEDUSA_STRIPE=1` (opt-in; default unset/off)
- `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_KEY` optional and commented. No real keys in the repo.

Bootstrap gitignored `apps/backend/.env` from the template and overwrite `DATABASE_URL` (and `REDIS_URL` if Redis is actually wired). Storefront: gitignored `apps/storefront/.env.local`. Never commit those files. Never log secrets.

### Per-task gate

Every task from 2 to 6:

- Unit tests for new pure helpers (node:test, offline)
- `npm run check`
- Two live cycles: **fresh volumes** (`down -v` then up/smoke) and **kept volumes** (`down` then up/smoke again)

Task 2, before `seed()` exists: the live cycles are `up` → `waitHealthy` → `down`, not full `npm run smoke -- medusa`. From task 3, the live cycles are `npm run smoke -- medusa`. No CodeRabbit CLI. No merge. No tag.

## 5 Production boot times (fill in task 2)

Measured 2026-10-15 on this PC (Node v24.21.0, pnpm 10.11.1). One run each. Wall clock is the stopwatch around the command, not the CLI's internal timer.

| Step | Duration | Label |
|---|---|---|
| `pnpm medusa build` (apps/backend) | **94.918 s** (94918 ms), exit 0. CLI also printed backend 51.32 s and frontend 78.66 s; those overlap inside the wall clock. | verified |
| `medusa start` until `GET http://127.0.0.1:9000/health` 200 | **8.169 s** (8169 ms). Medusa logged `Server is ready on port: 9000 – 4890ms`. | verified |
| `pnpm next build` (apps/storefront) | **71.444 s** (71444 ms), exit 0. A later rebuild with the real publishable key was 31.513 s and is not this cold number. | verified |
| `pnpm next start -p 8000` until `GET http://127.0.0.1:8000/dk` 200 | **6.776 s** (6776 ms), after the keyed rebuild. | verified |
| Total cold build + start | **181.307 s** (181307 ms), about 3 min 1 s | verified |
| Mode chosen | **production** (`medusa build` + `medusa start`). Total is under 10 minutes. | verified |

`pnpm install` warned that build scripts for `sharp`, `@swc/core`, and `esbuild` were ignored. `pnpm approve-builds` and `pnpm rebuild` were not run. Build, start, `next build`, and `next start` all exited 0 anyway. Those three packages are not approved.

`pnpm medusa start` with cwd `apps/backend` exited 1: `Could not find index.html in the admin build directory`. The admin output is `apps/backend/.medusa/server/public/admin/index.html`, and the loader joins `./public/admin` onto the process cwd. The harness starts `node apps/backend/node_modules/@medusajs/cli/cli.js start` with cwd `apps/backend/.medusa/server`. That directory is not a pnpm workspace package, so `pnpm medusa start` cannot see the `medusa` bin there.

Redis check, same start, `REDIS_URL=redis://127.0.0.1:6380` in the gitignored backend `.env`, no Redis container: the log said `redisUrl not found. A fake redis instance will be used.` and `Local Event Bus installed.` Compose does not start Redis. See `docs/adr/0001-medusa-fake-redis.md`.

Live cycles after that measurement (adapter `up` / `down`, volumes):

- Fresh: `docker compose ... down -v`, then `node scripts/up.mjs medusa` exit 0 in **124.830 s** (124830 ms). That run rebuilt because a hand-written build marker had a BOM; migrate **29.1 s**, build **70.6 s**, spawn to HTTP 200 **10.8 s**. `GET /health` after the CLI exited was HTTP 200, body `OK`.
- `down` of that process exited 1 in 16.111 s. The recorded pid was a cmd wrapper (`shell: true`), and `taskkill /T` left the node listener on port 9000. Fixed by spawning `node.exe` with `shell: false` and `detached: true`. The leftover listener was the harness server and was killed before the retry.
- Kept volumes, after the fix: `up` exit 0 in **36.398 s**, `GET /health` after the CLI exited HTTP 200; `down` exit 0 in **1.909 s**, port 9000 free, volume `qa-harness-medusa_medusa_harness_pg` still present; `up` again exit 0 in **40.260 s**, `GET /health` after the CLI exited HTTP 200. Build skipped (marker matched `f677db4`).
- Build marker moved to `apps/backend/.medusa/server/harness-build.json` (**14587db**). Fresh-volume pid proof: `down -v`, `up` **97.216 s** (build **40.0 s** after absent marker), `down` **2.902 s** port free, `up` **35.956 s** with build skipped.

## 6 Task breakdown

### Task 2: adapter up/down — **done**

Commits on branch through **`14587db`**: compose Postgres only; env bootstrap; migrate in `up()`; production start from `.medusa/server`; health 200; pid `down`; ADR 0001; harness-build skip marker.

### Task 3: full seed

Implement `seed()` per section 4 (German Warehouse + inventory + channel link, collection, `QA10`, customer, US region). Unit tests for presence predicates and idempotency helpers. `npm run check`. Two live `npm run smoke -- medusa` cycles (fresh `down -v` then kept volumes). Paste API timings into this plan.

### Task 4: Redis + Stripe switches + German admin docs

Wire `MEDUSA_REDIS=1` / `MEDUSA_STRIPE=1` (default off). Compose Redis only when Redis switch on. Generated gitignored `.medusa/server/medusa-config.js` per section 4; prove clean product `git status` after `up`. Unit tests for switch parsing, env builder, generated module list. README: Deutsch admin path; **Which project turns on what**; Stripe CLI webhook URL. Update `.env.example`. Revise ADR 0001 or add ADR note that real Redis is opt-in. Stop with evidence if config overlay fails.

### Task 5: storefront

Spawn storefront on 8000. Gitignored `.env.local` (backend URL, publishable key, Stripe publishable when switch on). `GET /dk` 200. `MEDUSA_SKIP_STOREFRONT=1`. Two smoke cycles.

### Task 6: proveAuth, smoke matrix, release

`proveAuth()`: `GET /admin/users/me`, email matches. Run `npm run smoke -- medusa` with switches **off**, then **Redis on**, then **Redis + Stripe on** (and off again if needed for regression). CHANGELOG; README polish; `package.json` **0.2.9**. Two fresh/kept volume smokes for the default (off) path. Prepare tag commands; Jayami tags after merge. Push branch when asked.

## 7 Files to touch (tasks 3–6)

- `src/adapters/medusa.adapter.ts`, `medusa-env.ts`, `medusa-env.test.ts`, pid helper
- `docker/medusa.compose.yml` (+ optional Redis service when switch on)
- `docker/medusa.harness-config.mjs` (or `.ts`) — **tracked** template for generated gitignored server config
- `src/config.ts`, `.env.example`
- `README.md` (storefront, switches, **Which project turns on what**, German admin)
- `docs/adr/0001-medusa-fake-redis.md` (opt-in Redis note) or follow-up ADR
- `CHANGELOG.md`, `package.json`, lockfile (task 6)
- This plan (timings after task 3)

No changes: Cal, Documenso, Twenty adapters; tracked files under `products/medusa-dtc-starter`.

## 8 Risks

- pnpm ignored build scripts may break production build. Approve only proven packages, harness-side.
- `medusa user` is not idempotent (exit 1). Skip when the email exists.
- Home has no products without a collection. Seed creates one via admin API. P1 still uses `/dk/products/t-shirt`.
- Stripe may be impossible without editing `medusa-config.ts`. Task 4 stops and reports.
- Fake Redis is the default; P2/P6 must set `MEDUSA_REDIS=1` or webhook tests stay in-process.
- Generated `.medusa/server/medusa-config.js` must be rewritten whenever switches change; if start still reads stale config, force rebuild or document order of operations.
- Next.js prints the publishable key. Harness must still redact its own logs. Unit-test the helper.
- After the rewrite, `MEDUSA_PRODUCT_DIR` pointing at `../products/medusa` must fail clearly.
- Production boot times are unknown until task 2. The 10 minute rule decides the mode.
- Sequential Medusa RSS about 2 GB in develop. Do not stack it with Twenty on a small runner.

## 9 Verification (each of tasks 2-6)

This repo has no ESLint or Prettier. Mirror CI with `npm run check`.

1. `npm test` (includes new Medusa helper tests)
2. `npm run check`
3. Live cycles labelled fresh vs kept volumes (task 2: up/health/down; task 3+: `npm run smoke -- medusa`)
4. Report SHA, elapsed healthy, elapsed seed when it exists. Label ENVIRONMENT / TEST BUG / PRODUCT BUG if a cycle fails.
5. No CodeRabbit CLI. No merge. No tag.

## 10 Commit plan

1. `docs(plan): harness v0.2.9 Medusa adapter` — done (`632d9e9`)
2. Task 2 — done (`cef2965`, `f99f94d`, `14587db`)
3. `docs(plan): full Medusa v0.2.9 switches and task order` (this revision)
4. Task 3 seed
5. Task 4 switches + overlay + README
6. Task 5 storefront
7. Task 6 smoke matrix + `chore(release): v0.2.9`

No commit on `main`.

## 11 Will not do

Fork edits (dtc-starter and engine). Default `down -v`. Harness CI Docker live smoke. Real Stripe keys. Printing the publishable key. CodeRabbit CLI. Merge, tag, or PR without Jayami.

## 12 Open questions

- Task 4 must confirm the **gitignored `.medusa/server/medusa-config.js`** overlay at runtime (see section 4 table). If it fails, stop and report; do not edit tracked `medusa-config.ts`.
- Exact Medusa 2.21.2 `modules` `resolve` strings for Redis event bus, cache, and workflow engine (copy from official docs or package exports during task 4).
