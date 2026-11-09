# Harness requests from P5: probe and plan (v0.3.1 base)

Status: PLAN ONLY. No code, compose, script or package file changes in this document's change set.

- Base: `origin/main` at `7d4a3ae` (`v0.3.1` resolves to `88827e4`, an annotated tag object; its commit is an ancestor of `7d4a3ae`).
- Branch: `docs/2026-11-10-harness-p5-requests`.
- Source of the requests: `appsec-devsecops-pipeline` `docs/plans/2026-11-08-p5-master-plan.md` at `298ae29`, cited as `MP:<line>`. Section 11 is at `MP:800-807`.
- Probe record: Appendix A (in this file).

## 0. Summary of statuses

| # | Request | Status at v0.3.1 | Evidence |
|---|---|---|---|
| 1 | Opt-in `LOGIC_FUNCTION_TYPE` pass-through (Twenty) | CONFIRMED (absent) | `src/adapters/twenty-passthrough.ts:9-16`; no match in `src/` |
| 2 | Opt-in `MEDUSA_FF_RBAC` pass-through (Medusa backend) | CONFIRMED (absent) | `src/adapters/medusa-env.ts` has no such name; backend env is the written `apps/backend/.env` (`medusa.adapter.ts:252-274`, `:276-281`) |
| 3a | Fresh-stack guarantee after `down` | CONFIRMED by source; live before/after NOT run | `docker/twenty.compose.yml`, upstream `docker-compose.yml:128-137`, `twenty.adapter.ts:180-191` |
| 3b | Product-scoped limiter reset | CONFIRMED by source (store identified); live counter keys UNPROBED | `usage-limit-definitions.constant.ts:19-46`, `build-speed-bucket-key.util.ts`, `cache-storage-namespace.enum.ts` |
| 4 | `PRODUCTS_ROOT` default outside `node_modules` | CONFIRMED | `src/config.ts:151`, `src/paths.ts:3-5` |
| 5 | Cal `.env` provisioning | CONFIRMED, with one qualification | `src/adapters/cal.adapter.ts:492-495`, `:646-648`; `scripts/cloud-install.sh:104-119` writes it at install time |
| 6 | Opt-in synthetic canary pass-through (Twenty server and worker) | CONFIRMED (absent) | no canary name or pattern in `src/` |

No item is CONTRADICTS. No STOP condition was hit.

Citation corrections (not contradictions):

