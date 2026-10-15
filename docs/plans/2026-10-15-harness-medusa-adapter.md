# Harness v0.2.9 Medusa adapter

## 1 Header

- Repo: `qa-portfolio-harness` · [Jayami123/qa-portfolio-harness](https://github.com/Jayami123/qa-portfolio-harness) · harness
- Branch: `feat/2026-10-15-harness-medusa-adapter` from `main` at **742c651**. Do not commit on `main`. Target **v0.2.9**. Do not merge, tag, or open a PR without Jayami's go-ahead.
- Package version today: `0.2.8`. Tag `v0.2.8` is two docs commits behind HEAD.
- Product (read-only, never edit): `D:\Jayami\Portfolio\products\medusa-dtc-starter` · [Jayami123/medusa-dtc-starter](https://github.com/Jayami123/medusa-dtc-starter) HEAD **`f677db438f27294fc50e4c7c6612e71ff38eeff5`** (`f677db4`, 2026-10-09, upstream `fix/remove-static-params`). Pin this SHA in the README when the adapter lands.
- Engine fork `D:\Jayami\Portfolio\products\medusa` stays untouched. After this rewrite the adapter must not read `scripts/portfolio-validation`, MinIO, or that folder.
- Date: 2026-10-15. Probe ran against a scratch clone of the same SHA; that scratch clone is deleted after this plan commit. An ADR for fake Redis is written in task 2 if Redis stays unwired.
- Start and stop Medusa only through `node scripts/up.mjs medusa` and `node scripts/down.mjs medusa` once the adapter exists. Reset volumes with a documented `down -v`, not by editing the fork.

Labels in this file: **verified** (this session's probe, 2026-10-15), **inferred**, **NOT MEASURED**.

## 2 Goal and scope

The adapter exists (`src/adapters/medusa.adapter.ts`) but targets the engine monorepo: `up()` starts validation Postgres/Redis/MinIO only, HTTP is not started, `seed()` throws. The live product is the DTC starter (`apps/backend` + `apps/storefront`).

**In scope:** rewrite the adapter to the Documenso bar against `medusa-dtc-starter`; harness-owned Postgres 15; spawn backend :9000 and storefront :8000; `GET /health` HTTP 200; idempotent seed (migrate, admin user, collection, second stock location); redacted publishable key; German admin documented from the probe; Stripe only if a config overlay works without editing tracked fork files; unit tests; CHANGELOG, README, version 0.2.9; two live smokes per task (fresh volumes, then kept volumes).

**Out of scope:** any edit of `medusa-dtc-starter` or `products/medusa`; Cal/Documenso/Twenty adapters; P1 Playwright (README may record that future storefront smoke uses `/dk/products/t-shirt`); harness CI Docker live smoke; real Stripe live keys; CodeRabbit CLI; merge, tag, or PR.

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
  compose[composeUp postgres 15 and redis only if wired]
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

**Chosen:** rewrite `docker/medusa.compose.yml` as harness-owned: `postgres:15`, user/pass/db `medusa`/`medusa`/`medusa`, host port `127.0.0.1:5433`, healthcheck `pg_isready`. Drop MinIO.

Redis: industry standard is a real Redis for the event bus and cache so webhook and subscriber tests see async behaviour. Start `redis:7` on `127.0.0.1:6380` **only if** env alone makes Medusa use it (`REDIS_URL` or whatever the framework reads without editing `medusa-config.ts`). The probe already showed `redisUrl not found` with `REDIS_URL` set. Task 2 re-checks once against `medusa start` (not only `develop`). If it still ignores the env, **do not start an idle Redis**, and record "fake Redis in use" in the README and an ADR.

**Rejected:** keep the engine overlay; start Redis that the app never opens.

### HTTP mode

**Chosen rule:** in task 2, measure cold `medusa build` + `medusa start` and `next build` + `next start -p 8000`. If **total** cold time is **under 10 minutes**, use production mode (Cal/Documenso bar). If it is 10 minutes or more, use `medusa develop` / `next dev --turbopack -p 8000` and write the measured times plus the reason into this plan (section 5) and the README.

Develop-mode probe (not the production gate): backend ready about 19.6 s; Next ready 1.8 s plus 9.2 s first page compile.

Logs: `.harness/medusa-backend.log`, `.harness/medusa-storefront.log`. Pids: `.harness/medusa-backend.pid`, `.harness/medusa-storefront.pid`. `down()` stops only those trees (Documenso pid helper), then `composeDown` without `-v`. Never kill foreign listeners.

Health: `GET {baseUrl}/health` status **=== 200**. Storefront: `GET {storefrontUrl}/dk` === 200. Wait budget: floor 2 minutes until production times replace it.

### seed()

**Chosen:**

1. `medusa db:migrate` (idempotent via `script_migrations`).
2. `medusa user` only if `public.user` has no `MEDUSA_ADMIN_EMAIL`. Second create exits 1.
3. Capture the publishable token from `api_key` (type `publishable`, not revoked). Pass it into storefront env and `AuthSession.raw` as needed. Log only a redacted form. Persist by telling the operator to set `MEDUSA_PUBLISHABLE_API_KEY`. Never print the full token.
4. If collections count is 0: `POST /admin/product-collections` and attach the four seeded products so `/dk` can show a rail. Do not run `seed-demo-products.ts`.
5. Second stock location: create `German Warehouse`, Berlin, `de` if a location with that name is missing. Then inventory levels for existing items at that location, and a sales-channel link. Presence check so a second `seed()` is a no-op. Measure those extra calls in task 3 and paste durations into this plan.

P1's future storefront smoke targets **`/dk/products/t-shirt`**, not the home rail. Record that in the README P1 notes. This repo does not add Playwright.

### Publishable key redaction

`scripts/lib.mjs` `redactSecret` keeps 8 + 4 characters. That is too much of a `pk_` token for logs. Add a helper in `src/adapters/medusa-env.ts` (for example `redactPublishableKey`) used by seed and smoke. Unit tests: a realistic-length `pk_` value never appears in the returned string; empty and short inputs; the helper must not throw. Never write the token into README examples (placeholder only).

### Stripe (task 4)

Do not edit tracked fork files. Investigate, in this order, with evidence (CLI help, framework source file:line, or a live boot log):

1. Medusa CLI `--config` / `MEDUSA_CONFIG` pointing at a **harness-owned** file that imports the fork `defineConfig` and adds the Stripe payment module.
2. An untracked override file the official loader merges (only if the loader documents it).
3. Env-driven module registration with no config file change.

If a method works without touching tracked files, use it. Forward `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_KEY` from the harness `.env` into gitignored product env. Enable `pp_stripe_stripe` on the region only when the secret key is set. Smoke without those vars still passes on `pp_system_default`.

If none works, **stop task 4** and report the three options with the evidence. Do not invent a fourth path.

German admin is README-only (probe already proved Deutsch is in the combobox).

### Env contract (`.env.example`)

- `MEDUSA_PRODUCT_DIR` (default `../products/medusa-dtc-starter`)
- `MEDUSA_BASE_URL=http://127.0.0.1:9000`
- `MEDUSA_STOREFRONT_URL=http://127.0.0.1:8000`
- `MEDUSA_DB_URL=postgres://medusa:medusa@127.0.0.1:5433/medusa`
- `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` (required for authenticate; empty in the example)
- `MEDUSA_PUBLISHABLE_API_KEY` (optional override; empty in the example)
- `MEDUSA_SKIP_WEB_START`, `MEDUSA_SKIP_STOREFRONT`, wait/build timeouts
- Stripe vars optional and commented. No real keys.

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

## 6 Task breakdown

### Task 2: adapter up/down

Rewrite `src/adapters/medusa.adapter.ts`. Add `src/adapters/medusa-env.ts` and `medusa-env.test.ts` (health 200 helper, URL 127.0.0.1, env builder, redaction helper tests can start here). Pid helper, same idea as Documenso. Rewrite `docker/medusa.compose.yml`. Change `src/config.ts` default product dir and `MEDUSA_BASE_URL`. Update `.env.example`.

`up()`: Node and pnpm gate; env bootstrap; compose `--wait`; pnpm rebuild of proven packages; measure build + start; spawn backend; `waitHealthy`. Storefront spawn can wait for task 5 if that keeps the diff small, as long as two live up/health/down cycles still run.

`down()`: stop pid trees, then composeDown.

Prove Redis: set `REDIS_URL`, boot, grep logs for `redisUrl not found` vs a real connection. Start `redis:7` only if wired. Otherwise ADR + README limitation.

Fill section 5 of this plan with the measured times.

### Task 3: seed

`seed()`: migrate; skip existing admin; collection via admin API; German Warehouse with inventory levels and sales-channel link; presence checks; capture and redact publishable key. Paste measured durations for the extra location calls into this plan. Full `npm run smoke -- medusa` twice.

### Task 4: Stripe overlay + German README

Investigate overlay (section 4). Stop if none is possible without tracked-file edits. README: Deutsch path from the probe. No live Stripe charge in harness CI.

### Task 5: storefront

Spawn storefront on 8000. Write `.env.local` with backend URL and publishable key (not logged). Wait `GET /dk` 200. Optional `MEDUSA_SKIP_STOREFRONT=1`. README: P1 future smoke URL `/dk/products/t-shirt`.

### Task 6: proveAuth, docs, version

`proveAuth()`: `GET /admin/users/me`, email matches. CHANGELOG, README, `package.json` and lock **0.2.9**. Two smokes. Push the branch. Prepare tag commands. Jayami tags after merge.

## 7 Files to touch (across 2-6)

- `docs/plans/2026-10-15-harness-medusa-adapter.md` (this file, commit 1)
- `docker/medusa.compose.yml` (rewrite)
- `src/adapters/medusa.adapter.ts` (rewrite)
- `src/adapters/medusa-env.ts`, `medusa-env.test.ts` (new)
- pid helper if not folded into the env module
- `src/config.ts`, `.env.example`
- ADR for fake Redis if Redis stays unwired (task 2)
- `README.md`, `CHANGELOG.md`, `package.json`, lockfile version (task 6)

No changes: Cal, Documenso, Twenty adapters; `src/wait/health.ts` defaults (Medusa passes `isOk`); `products/medusa`; tracked files under `products/medusa-dtc-starter`.

## 8 Risks

- pnpm ignored build scripts may break production build. Approve only proven packages, harness-side.
- `medusa user` is not idempotent (exit 1). Skip when the email exists.
- Home has no products without a collection. Seed creates one via admin API. P1 still uses `/dk/products/t-shirt`.
- Stripe may be impossible without editing `medusa-config.ts`. Task 4 stops and reports.
- Fake Redis: webhook and subscriber tests will not see a real bus until the fork or an overlay wires `redisUrl`.
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

1. `docs(plan): harness v0.2.9 Medusa adapter` (this file only)
2. Task 2 commits (compose, up/down, env, Redis decision, boot numbers)
3. Task 3 seed
4. Task 4 Stripe overlay or a stop report
5. Task 5 storefront
6. `chore(release): v0.2.9`

No commit on `main`. Auth and production-mode defaults wait for task 2 measurements.

## 11 Will not do

Fork edits (dtc-starter and engine). Default `down -v`. Harness CI Docker live smoke. Real Stripe keys. Printing the publishable key. CodeRabbit CLI. Merge, tag, or PR without Jayami.

## 12 Open questions

None that block this plan commit. Task 2 still has to fill section 5 and the Redis/ADR fork. Task 4 still has to prove or reject a Stripe overlay.