- `MP:800-807` item 2 cites `medusa.adapter.ts:276-282`. The backend `.env` read is at `:276-281`, and `medusa.adapter.ts:527` (cited in the request notes) is the storefront `.env.local` writer (`writeStorefrontEnv`, `:508-529`), not the backend env. The backend env write is at `:272`.
- Item 5 says the harness writes `.env` for Documenso, Medusa and Twenty but not Cal. That holds for the runtime path (`up()`), but `scripts/cloud-install.sh:104-119` (`prepare_cal_env`) does write a Cal root `.env` at install time, with generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`. The gap is that `up()` does not provision it. Section 5 designs the fix with that in mind.

---

## 1. Requests, one section each

### 1.1 Opt-in `LOGIC_FUNCTION_TYPE` pass-through for Twenty (MP:802)

**Current behaviour at v0.3.1.**

- `src/adapters/twenty-passthrough.ts:9-16` lists six names: `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`, `IS_BILLING_ENABLED`, `IS_MULTIWORKSPACE_ENABLED`, `BILLING_STRIPE_API_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET`, `BILLING_STRIPE_PUBLISHABLE_KEY`. `LOGIC_FUNCTION_TYPE` is not among them. `grep -rn LOGIC_FUNCTION src/` finds nothing.
- The override is written by `src/adapters/twenty-runtime-override.ts` (`twentyRuntimeOverrideYaml`, mapping form `NAME:` with no value, so compose takes the value from the environment of `up`). It is written by `writeTwentyRuntimeOverride` at `twenty.adapter.ts:154`.
- Upstream default at Twenty `7cbdfec6` (`packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts:732-735`): `LOGIC_FUNCTION_TYPE = process.env.NODE_ENV === DEVELOPMENT ? LOCAL : DISABLED`. The enum is `DISABLED | LAMBDA | LOCAL` (`logic-function-driver.interface.ts:74-78`). `@CastToUpperSnakeCase()` means `local` is accepted.

**Proposed opt-in design.** Unset or blank means no change.

- Add `LOGIC_FUNCTION_TYPE` to `TWENTY_PASSTHROUGH_ENV`.
- Validate the value before any disk write: after upper-casing, it must be one of `DISABLED`, `LAMBDA`, `LOCAL`. Any other non-blank value throws `TWENTY_LOGIC_FUNCTION_TYPE_INVALID` naming the variable and the allowed values. Validation runs in `writeTwentyRuntimeOverride` before `fsImpl` is touched, matching the rate-limit pattern in `twenty-rate-limits.ts`.
- The override keeps the mapping form `LOGIC_FUNCTION_TYPE:` with no value. No value is written to disk.

**Exact files and tests to change in the later build.**

- `src/adapters/twenty-passthrough.ts`: add the name.
- `src/adapters/twenty-passthrough.test.ts`: update the ordered-list assertion (`lists each forwarded name once, in the confirmed order`) and add the upstream line reference.
- `src/adapters/twenty-runtime-override.ts`: value validation for `LOGIC_FUNCTION_TYPE` (new function `readTwentyLogicFunctionType`).
- `src/adapters/twenty-runtime-override.test.ts`: cases for set, unset, blank, lowercase `local`, and an invalid value (no fs call on the invalid path).
- No compose change. No ADR needed (no product default changes).

**Acceptance tests.**

- Unit (`node:test`): with `LOGIC_FUNCTION_TYPE=local`, the rendered override contains `LOGIC_FUNCTION_TYPE:` under both `server` and `worker`; with it unset, the override has no such key; with it blank, same as unset; with `bogus`, the call throws before any file write.
- Live (`node scripts/up.mjs twenty`, then `node scripts/smoke.mjs twenty`, then `node scripts/down.mjs twenty` in a `finally`): with `LOGIC_FUNCTION_TYPE=local` in the `up` environment, `docker compose -p qa-harness-twenty exec -T server printenv LOGIC_FUNCTION_TYPE` prints `local`. Unset: `printenv` exits 1. The value is not secret, so it may be printed.

**README and CHANGELOG text (draft).**

> Twenty: opt-in `LOGIC_FUNCTION_TYPE` is forwarded to the server and worker by name, when set to a non-blank value. The value must be `DISABLED`, `LAMBDA` or `LOCAL` (case-insensitive). Unset passes nothing, so the upstream default applies (`LOCAL` only when `NODE_ENV` is development, else `DISABLED`).

**Backward compatibility (P1, P2, P6).** Unset passes nothing: no change for P1 (pins v0.3.0), P2 (pins v0.3.1) or P6 (pins v0.2.18). A consumer who already exports `LOGIC_FUNCTION_TYPE` in its shell would now see it forwarded; that is the intended opt-in, and the note should say so in the CHANGELOG.

---

### 1.2 Opt-in `MEDUSA_FF_RBAC` pass-through for the Medusa backend (MP:803)

**Current behaviour at v0.3.1.**

- The backend environment is the file the harness writes: `writeBackendEnv` (`src/adapters/medusa.adapter.ts:252-274`) builds `apps/backend/.env` from `apps/backend/.env.template` through `buildMedusaBackendEnvFile` (`src/adapters/medusa-env.ts:241-249`), which upserts only `DATABASE_URL`, `REDIS_URL`, `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `backendProcessEnv` (`medusa.adapter.ts:276-281`) parses that file and is the env for `medusa start` (`:941`), for the second backend (`:1033`) and for `pnpm` runs (`:387`). It does not merge `process.env`, so a shell `MEDUSA_FF_RBAC=true` never reaches the backend.
- `grep -rn MEDUSA_FF_RBAC src/` finds nothing.
- Upstream: `@medusajs/medusa@2.21.2` `dist/feature-flags/rbac.js` defines `key: "rbac"`, `default_val: false`, `env_key: "MEDUSA_FF_RBAC"`. `@medusajs/utils` `register-flag.js:16-19` reads `process.env[env_key]` with `isTruthy`, and logs `Using flag MEDUSA_FF_RBAC from environment with value ...` (`:34`).

**Proposed opt-in design.** Unset or blank means no change to the written `.env`.

- Add an optional input `ffRbac?: "true" | "false"` to `MedusaBackendEnvInput`. The value comes from `process.env.MEDUSA_FF_RBAC` when it is exactly `true` or `false`; any other non-blank value throws `MEDUSA_FF_RBAC must be "true" or "false"` before the file is written.
- `buildMedusaBackendEnvFile` sets the line only when the input is defined. Unlike the existing `upsertEnvLine` with `undefined` (which deletes the line), an unset input leaves the template line as it is. This keeps "unset means no change" literal even when the template contains `MEDUSA_FF_RBAC`.

**Exact files and tests to change in the later build.**

- `src/adapters/medusa-env.ts`: new input field and an `upsertEnvLine` variant that never deletes.
- `src/adapters/medusa-env.test.ts`: set `true` writes `MEDUSA_FF_RBAC=true`; unset leaves a template line untouched; `false` writes `false`; invalid throws.
- `src/adapters/medusa.adapter.ts`: pass the validated value from `writeBackendEnv` (`:260-270`).
- `src/adapters/medusa.adapter.test.ts`: the written file contains the line when set.
- README section "Which project turns on what" (`README.md` around line 403).

**Acceptance tests.**

- Unit: as above.
- Live (`up medusa`, `smoke medusa`, `down medusa` in `finally`): with `MEDUSA_FF_RBAC=true` in the `up` environment, the backend start log contains `Using flag MEDUSA_FF_RBAC from environment with value true` (from `@medusajs/utils` `register-flag.js:34`), and `GET $MEDUSA_BASE_URL/health` returns 200. The RBAC route behaviour is not part of this request; the flag reading on is the acceptance.

**README and CHANGELOG text (draft).**

> Medusa: opt-in `MEDUSA_FF_RBAC` (`true` or `false`) is written into the harness-generated backend `.env`. Unset leaves the file unchanged, so Medusa's default (`false`) applies.

**Backward compatibility.** Unset: byte-identical `apps/backend/.env` output for P1, P2 and P6. Covered by a golden-output unit test on the default path.

---

### 1.3 Fresh-stack and product-scoped limiter fresh-state contract (MP:804), Twenty first

**Current behaviour at v0.3.1.**

- Only a whole-stack reset exists: `down()` keeps volumes; `TWENTY_DOWN_VOLUMES=1` runs `docker compose ... down -v` (`src/adapters/twenty.adapter.ts:180-191`). The reset command appears in `twenty-env.ts:137-141` and the volume-refusal message at `:215-219`; the seed-failure message at `:246-253` names `TWENTY_DOWN_VOLUMES=1`.
- Redis, which holds the limiter counters, has no named volume. Upstream `packages/twenty-docker/docker-compose.yml:128-137` defines `redis` with `image: redis`, no `volumes:`. The only named volumes are `db-data` and `server-local-data` (`:139-140`). Counters therefore live in the container's writable layer and are removed with the container.
- Upstream compose stacks are the same in the harness overlay (`docker/twenty.compose.yml` does not touch `redis`).

**(a) Fresh-stack guarantee (documented and to be tested).**

Source-level result, to be confirmed by the live test below:

- `up` after `down` (no `-v`): Postgres `db-data` persists (workspace rows, API keys, `core."usageLimit"` rows). Redis is recreated, so every speed counter starts empty. A fresh limiter therefore exists for the whole stack, but the database is not fresh.
- `up` after `down -v` (`TWENTY_DOWN_VOLUMES=1`): both persist-volumes are removed; the next `up` reseeds through `seed()`. Redis is also fresh. The existing `packages/twenty-docker/.env` keys are kept (the bootstrap writes new keys only when missing or placeholder and volumes do not exist, `twenty-env.ts:196-240`).

The guarantee to document: "After `down` with no `-v`, the Redis-backed limiter counters are empty; the database is unchanged. After `down -v`, both are empty." A first non-429 is not evidence of this (MP:804).

Test to add: `src/adapters/twenty-env.test.ts` for the `down` argv (with and without `-v`), and a live test (`up`, exhaust, `down`, `up`, control) in the later build.

**(b) Product-scoped limiter reset: backing store identified from source.**

- Limiter counters for the public API go through `UsageLimitSpeedService` (`engine/core-modules/usage-limit/services/usage-limit-speed.service.ts:37-38`, cache namespace `EngineUsageLimit`) and a token-bucket Lua script (`try-consume-token-buckets-script.constant.ts`, invoked at `:186-196`).
- Namespace `EngineUsageLimit = 'engine:usage-limit'` (`cache-storage-namespace.enum.ts`). The key is `engine:usage-limit:<bucket key>` (`cache-storage.service.ts` `getKey`, `:482-488`).
- Bucket key (`usage-limit/utils/build-speed-bucket-key.util.ts`): `{<scope>}:speed:<resourceType>:<operationType>:<spenderType>:<spenderId or '-'>:<windowSeconds>`, where `scope` is the workspace id for `perWorkspace` and `server` for `crossWorkspace`.
- Defaults (`usage-limit-definitions.constant.ts:19-46`): `apiKey` short 100/1000 ms and long 100/60000 ms, per workspace, `spenderId: ''`; `application` 500/60000 ms, `crossWorkspace`. The fork's defaults are at `config-variables.ts:1713-1757` (the request's range), matching `7cbdfec6`.
- Because the `apiKey` spender id is empty, its key is `{<workspaceId>}:speed:API:API_REQUEST:apiKey:-:<n>`. Counters are per workspace, not per API key.
- The `application` key is `{server}:speed:API:API_REQUEST:application:-:<n>`, shared across all workspaces.
- The unrelated `ThrottlerService` (`engine/core-modules/throttler/throttler.service.ts`) uses namespace `engine:workspace` for auth, invitation and some routes. It is out of scope for the public API limiter but is also Redis-backed.
- Existing scoped helper: `CacheStorageService.flushByPattern` (`cache-storage.service.ts:219-244`) does `SCAN MATCH <getKey(pattern)>` and `DEL`. `flush()` (`:215-217`) is `cache.reset()`, which is unscoped and must not be used.
- Harness Redis is internal to the `qa-harness-twenty` project (no host port in `docker/twenty.compose.yml`), so it is per product by construction.

**Proposed design.**

- A new harness helper `resetTwentyWorkspaceSpeedCounters({ workspaceId })` that deletes only the keys whose hash tag is `{workspaceId}` under `engine:usage-limit:`: `SCAN MATCH engine:usage-limit:{<workspaceId>}:speed:*` then `DEL`, run through `docker compose -p qa-harness-twenty exec -T redis redis-cli` (read-only `SCAN`, then targeted `DEL`). It takes a workspace id only from the caller, validates it as a UUID, and refuses `{server}`.
- The caller must create a disposable workspace for the run. Because the `apiKey` counter is per workspace, deleting its keys resets only that workspace's counters.
- Never touch `{server}` keys. The `application` counter is shared across workspaces; the reset does not cover it.

**Acceptance (MP:804 (a)-(d)), per adapter.**

- (a) On a named public API route (for example `GET /rest/people?limit=1`), with a disposable workspace's API key, exhaust the short bucket (100 per 1000 ms) and observe 429.
- (b) Call the helper for the disposable workspace id only. The `SCAN` before and after shows only `{<disposable>}` keys were deleted, and no other key changed (`TYPE` and `TTL` read-only before and after).
- (c) A same-route, same-key control returns 200 after reset, and after the window, a request that would have failed before the window is admitted (token refill observed).
- (d) A second, untouched workspace's control key stays 200 on the same route during and after the reset. Cross-product control: the Redis is per stack and the probe runs one product at a time, so the cross-product half is recorded as a separate sequential run in the later build. Until that exists, (d) is claimed for the in-stack control only.

Fresh-state rule: a first non-429 is not proof (MP:804). The acceptance check uses the 429-then-200 pair above.

**Files and tests.**

- `src/adapters/twenty-limiter-reset.ts` (new) and `src/adapters/twenty-limiter-reset.test.ts`: key builder, UUID and `{server}` refusal, `SCAN` pattern, no unscoped command.
- `src/adapters/twenty.adapter.ts`: expose the helper behind an explicit method, not from `up()` or `down()`.
- `src/adapters/twenty-env.test.ts`: `down` argv with and without `-v`.
- New ADR `docs/adr/0004-twenty-scoped-limiter-reset.md`: a destructive capability needs an ADR per CONTRIBUTING "Safety rules". No compose change; do not add a named Redis volume (that would change the container lifetime and needs ADR-level review on its own).

**README and CHANGELOG text (draft).**

> Twenty: `down` without `-v` removes the Redis container, so the API rate-limit counters start empty on the next `up`; the database is kept. `TWENTY_DOWN_VOLUMES=1` removes the database as well. A new helper resets the speed counters of one workspace id (UUID) and never touches the shared `{server}` application counter.

**Backward compatibility.** The helper is new and not called by `up`/`down`. No change for P1, P2 or P6. `down` behaviour is unchanged.

---

### 1.4 `PRODUCTS_ROOT` default outside `node_modules` (MP:805)

**Current behaviour at v0.3.1.**

- `src/config.ts:151`: `path.resolve(parsed.PRODUCTS_ROOT ?? path.join(HARNESS_ROOT, "..", "products"))`.
- `src/paths.ts:3-5`: `HARNESS_ROOT` is the package root, derived from `import.meta.url` of `paths.js`.
- Consumer install (`github:Jayami123/qa-portfolio-harness#vX`): the package sits at `node_modules/qa-portfolio-harness`, so the default resolves to `node_modules/products`. Confirmed by reading the code path; no consumer install was run.
- The README table (`README.md:265`) and `.env.example:5` document `../products`, and `scripts/cloud-install.sh:179` already uses `$REPO_ROOT/../products`. Those are relative to the repo, which matches the intent, but `config.ts` is not.

**Proposed design.** Unset means no change for anyone who sets `PRODUCTS_ROOT`.

- When `PRODUCTS_ROOT` is unset, use `path.resolve(process.cwd(), "..", "products")`, which for the cloud and local layouts equals `../products` from the repo root. For a consumer, that is the directory next to its own repository, outside `node_modules`.
- If `process.cwd()`'s parent is inside a `node_modules` directory, throw `PRODUCTS_ROOT is not set and the default would be inside node_modules; set PRODUCTS_ROOT`. This keeps the default honest.

**Files and tests.**

- `src/config.ts:151`.
- `src/config.test.ts`: a new `describe` with three cases: unset with cwd outside node_modules resolves to `<cwd>/../products`; unset with cwd under `node_modules` throws; set resolves as given.
- `README.md:265` table row and `.env.example:5` comment.
- `scripts/cloud-install.sh`: no change (already `../products`).

**Acceptance.** Unit: default resolves outside any path segment named `node_modules`. Live: not needed for this item; the existing `up`/`smoke` of one product covers the resolution for this repo (cwd is the repo, so the result is unchanged).

**README and CHANGELOG text (draft).**

> `PRODUCTS_ROOT` now defaults to `../products` relative to the current working directory, not to the installed package. A consumer no longer gets forks inside `node_modules`. Set `PRODUCTS_ROOT` to keep any other path.

**Backward compatibility.** Repo-local users (this repo, cwd = repo root): unchanged. Consumers who relied on `node_modules/products` (not documented anywhere; no consumer does) would move. The CHANGELOG must say so. P1, P2 and P6 set their own paths or use the repo layout; the release note asks them to check.

---

### 1.5 Cal `.env` provisioning (new, from the P5 lane probes)

**Current behaviour at v0.3.1.**

- The Cal API spawn env reads the product root `.env`: `src/adapters/cal.adapter.ts:492-495` (`apiSpawnEnv`, `loadDotenv({ path: rootEnvFile, processEnv: {} })`).
- Required keys: `CAL_API_REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET", "CALENDSO_ENCRYPTION_KEY"]` (`cal.adapter.ts:60`).
- The preflight refuses to continue without the file: `cal.adapter.ts:646-648` throws `Cal .env missing at <root>. Copy .env.example → .env and set NEXTAUTH_SECRET + CALENDSO_ENCRYPTION_KEY`.
- The runtime path does not write it. Documenso (`documenso.adapter.ts:169-177`) copies `.env.example`, Medusa (`medusa.adapter.ts:272`) writes its backend `.env`, and Twenty (`twenty-env.ts:196-240`) writes its docker `.env` with generated secrets. Cal has no equivalent.
- The only writer is `scripts/cloud-install.sh:104-119` (`prepare_cal_env`): copy `.env.example`, set `127.0.0.1`, append `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` from `openssl rand`, file mode 600, skip if present. It is an install-time script, not part of `up()`.

**Proposed design.** A harness-owned writer, run by `up cal` before the preflight.

- New `src/adapters/cal-env.ts`: `ensureCalRootEnv({ productRoot, fs, randomBytes })`. Creates `.env` from `.env.example` when missing (as Documenso does), sets `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` only when missing or a placeholder, and writes mode 0600. It never overwrites a real value and never logs one.
- Guard: if the Cal database volume already exists and a new `CALENDSO_ENCRYPTION_KEY` would be generated, refuse with a reset instruction. This is the same rule as `bootstrapTwentyDockerEnv` (`twenty-env.ts:215-220`), because a new key cannot decrypt rows written under the old key.
- The generated values are per stack, never committed, and printed only by name.
- Remove or keep `scripts/cloud-install.sh:104-119`. Owner decision (section 3e): keeping it is harmless because it exits early when `.env` exists.

**Exact files and tests.**

- `src/adapters/cal-env.ts` (new) and `src/adapters/cal-env.test.ts` (new): missing, placeholder, real (unchanged), volume-exists refusal, mode 0600, no value in logs.
- `src/adapters/cal.adapter.ts`: call `ensureCalRootEnv` before the preflight at `:646-648`.
- `docker/cal.compose.yml`: no change.

**Acceptance.**

- Unit: as above, with injected fs and randomBytes.
- Live: `node scripts/up.mjs cal` on a clean fork with no `.env` now creates it (names only printed), and `node scripts/smoke.mjs cal` passes the `POST /v2/bookings` path that needs `CALENDSO_ENCRYPTION_KEY`. Cal live is heavy (yarn build, API v2 build); it is not run in this probe (see Appendix A, 2c).

**README and CHANGELOG text (draft).**

> Cal: `up cal` writes the Cal root `.env` when it is missing, with generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`. Real values are never overwritten. If the Cal database volume exists, `up` refuses to generate a new encryption key (reset with `down -v`). Values are never printed.

**Backward compatibility.** A consumer who already has a `.env` sees no change. A consumer without one gets one written; this is the behaviour the preflight already asks the user to do by hand.

---

### 1.6 Opt-in synthetic canary pass-through for Twenty server and worker (MP:1019, SND-001)

**Current behaviour at v0.3.1.** No canary name or pattern exists in `src/` (`grep -rni canary src/` finds nothing). The Twenty override only forwards the listed names and the rate-limit keys (`twenty-runtime-override.ts`).

**Proposed design.** Two caller variables, both optional. Unset means no change.

- `HARNESS_TWENTY_CANARY_NAME`: an exact variable name, validated with `^[A-Z][A-Z0-9_]{2,63}$`. It must not collide with any name the harness already writes (the passthrough list, the rate-limit keys, the preload variables) or any name in `TWENTY_PASSTHROUGH_ENV`.
- `HARNESS_TWENTY_CANARY_VALUE`: the value. Non-blank required when the name is set; a blank value with a name set throws.
- The override writes `NAME: ${HARNESS_TWENTY_CANARY_VALUE}` under `server` and `worker`. Compose interpolates the value from the `up` environment; the file contains only the reference, never the value.

**Exact files and tests.**

- `src/adapters/twenty-canary.ts` (new): name validation, collision check, the mapping line. `src/adapters/twenty-canary.test.ts` (new).
- `src/adapters/twenty-runtime-override.ts` and `.test.ts`: include the canary lines, and assert the rendered YAML holds `${HARNESS_TWENTY_CANARY_VALUE}` and never a value.
- README (Twenty section) and CHANGELOG.

**Log safety (required).** `docker compose config` must never run while the canary is set (it prints interpolated values). The harness does not run it. The existing compose argv logging does not print environment values.

**Acceptance (SND-001 precondition (a) and (c)).**

- Unit: the name is validated; the YAML contains the reference and no value; collision throws; unset yields no key.
- Live: with `HARNESS_TWENTY_CANARY_NAME=P5_CANARY_<run>` and a value in the `up` environment, `docker compose -p qa-harness-twenty exec -T server sh -c 'printenv "$NAME" | sha256sum'` (name passed in the environment) gives the same hash as the harness-side `sha256` of the value, computed without printing it. Unset: `printenv` exits 1 in the server and worker. The value is never printed.

**README and CHANGELOG text (draft).**

> Twenty: opt-in `HARNESS_TWENTY_CANARY_NAME` and `HARNESS_TWENTY_CANARY_VALUE` write one caller-named variable into the Twenty server and worker. The name must match `^[A-Z][A-Z0-9_]{2,63}$` and must not collide with a harness-owned name. The value is never logged or written to disk; it is passed by reference through compose.

**Backward compatibility.** Unset: no change for P1, P2 or P6.

---

## 2. Probe

Appendix A is the record. The live Twenty run is the only live result in this document.

---

## 3. Plan contents

### 3a. File table

| Request | Files (src and tests) | Compose or ADR | Notes |
|---|---|---|---|
| 1 `LOGIC_FUNCTION_TYPE` | `src/adapters/twenty-passthrough.ts`, `twenty-passthrough.test.ts`, `twenty-runtime-override.ts`, `twenty-runtime-override.test.ts` | none | Enum validation before any write |
| 2 `MEDUSA_FF_RBAC` | `src/adapters/medusa-env.ts`, `medusa-env.test.ts`, `medusa.adapter.ts`, `medusa.adapter.test.ts` | none | Never deletes a template line |
| 3a fresh stack | `src/adapters/twenty-env.test.ts` (argv), README | none | Documentation and tests only |
| 3b scoped reset | `src/adapters/twenty-limiter-reset.ts` (new), `.test.ts` (new), `twenty.adapter.ts` | new ADR `docs/adr/0004-twenty-scoped-limiter-reset.md` | Destructive capability; per-workspace keys only |
| 4 `PRODUCTS_ROOT` | `src/config.ts`, `src/config.test.ts`, `README.md`, `.env.example` | none | `scripts/cloud-install.sh` unchanged |
| 5 Cal `.env` | `src/adapters/cal-env.ts` (new), `cal-env.test.ts` (new), `cal.adapter.ts` | none (`docker/cal.compose.yml` unchanged) | Volume-exists refusal |
| 6 canary | `src/adapters/twenty-canary.ts` (new), `.test.ts` (new), `twenty-runtime-override.ts`, `.test.ts` | none | Reference only in YAML |

No `docker/*.compose.yml` change is planned. The `CONTRIBUTING.md` ADR rule applies to upstream product defaults and to destructive capabilities; the only ADR is 0004 (item 3b).

### 3b. Commit plan (later build)

Lowercase Conventional Commits, one concern per commit, explicit `git add` paths, no trailers, no amend, no force-push.

1. `feat: pass LOGIC_FUNCTION_TYPE through to twenty server and worker`
2. `feat: pass MEDUSA_FF_RBAC through to the medusa backend env`
3. `feat: forward an opt-in twenty canary variable by reference`
4. `feat: write the cal root .env from the harness`
5. `fix: default PRODUCTS_ROOT outside node_modules`
6. `docs: add adr 0004 for the scoped twenty limiter reset`
7. `feat: add a per-workspace twenty limiter reset helper`
8. `docs: document the twenty fresh-stack guarantee`

Commit 6 precedes 7 so the ADR exists before the destructive helper.

### 3c. Release PR (separate, later)

- Bump `version` in `package.json` (proposed `0.4.0`, matching the v0.3.0 precedent for additive opt-in forwarding; the owner may choose `0.3.2`).
- Add a dated `CHANGELOG.md` section (`## [0.4.0] - <date>`) with the upgrade notes from 1.1-1.6.
- Update `README.md` (the Twenty, Medusa, Cal and `PRODUCTS_ROOT` sections).
- The release PR is its own branch (`chore/...`), not mixed with feature PRs.

### 3d. Cloud environments

- Claude Code cloud: no environment change. `.claude/hooks/session-start.sh` already covers Node, Docker and dependencies; the builder can run `npm ci`, `npm run check`, `up`/`smoke`/`down` for Twenty with the existing setup.
- Cursor cloud: no environment change. `.cursor/environment.json` and `scripts/cloud-install.sh` are unchanged by this plan. Item 4 leaves `cloud-install.sh` as it is.
- If the later build needs a Cal live run in cloud, the Cal yarn build needs more time; that is a timeout tuning in the harness, not an environment change, and is decided when the build is planned.

### 3e. Owner-only steps (never performed by the builder)

- Merge each PR with **Create a merge commit** (never squash), per `CONTRIBUTING.md` "Merge and releases".
- Create and push the release tag `vX.Y.Z` on the main merge commit of the release PR.
- Verify the tag points at a commit in `main` history and that `npm run check` passed on that commit.
- Authorise the P5 foundation pin PR (`MP:631`): `package.json`, `package-lock.json` and `tests/unit/foundation.test.ts` change together (`MP:631`, section 7.5). The builder does not open or merge it.
- Decide whether `scripts/cloud-install.sh:104-119` (the Cal writer) stays after item 5 (section 1.5).
- Decide the release version (3c).

### 3f. Downstream note

P5 rows stay gated `BLOCKED: <item> not in harness v0.3.1` until the P5 pin PR merges:

- `LOGIC_FUNCTION_TYPE` (item 1) blocks the Twenty sandbox rows SND-001..004 (`MP:802`, section 19.5).
- `MEDUSA_FF_RBAC` (item 2) blocks MED-RBAC-001 (`MP:803`).
- The scoped limiter reset (item 3b) blocks `tw-limiter-last` GQL-004 (`MP:804`, section 9.6). Until then, GQL-004 stays on a fresh stack with no reset.
- `PRODUCTS_ROOT` (item 4) removes the manual step (`MP:805`).
- The Cal `.env` (item 5) gates the Cal rows: until the harness writes it, the blocker is "harness must provision Cal .env" (`MP:786-789`).
- The canary (item 6) gates SND-001 (`MP:1019`), together with D8 and P-12.

Consumer pins at probe time (Appendix A, 2d): P1 `v0.3.0`, P2 `v0.3.1`, P6 `v0.2.18`. The release is additive, so none of them need a change to keep working; each may repin when it wants the new options.

---

## Appendix A. Probe record

### 2a. Re-read at v0.3.1

Every cited `file:line` was re-read at `7d4a3ae`. No CONTRADICTS. Results in section 0. Upstream lines were read from the product fork at `7cbdfec6` under `../products/twenty-CRM` (fork HEAD `7cbdfec6f346b43715bc2056932f4fad5886f733`, matching the pin).

Checks run:

- `grep -rn LOGIC_FUNCTION src/`, `grep -rn MEDUSA_FF_RBAC src/`, `grep -rni canary src/`, `grep -rn PRODUCTS_ROOT src/`: no match except `src/config.ts`.
- Medusa fork `@medusajs/medusa@2.21.2` `rbac.js` (env key and default) and `@medusajs/utils@2.21.2` `register-flag.js`, `flag-router.js`.
- Twenty fork: `config-variables.ts:732-735` (LOGIC_FUNCTION_TYPE), `:1713-1757` (API rate-limit defaults), `logic-function-driver.interface.ts:74-78` (enum), `usage-limit` constants, `usage-limit-speed.service.ts`, `build-speed-bucket-key.util.ts`, `cache-storage` namespace and `getKey`, `flushByPattern`, `flush`, `throttler.service.ts`, `usage-limit.entity.ts` (`core.usageLimit`), upstream `docker-compose.yml:128-140`.

### 2b. npm ci and npm run check at the branch head

- `npm ci`: exit 0, `found 0 vulnerabilities`.
- `npm run check` (`typecheck && test && build`): exit 0.
  - `tsc --noEmit`: pass.
  - `npm test` (node:test over `dist-test/**/*.test.js`): `# tests 365`, `# suites 138`, `# pass 364`, `# fail 0`, `# cancelled 0`, `# skipped 1`, `# todo 0`.
  - `tsc` build: pass.

### 2c. Live probe (one product, down in a trap)

- Stack: `twenty` (`node scripts/up.mjs twenty`, `node scripts/smoke.mjs twenty`, `node scripts/down.mjs twenty` in an `EXIT` trap).
- `UP_EXIT=0`. The up log showed `qa-harness-twenty-db-1` healthy and the server containers starting, then the harness reported the stack up for image `twentycrm/twenty:v2.44.0`. Smoke then reached the server, so the server was healthy by the time it ran.
- `SMOKE_EXIT=0`. Smoke output summary: `seed users` ran; `authenticate` returned a session; `proveAuth` returned `currentUser.email=jane.austen@apple.dev (HTTP 200)`; `postgres SELECT 1` returned `ok: 1`; the final line is `smoke ok`. The token in the output is not reproduced here.
- `DOWN_EXIT=0`. After the run, `docker ps -a --filter name=qa-harness` returned 0 containers. Volumes were not checked in this probe; `down` runs without `-v`, so named volumes are kept by design.

Limiter backing store (item 3b):

- Identified from source: Redis, namespace `engine:usage-limit`, keys `{<workspaceId>}:speed:...` (per-workspace `apiKey`) and `{server}:speed:...` (cross-workspace `application`).
- Live counter observation: UNPROBED. The smoke path uses Bearer login, not an API key, so the public API speed counters were not touched; the stack was torn down before any read. No read or write of Redis keys was performed. A live key read needs a run that makes API-key requests while the stack is up.

Cal live: UNPROBED. The Cal root `.env` exists at `/home/user/products/cal/.env` (mode 600, written by `scripts/cloud-install.sh` at install, not by `up()`). The brief limits live Cal to an `.env` from a harness route; this probe ran only Twenty, and the Cal stack (yarn build, API v2 build) was not started. Item 5's gap is shown from source: `up()` does not provision the file, and the preflight at `cal.adapter.ts:646-648` refuses without it.

### 2d. Consumer pins

Read by partial clone of each consumer's default branch and the commits the brief names. Lock files were checked too.

| Consumer | Repo | Commit checked | `package.json` pin | `package-lock.json` pin |
|---|---|---|---|---|
| P1 | `Jayami123/playwright-e2e-ci-framework` | HEAD `2bbdf8b` | `#v0.3.0` (line 38) | `#v0.3.0` (line 9) |
| P2 | `Jayami123/api-webhook-db-test-suite` | `99a2fde` and HEAD `ffa9fd3` | `#v0.3.1` (line 26) | `#v0.3.1` (line 9) |
| P6 | `Jayami123/k6-load-concurrency-suite` | `0533e61` and HEAD `0533e61` | `#v0.2.18` (line 63) | `#v0.2.18` (line 9) |

Each consumer pins a tag below or at v0.3.1. The release is additive, so none of them break on the new minor.

### 2e. Checks not run

- `npm run smoke -- cal` (CONTRIBUTING "Before you push") was not run: Cal live is UNPROBED (see 2c). The plan records it as a required check for the later build.
- Documenso and Medusa live were not run in this probe (one product at a time; scope is Twenty).
