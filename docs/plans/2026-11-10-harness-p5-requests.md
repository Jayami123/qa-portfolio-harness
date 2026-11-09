# Harness requests from P5: probe and plan (v0.3.1 base, revision 2)

Status: PLAN ONLY. This document is the only file in its change set. No code, compose, script or package file is changed by the plan.

- Base: `origin/main` at `7d4a3ae`. The `v0.3.1` tag object is `88827e4` and it peels to commit `7d4a3ae`.
- Branch: `docs/2026-11-10-harness-p5-requests`.
- Source of the requests: `appsec-devsecops-pipeline` `docs/plans/2026-11-08-p5-master-plan.md` at `298ae29`, cited as `MP:<line>`. Section 11 is `MP:800-807`.
- Revision 2 answers the review of PR #44. Changed sections are marked "(rev 2)".
- Probe record: Appendix A.

## 0. Status summary

| # | Request | Status at v0.3.1 | Evidence |
|---|---|---|---|
| 1 | Opt-in `LOGIC_FUNCTION_TYPE` pass-through (Twenty) | CONFIRMED (absent) | `src/adapters/twenty-passthrough.ts:9-16`; no match in `src/` |
| 2 | Opt-in `MEDUSA_FF_RBAC` pass-through (Medusa backend) | CONFIRMED (absent) | backend env is the file `medusa.adapter.ts:252-274` writes; `backendProcessEnv` `:276-281` reads only that file |
| 3a | Fresh-stack guarantee | CONFIRMED by source; live before/after NOT run | `docker/twenty.compose.yml`; upstream `docker-compose.yml:128-140`; `twenty.adapter.ts:180-191` |
| 3b | Product-scoped limiter reset (per workspace) | CONFIRMED by source (store identified); live key read UNPROBED | `usage-limit-definitions.constant.ts:19-46`; `build-speed-bucket-key.util.ts`; `cache-storage-namespace.enum.ts` |
| 4 | `PRODUCTS_ROOT` default outside `node_modules` | CONFIRMED | `src/config.ts:151`; `src/paths.ts:3-5` |
| 5 | Cal `.env` provisioning | CONFIRMED, with one qualification | `src/adapters/cal.adapter.ts:492-495`, `:646-648`; `scripts/cloud-install.sh:104-120` writes it at install time |
| 6 | Opt-in synthetic canary pass-through (Twenty server and worker) | CONFIRMED (absent) | no canary name or pattern in `src/` |

No item is CONTRADICTS. No STOP condition was hit in the probe.

### 0.1 Citation corrections (rev 2)

- PR #44 review cited `CHANGELOG.md:12` for the workspace-limit statement. At `origin/main` line 12 is the Medusa caching entry. The workspace statement (sixth workspace refused; `WORKSPACE_NOT_FOUND` for a new workspace on `127.0.0.1`) is at `CHANGELOG.md:14`.
- `medusa.adapter.ts:527` is the storefront `.env.local` writer (`writeStorefrontEnv`, `:508-529`). The backend `.env` write is at `:272`, and its read is at `:276-281`.
- `CONTRIBUTING.md:38` is the rule that the Postgres helper is read-only by intent. The "Safety rules" section is `CONTRIBUTING.md:36-41`. No rule there covers destructive capabilities.
- Item 5: `up()` does not provision the Cal root `.env`. `scripts/cloud-install.sh:104-120` does, at install time.
- The `v0.3.1` tag object is `88827e4`. Its commit is `7d4a3ae`.

---

## 1. Requests, one section each

### 1.1 Opt-in `LOGIC_FUNCTION_TYPE` pass-through for Twenty (MP:802)

**Current behaviour at v0.3.1.**

- `src/adapters/twenty-passthrough.ts:9-16` lists six names. `LOGIC_FUNCTION_TYPE` is not among them. `grep -rn LOGIC_FUNCTION src/` finds nothing.
- The override is written by `writeTwentyRuntimeOverride` (`src/adapters/twenty-runtime-override.ts`), called at `twenty.adapter.ts:154` in `up()`. Passthrough names use mapping form `NAME:` with no value, so compose takes the value from the environment of `up`.
- Upstream default at Twenty `7cbdfec6` (`config-variables.ts:732-735`): `LOGIC_FUNCTION_TYPE = process.env.NODE_ENV === DEVELOPMENT ? LOCAL : DISABLED`. The enum is `DISABLED | LAMBDA | LOCAL` (`logic-function-driver.interface.ts:74-78`). `@CastToUpperSnakeCase()` makes `local` valid.

**Opt-in design.** Unset or blank passes nothing.

- Append `"LOGIC_FUNCTION_TYPE"` to `TWENTY_PASSTHROUGH_ENV`.
- Validate before any disk write: after `toUpperCase()` the value must be `DISABLED`, `LAMBDA` or `LOCAL`. Otherwise throw `TWENTY_LOGIC_FUNCTION_TYPE_INVALID`, naming the variable and the allowed values. The check runs first in `writeTwentyRuntimeOverride`, the same way the rate-limit values are validated.

**Files and tests.** See 3a and 3h for signatures.

- `src/adapters/twenty-passthrough.ts`; `src/adapters/twenty-passthrough.test.ts` (update the ordered-list assertion, add the new name at the end).
- `src/adapters/twenty-runtime-override.ts`; `src/adapters/twenty-runtime-override.test.ts`.

**Acceptance.**

- Unit (`node:test`): `LOGIC_FUNCTION_TYPE=local` renders `LOGIC_FUNCTION_TYPE:` under `server` and `worker`. Unset and blank render no key. `bogus` throws before `writeFileSync` is called.
- Live: see L1 in 3g.

**README and CHANGELOG text (draft, under `## Unreleased`).**

> Twenty: opt-in `LOGIC_FUNCTION_TYPE` (`DISABLED`, `LAMBDA` or `LOCAL`, case-insensitive) is forwarded to the server and worker by name when set. Unset passes nothing, so the upstream default applies.

**Backward compatibility (P1, P2, P6).** Unset passes nothing. P1 pins `v0.3.0`, P2 pins `v0.3.1` and P6 pins `v0.2.18` (2d). None of them sets the variable today (not verified by grep in this revision; the planned release note asks consumers to check).

---

### 1.2 Opt-in `MEDUSA_FF_RBAC` pass-through for the Medusa backend (MP:803)

**Current behaviour at v0.3.1.**

- `writeBackendEnv` (`src/adapters/medusa.adapter.ts:252-274`) builds `apps/backend/.env` from `apps/backend/.env.template` through `buildMedusaBackendEnvFile` (`src/adapters/medusa-env.ts:241-249`). That function upserts only `DATABASE_URL`, `REDIS_URL`, `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `backendProcessEnv` (`medusa.adapter.ts:276-281`) parses that file. It is the env for `medusa start` (`:941`), the second backend (`:1033`) and `pnpm` runs (`:387`). It does not merge `process.env`, so a shell `MEDUSA_FF_RBAC=true` never reaches the backend.
- Upstream `@medusajs/medusa@2.21.2` `dist/feature-flags/rbac.js`: `key: "rbac"`, `default_val: false`, `env_key: "MEDUSA_FF_RBAC"`. `@medusajs/utils` `register-flag.js:16-19` reads `process.env[env_key]` with `isTruthy`, and logs `Using flag MEDUSA_FF_RBAC from environment with value ...` (`:34`).

**Opt-in design.** Unset or blank leaves the written file exactly as it is.

- Read `MEDUSA_FF_RBAC` only when it is `true` or `false` (exact). Any other non-blank value throws `MEDUSA_FF_RBAC_INVALID`.
- Add an input field `ffRbac` to `MedusaBackendEnvInput`. Write the line only when the field is defined.
- Use a new setter that never deletes. The existing `upsertEnvLine(..., undefined)` deletes a line; that would remove a template `MEDUSA_FF_RBAC` line when the caller leaves the variable unset. The new setter does not touch the template in that case.

**Files and tests.** See 3h for signatures.

- `src/adapters/medusa-env.ts`; `src/adapters/medusa-env.test.ts`.
- `src/adapters/medusa.adapter.ts` (`writeBackendEnv` passes the value); `src/adapters/medusa.adapter.test.ts`.

**Acceptance.**

- Unit: `true` writes `MEDUSA_FF_RBAC=true`; `false` writes `false`; unset leaves a template line untouched; `yes` throws; a golden test shows the unset output equals v0.3.1 output byte for byte.
- Live: see L3 in 3g.

**README and CHANGELOG text (draft).**

> Medusa: opt-in `MEDUSA_FF_RBAC` (`true` or `false`) is written into the harness-generated backend `.env`. Unset leaves the file unchanged, so Medusa's default (`false`) applies.

**Backward compatibility.** Unset: byte-identical `apps/backend/.env` output. The golden test enforces it.

---

### 1.3 Limiter contract and fresh stack (MP:804), Twenty first (rev 2)

#### (a) Fresh-stack guarantee

**Facts, verified in revision 2.**

- `up()` does not seed. It runs compose up, the optional pg_stat extension, the server image check and a log message (`twenty.adapter.ts:152-178`). Seeding is a separate call: `smoke.mjs:189` calls `adapter.seed()`, which runs `yarn command:prod workspace:seed:dev` in the server container (`twenty.adapter.ts` seed, around `:227-262`).
- Redis has no named volume. Upstream `packages/twenty-docker/docker-compose.yml:128-133` defines `redis` with `image: redis`, `restart: always`, `command: [--maxmemory-policy, noeviction]` and no `volumes:`. The only named volumes are `db-data` and `server-local-data` (`:139-140`), so the Redis data is in the container's writable layer.
- The `redis` image declares no `VOLUME`. `docker image inspect redis` reports `Config.Volumes = null` for the pulled digest `redis@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53`. So there is no anonymous volume either. The original hypothesis (an anonymous `/data` volume) is refuted for this digest.
- The compose file uses the unpinned tag `image: redis`. The digest above is what this probe pulled; a later pull may differ. Pinning is a separate decision (3e).
- Consequences, from these facts: `down` (no `-v`) removes the Redis container and so its counters. Postgres `db-data` keeps workspaces, API keys and `core."usageLimit"` rows. A container recreate of Redis without `down` (for example `up --force-recreate`) also discards the writable layer. The recreate case is inferred from Docker semantics and is UNPROBED live.

**Contract to document.** After `down` without `-v`: counters are empty, rows are kept. After `down -v` (`TWENTY_DOWN_VOLUMES=1`): counters and rows are both empty, and the next `up` must be seeded by smoke or by an explicit seed. A first non-429 is not evidence of either (MP:804).

**Opt-in guard `TWENTY_REQUIRE_FRESH=1` (new).**

- When exactly `1`, `up()` checks the Docker volume list first (`listTwentyDockerVolumeNames`, `twenty.adapter.ts:103-106`) and refuses if `qa-harness-twenty_db-data` or `qa-harness-twenty_server-local-data` exists. It uses the existing `twentyHarnessVolumesExist` (`twenty-env.ts:147-151`). The refusal is thrown before `composeUp`, so no container is created.
- Any other non-blank value throws `TWENTY_REQUIRE_FRESH_INVALID`. Unset does nothing.

#### (b) Product-scoped limiter reset, per workspace

**Backing store, from source.**

- Public API limits use `UsageLimitSpeedService` (`usage-limit-speed.service.ts:37-38`, cache namespace `EngineUsageLimit`) and a token-bucket script (`try-consume-token-buckets-script.constant.ts`, called at `:186-196`).
- Namespace `EngineUsageLimit = 'engine:usage-limit'`. Full key `engine:usage-limit:<bucket key>` (`cache-storage.service.ts:482-488`, `getKey`).
- Bucket key (`build-speed-bucket-key.util.ts`): `{<scope>}:speed:<resourceType>:<operationType>:<spenderType>:<spenderId or '-'>:<windowSeconds>`. `scope` is the workspace id for `perWorkspace` and `server` for `crossWorkspace`.
- Defaults (`usage-limit-definitions.constant.ts:19-46`): `apiKey` short 100 per 1000 ms, `apiKey` long 100 per 60000 ms, both `perWorkspace` with `spenderId: ''`. `application` 500 per 60000 ms, `crossWorkspace`. The fork's variables are at `config-variables.ts:1713-1757`.
- `apiKey` has an empty spender id, so its key is `{<workspaceId>}:speed:API:API_REQUEST:apiKey:-:<n>`. **The counter is per workspace, not per API key.** Deleting one workspace's keys resets every API key in that workspace.
- `application` is `{server}:speed:API:API_REQUEST:application:-:<n>`, shared by all workspaces. The reset never touches it.
- Existing helpers: `flushByPattern` (`cache-storage.service.ts:219-244`) does `SCAN` plus `DEL`. `flush()` (`:215-217`) is `cache.reset()`, which is unscoped. P5 and the harness must not use `flush()`.

**Workspaces on a fresh stack (rev 2).**

- The harness seed runs `workspace:seed:dev` without `--light` (`smoke.mjs` seed path). `data-seed-dev-workspace.command.ts:43-45` then seeds two workspaces by default:
  - Apple: `20202020-1c25-4d02-bf25-6aeccf7ea419` (default from `seeder-workspaces.constant.ts`; `E2E_SEED_WORKSPACE_ID` can override it, and the harness does not set that variable, so the default applies).
  - YCombinator: `3b8e6458-5fc1-4e63-8563-008ccddaa6db`.
- So no sixth workspace is needed, and the creation refusal in `CHANGELOG.md:14` does not apply. The design uses the two seeded workspaces: **target = Apple, control = YCombinator**.
- Not yet proven: that the seeded login can reach YCombinator, and that an API key can be created in each workspace. API keys are created by `createApiKey` (`engine/core-modules/api-key/api-key.resolver.ts:80`, GraphQL). The harness has no helper for this. This is a build step-0 STOP probe (3g L0). If either fails for YCombinator, this design is STOPPED and the item is re-scoped. No workspace is created to work around it.

**The reset (rev 2).**

- Helper `resetWorkspaceSpeedCounters({ workspaceId, files, run })` in `src/adapters/twenty-limiter-reset.ts`. It runs `SCAN` with `MATCH engine:usage-limit:{<workspaceId>}:speed:*`, checks every returned key carries that exact hash tag, then runs `DEL` on exactly those keys in batches of 500.
- It runs through compose in the project `qa-harness-twenty`: `docker compose -p qa-harness-twenty -f <docker-compose.yml> -f docker/twenty.compose.yml exec -T redis redis-cli ...`. Argv is built by `buildComposeRedisArgv`, and the unit test asserts the adjacent pair `-p qa-harness-twenty` and `exec -T redis`.
- It refuses a `workspaceId` that is not a UUID, and refuses `server`.
- Scope, stated plainly: the reset deletes **all speed counters of the named workspace**, which is every API key in that workspace. It does not delete `{server}` counters, other workspaces' counters, or quota keys outside `:speed:`.
- A `scripts/reset-counters.mjs` entry point wraps it: `node scripts/reset-counters.mjs twenty <workspaceId>`. It prints the matched and deleted counts and no key values.

**Mapping to MP:804 (a)-(d), per adapter.**

- (a) Exhaust. Use the target workspace's API key on `GET /rest/people?limit=1`. The long bucket is set to 5 per 3600000 ms (see Acceptance). Requests 1-5 return 200 and request 6 returns 429. Attribution: the 429 must be from the long layer, which the probe checks in the response body or headers. If it cannot be attributed, STOP.
- (b) Only the disposable target. The reset is per workspace. The `SCAN` before and after shows the target's keys removed and the control's keys present and unchanged. The `{server}` keys are not in the pattern, so they are unchanged too.
- (c) Same route, same key, healthy after reset. After the reset, the target key returns 200 while the long window is still open (3600 s, so the 200 cannot come from time passing). Five more requests succeed, then 429 again, which shows limiting is still active.
- (d) Another product's control. See 1.3(d).

**Decision record for ADR 0004 (rev 2).** `CONTRIBUTING.md:36-41` has no rule about destructive capabilities. The justification is by contrast with `CONTRIBUTING.md:38`: the Postgres helper is "read-only intent", so shared helpers are read-only by intent. A helper that issues `DEL` against a shared store is a departure from that intent, and the departure must be recorded in writing before it ships. ADR 0004 records it. It does not claim a rule that CONTRIBUTING does not state.

#### Acceptance (live), rev 2

The live check uses a long window, so a 200 means something:

- `API_RATE_LIMITING_LONG_TTL_IN_MS=3600000` and `API_RATE_LIMITING_LONG_LIMIT=5`. Both names are already in `TWENTY_RATE_LIMIT_ENV` (`src/adapters/twenty-rate-limits.ts:7-14`), so the forwarding needs no harness change. Short limits are left at their defaults.
- Token bucket: burst is `LONG_LIMIT` (5), refill is 5 tokens per 3600 s, so a refill cannot reach the next request inside the test window.
- Requires 429 before, then 200 after, inside the open long window.
- Read-only `SCAN` of `engine:usage-limit:*` shows the keys before and gone after the reset (3g L6).

#### (d) Owner decision (rev 2)

MP:804(d) asks for "another product's control". The harness runs one product stack at a time and Redis is per stack (`qa-harness-twenty`), so another product's counters cannot be reached from this stack by construction. The build implements only the in-stack control (YCombinator). Whether (d) also needs a separate sequential run of another product is an **owner decision**. It is not implemented here.

---

### 1.4 `PRODUCTS_ROOT` default outside `node_modules` (MP:805)

**Current behaviour at v0.3.1.**

- `src/config.ts:151`: `path.resolve(parsed.PRODUCTS_ROOT ?? path.join(HARNESS_ROOT, "..", "products"))`.
- `src/paths.ts:3-5`: `HARNESS_ROOT` is the package root. An installed package sits at `node_modules/qa-portfolio-harness`, so the default resolves to `node_modules/products`.
- Consumers (verified in revision 2 from their checkouts):
  - P1 `playwright-e2e-ci-framework`: `.github/workflows/e2e.yml:284` sets `PRODUCTS_ROOT: ${{ github.workspace }}/products`. `.env.example:16` sets `PRODUCTS_ROOT=../products`.
  - P2 `api-webhook-db-test-suite`: `.github/workflows/p2-cal.yml:20`, `p2-doc.yml:40`, `p2-doc-serial.yml:30` set `PRODUCTS_ROOT: ${{ github.workspace }}/../products`. `.env.example:4` sets `PRODUCTS_ROOT=` (blank).
  - P6 `k6-load-concurrency-suite`: `.github/workflows/gate.yml:148` sets `PRODUCTS_ROOT: ${{ github.workspace }}/products`. `.env.example:5` sets `PRODUCTS_ROOT=` (blank).
- So the three CI workflows set the variable explicitly. Two consumers ship a blank value in `.env.example`. A blank value means "unset" in the harness (`optionalString`, `config.ts:16-27`), so a local run by P2 or P6 that copies the example would move to the new default.

**Opt-in design (rev 2, behaviour change).** This item changes a default. It is not opt-in, and the release note must say so.

- Unset `PRODUCTS_ROOT`: use `path.resolve(process.cwd(), "..", "products")`. For the repo layout and the cloud layout this equals `../products`.
- If that resolved path is inside any `node_modules` segment, throw `PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES` and ask for `PRODUCTS_ROOT`.
- Set `PRODUCTS_ROOT` keeps today's behaviour.

**Files and tests.**

- `src/config.ts:151`; `src/config.test.ts` (three cases: unset outside node_modules, unset inside node_modules throws, set is used as given).
- `.env.example:5`, `README.md` table row near `:265`. `scripts/cloud-install.sh` is unchanged (it already uses `$REPO_ROOT/../products`).

**Acceptance.** Unit tests above. Live: see L7 in 3g.

**README and CHANGELOG text (draft).**

> Behaviour change: when `PRODUCTS_ROOT` is unset, the forks are looked up at `../products` relative to the current directory, not inside the installed package. Set `PRODUCTS_ROOT` to keep any other path. Consumers whose `.env` has a blank `PRODUCTS_ROOT` now get this default.

**Backward compatibility.** Consumers that set `PRODUCTS_ROOT` in CI (P1, P2, P6 as above) see no change. The blank-`.env` case is the change. This is one reason for the release to be a minor bump (3c).

---

### 1.5 Cal `.env` provisioning and a Cal volume reset (rev 2)

**Current behaviour at v0.3.1.**

- The Cal API spawn env reads the product root `.env`: `cal.adapter.ts:492-495` (`apiSpawnEnv`, `loadDotenv({ path, processEnv: {} })`).
- Required keys: `CAL_API_REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET", "CALENDSO_ENCRYPTION_KEY"]` (`:60`).
- The preflight refuses without the file: `cal.adapter.ts:646-648` throws `Cal .env missing at <root>. Copy .env.example → .env and set NEXTAUTH_SECRET + CALENDSO_ENCRYPTION_KEY.`
- Runtime `up()` writes no Cal `.env`. Documenso copies `.env.example` (`documenso.adapter.ts:169-177`), Medusa writes its backend `.env` (`medusa.adapter.ts:272`), and Twenty writes its docker `.env` (`twenty-env.ts:196-240`).
- The only writer is `scripts/cloud-install.sh:104-120` (`prepare_cal_env`). It copies `.env.example` when `.env` is missing, rewrites `http://localhost:3000` to `http://127.0.0.1:3000` (line 113, `sed s|...|...|g`), removes the `NEXTAUTH_SECRET=` and `CALENDSO_ENCRYPTION_KEY=` lines, appends `NEXTAUTH_SECRET` (`openssl rand -base64 32`, 32 bytes) and `CALENDSO_ENCRYPTION_KEY` (`openssl rand -base64 24`, 24 bytes), and sets mode 600. It exits early when `.env` exists.
- The Cal fork's `.env.example` ships both secret keys empty: `NEXTAUTH_SECRET=` (line 59) and `CALENDSO_ENCRYPTION_KEY=` (line 76). That is why "placeholder" means "empty value" below.

**Why env-of-up alone is not enough.** Passing `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` as environment variables to `up` does not create the file. The preflight at `:646-648` checks for the file, and the API spawn env at `:492-495` reads the file. The values must be written to `<cal>/.env`.

**Compose and volume facts.**

- Base file `packages/prisma/docker-compose.yml`: service `postgres` mounts `db_data:/var/lib/postgresql` (`:9-10`), and `volumes: db_data:` (`:25-26`).
- Harness overlay `docker/cal.compose.yml` sets project `name: qa-harness-cal` and the host port `5450:5432`.
- `docker compose -p qa-harness-cal -f <base> -f docker/cal.compose.yml ... config --volumes` lists `db_data`. Compose names the runtime volume `<project>_<volume>`, so the expected name is **`qa-harness-cal_db_data`**. The runtime name is UNPROBED (Cal was not started in this probe).
- `cal.adapter.ts:808-814` (`down()`) calls `composeDown(this.composeOpts())` with no `-v`. A Cal reset is impossible from the harness today.

**Design (rev 2).**

- `src/adapters/cal-env.ts`, `ensureCalRootEnv`, called from the Cal prepare path before the preflight at `:646-648`:
  1. If `.env` is missing, copy `.env.example` to `.env` (mode 600).
  2. Replace every `http://localhost:3000` with `http://127.0.0.1:3000` (only on creation, as the script does).
  3. For `NEXTAUTH_SECRET` (32 bytes) and `CALENDSO_ENCRYPTION_KEY` (24 bytes): if the key is absent or its value is empty (the placeholder), remove the line and append the generated value as base64. If it has a non-empty value, leave it.
  4. Write with mode `0o600` and chmod to 600. Never log a value; print names only.
  5. Guard: if a `CALENDSO_ENCRYPTION_KEY` would be generated and the volume `qa-harness-cal_db_data` exists, throw `CAL_ENCRYPTION_KEY_VOLUME_EXISTS`, which names `CAL_DOWN_VOLUMES=1 npm run down -- cal` as the reset. A new key cannot decrypt rows written under the old one.
- `CAL_DOWN_VOLUMES=1` (exact `1`): `down()` passes `-v` to compose down, which removes `qa-harness-cal_db_data`. Unset keeps today's argv. `calDownArgs(env)` returns `["-v"]` or `[]`.

**Files and tests.**

- `src/adapters/cal-env.ts` (new); `src/adapters/cal-env.test.ts` (new).
- `src/adapters/cal.adapter.ts` (call `ensureCalRootEnv` before `:646`; pass `calDownArgs` at `:812`).
- No compose change.

**Acceptance.** Unit tests: missing file, placeholder keys, real keys untouched, `localhost` rewrite on creation only, key lengths (32 and 24 decoded bytes), mode 600, guard refusal, `calDownArgs`. Live: L8 in 3g (UNPROBED in this build).

**README and CHANGELOG text (draft).**

> Cal: `up cal` writes the root `.env` when it is missing, with generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`, mode 600. Values are never printed. Real values are never overwritten. If the Cal database volume exists, `up` refuses to create a new encryption key; reset with `CAL_DOWN_VOLUMES=1 npm run down -- cal`.

**Backward compatibility.** A consumer with an existing `.env` sees no change. `CAL_DOWN_VOLUMES` is unset by default, so `down cal` is unchanged.

---

### 1.6 Opt-in synthetic canary pass-through for Twenty server and worker (MP:1019, SND-001)

**Current behaviour at v0.3.1.** No canary name or pattern in `src/`. The override forwards only the names listed in `twenty-passthrough.ts` and the rate-limit keys.

**Design.** Two caller variables, both optional. Unset means no change.

- `HARNESS_TWENTY_CANARY_NAME`: an exact name matching `^[A-Z][A-Z0-9_]{2,63}$`. It must not equal any harness-owned name (the passthrough names, the rate-limit names, the preload names, `TWENTY_REQUIRE_FRESH`, the canary names themselves).
- `HARNESS_TWENTY_CANARY_VALUE`: required and non-blank when the name is set. Blank with a name throws.
- The override adds `NAME: ${HARNESS_TWENTY_CANARY_VALUE}` under `server` and `worker`. Compose interpolates the value from the `up` environment. The override file contains the reference, never the value.

**Log safety.** `docker compose config` prints interpolated values, so the harness must never run it while the canary is set. The harness does not.

**Files and tests.** See 3h.

- `src/adapters/twenty-canary.ts` (new); `src/adapters/twenty-canary.test.ts` (new).
- `src/adapters/twenty-runtime-override.ts`; `src/adapters/twenty-runtime-override.test.ts`.

**Acceptance (SND-001 preconditions (a) and (c)).** Unit: name validation, collision refusal, YAML holds `${HARNESS_TWENTY_CANARY_VALUE}` and never a value, unset yields no key. Live: L2 in 3g. The hash comparison uses `printf %s`, so there is no trailing newline (`printenv` adds one; the check must not use `printenv | sha256sum` without stripping it).

**README and CHANGELOG text (draft).**

> Twenty: opt-in `HARNESS_TWENTY_CANARY_NAME` and `HARNESS_TWENTY_CANARY_VALUE` write one caller-named variable into the Twenty server and worker. The name must match `^[A-Z][A-Z0-9_]{2,63}$` and must not collide with a harness-owned name. The value is never logged or written to disk; it reaches the container by compose interpolation.

**Backward compatibility.** Unset: no change for P1, P2 or P6.

---

## 2. Probe

Appendix A is the record. Live results in this document: the Twenty up, smoke and down run (2c). Everything else is source-level or marked UNPROBED with a reason.

---

## 3. Plan contents

### 3a. File table (rev 2)

| Request | Files (src and tests, plus scripts and docs) | Compose or ADR | Notes |
|---|---|---|---|
| 1 `LOGIC_FUNCTION_TYPE` | `src/adapters/twenty-passthrough.ts`, `twenty-passthrough.test.ts`, `twenty-runtime-override.ts`, `twenty-runtime-override.test.ts` | none | Enum check before any write |
| 2 `MEDUSA_FF_RBAC` | `src/adapters/medusa-env.ts`, `medusa-env.test.ts`, `medusa.adapter.ts`, `medusa.adapter.test.ts` | none | Setter never deletes a template line |
| 3a fresh guard | `src/adapters/twenty-env.ts`, `twenty-env.test.ts`, `twenty.adapter.ts` | none | `TWENTY_REQUIRE_FRESH=1`, reuses `twentyHarnessVolumesExist` |
| 3b per-workspace reset | `src/adapters/twenty-limiter-reset.ts` (new), `twenty-limiter-reset.test.ts` (new), `scripts/reset-counters.mjs` (new) | new `docs/adr/0004-twenty-scoped-limiter-reset.md` | Only `{<ws>}:speed:*`; no `{server}`; no `flush()` |
| 4 `PRODUCTS_ROOT` | `src/config.ts`, `src/config.test.ts`, `.env.example`, `README.md` | none | Behaviour change; `scripts/cloud-install.sh` unchanged |
| 5 Cal `.env` and `CAL_DOWN_VOLUMES` | `src/adapters/cal-env.ts` (new), `cal-env.test.ts` (new), `src/adapters/cal.adapter.ts`, `README.md` | none (`docker/cal.compose.yml` unchanged) | Guard on `qa-harness-cal_db_data` |
| 6 canary | `src/adapters/twenty-canary.ts` (new), `twenty-canary.test.ts` (new), `twenty-runtime-override.ts`, `.test.ts` | none | Reference only in YAML |

Compose: no `docker/*.compose.yml` change is planned. The Redis image is left unpinned and the question is an owner decision (3e).

ADR: only ADR 0004 (item 3b). Its justification is in 1.3(b), by contrast with `CONTRIBUTING.md:38`.

### 3b. PR split, order and commits (rev 2)

Each PR is opened from `main` after the previous PR merges. No stacked PRs. Each commit is a Conventional Commit with a lowercase subject. Each commit lists exact `git add` paths. No trailers, no `Co-Authored-By`, no amend, no force-push. Explicit paths only, never `git add -A`.

**PR A, branch `feat/2026-11-11-twenty-medusa-passthroughs`** (items 1, 2, 6)

1. `feat(twenty): forward LOGIC_FUNCTION_TYPE to server and worker`
   - `git add src/adapters/twenty-passthrough.ts src/adapters/twenty-passthrough.test.ts src/adapters/twenty-runtime-override.ts src/adapters/twenty-runtime-override.test.ts`
2. `feat(medusa): write MEDUSA_FF_RBAC into the backend env when set`
   - `git add src/adapters/medusa-env.ts src/adapters/medusa-env.test.ts src/adapters/medusa.adapter.ts src/adapters/medusa.adapter.test.ts`
3. `feat(twenty): forward an opt-in canary variable by reference`
   - `git add src/adapters/twenty-canary.ts src/adapters/twenty-canary.test.ts src/adapters/twenty-runtime-override.ts src/adapters/twenty-runtime-override.test.ts`
4. `docs(readme): document the twenty and medusa opt-in variables`
   - `git add README.md CHANGELOG.md`

**PR B, branch `fix/2026-11-12-products-root-default`** (item 4)

5. `fix(config): default PRODUCTS_ROOT to ../products outside node_modules`
   - `git add src/config.ts src/config.test.ts .env.example README.md CHANGELOG.md`
   - Commit body states the behaviour change.

**PR C, branch `feat/2026-11-12-cal-root-env`** (item 5)

6. `feat(cal): write the root .env and add CAL_DOWN_VOLUMES`
   - `git add src/adapters/cal-env.ts src/adapters/cal-env.test.ts src/adapters/cal.adapter.ts README.md CHANGELOG.md`

**PR D, branch `feat/2026-11-13-twenty-counter-reset-fresh`** (items 3a, 3b)

7. `docs(adr): record adr 0004 for the scoped twenty limiter reset`
   - `git add docs/adr/0004-twenty-scoped-limiter-reset.md`
8. `feat(twenty): reset one workspace's speed counters`
   - `git add src/adapters/twenty-limiter-reset.ts src/adapters/twenty-limiter-reset.test.ts scripts/reset-counters.mjs`
9. `feat(twenty): refuse up over existing volumes with TWENTY_REQUIRE_FRESH=1`
   - `git add src/adapters/twenty-env.ts src/adapters/twenty-env.test.ts src/adapters/twenty.adapter.ts`
10. `docs(twenty): document the fresh-stack and reset contract`
    - `git add README.md CHANGELOG.md`

**PR E, branch `chore/2026-11-14-release-0-4-0`** (release; see 3c)

11. `chore(release): prepare v0.4.0`
    - `git add package.json CHANGELOG.md README.md`

**Order.** A, B, C, D, then E. A and D both touch `README.md` and `CHANGELOG.md`; each PR rebases on `main` before opening, so the second one sees the first one's entries. No commit depends on a later PR.

### 3c. Release PR (rev 2)

- **Version: `0.4.0`.** The bump is justified by item 4, not by precedent. Item 4 changes the default location of the forks for any consumer that leaves `PRODUCTS_ROOT` blank. In 0.x a change to a default is a breaking change, so the next version is a minor bump: `0.3.1` to `0.4.0`.
- **P5 side needs an update.** `MP:317` ("Harness v0.3.2 requests") and `MP:338` ("harness `v0.3.2` items 1 and 2") name `v0.3.2`. This plan proposes `v0.4.0`. The P5 plan must be updated by its owner before the P5 pin PR; this is recorded as an owner step (3e).
- `CHANGELOG.md`: a dated `## [0.4.0] - <date>` section that moves `## Unreleased` entries into it, plus the upgrade note for item 4.
- `README.md`: the Twenty, Medusa, Cal and `PRODUCTS_ROOT` sections.
- `package.json` `version`: `0.4.0`.

### 3d. Cloud environments

- Claude Code cloud: no environment change. `.claude/hooks/session-start.sh` already covers Node, Docker and dependencies. The probe ran with the existing setup.
- Cursor cloud: no environment change. `.cursor/environment.json` and `scripts/cloud-install.sh` are unchanged by this plan.
- A Cal live run needs more build time. That is a harness timeout decision at build time, not an environment change.

### 3e. Owner-only steps (never performed by the builder)

- Merge each PR (A to E) with **Create a merge commit**. Never squash (`CONTRIBUTING.md` "Merge and releases").
- Create and push the tag `v0.4.0` on the main merge commit of PR E.
- Verify the tag points at a commit in `main` history and that `npm run check` passed on that commit.
- Authorise the P5 foundation pin PR (`MP:631`): `package.json`, `package-lock.json` and `tests/unit/foundation.test.ts` change together.
- Update the P5 plan's `v0.3.2` references (`MP:317`, `MP:338`) to the release version, before the P5 pin PR.
- Decide whether `TWENTY_REQUIRE_FRESH` should be the default for CI (this plan keeps it opt-in).
- Decide whether `scripts/cloud-install.sh:104-120` (the Cal writer) stays after PR C. It is harmless to keep: it exits early when `.env` exists.
- Decide whether the Redis image is pinned by tag or digest. The compose file uses `image: redis`, unpinned.
- Decide MP:804(d) (see 1.3(d)).

### 3f. Downstream note (rev 2)

P5 rows stay gated `BLOCKED: <item> not in harness v0.3.1` until the P5 pin PR merges.

- `LOGIC_FUNCTION_TYPE` (item 1) gates the Twenty sandbox rows SND-001..004 (`MP:802`, section 19.5, and `MP:338`).
- `MEDUSA_FF_RBAC` (item 2) gates MED-RBAC-001 (`MP:803`).
- Item 3 is gated differently from what rev 1 said. **GQL-004 needs L-TW-B `tw-iso` complete, a fresh functional-profile stack, and P-9 first** (`MP:339`, `MP:837`, and the job rule at `MP:699`, which says `tw-limiter-last` "uses no reset capability"). **Item 3b blocks no current P5 row.** GQL-004 runs on a fresh stack without a reset. The reset is needed only if a future row asks for an in-stack reset.
- `PRODUCTS_ROOT` (item 4) removes a manual step (`MP:805`).
- The Cal `.env` (item 5) gates the Cal rows, with the blocker "harness must provision Cal .env" (`MP:786-789`).
- The canary (item 6) gates SND-001 (`MP:1019`), together with D8 and P-12.

Consumer pins at probe time (2d): P1 `v0.3.0`, P2 `v0.3.1`, P6 `v0.2.18`. The release is additive apart from item 4 (see 1.4).

---

### 3g. Live checks (rev 2)

Each check has an exact command and an expected result. Compose commands use the project directory of the Twenty fork, `TD=/home/user/products/twenty-CRM/packages/twenty-docker`, and the harness overlay. Keys and canary values are read from shell variables that the scripts never print. Every stack run ends with `down` in a `finally`. One product at a time.

Common setup (not a check):

```bash
export TD=/home/user/products/twenty-CRM/packages/twenty-docker
export TC="-p qa-harness-twenty -f $TD/docker-compose.yml -f /home/user/qa-portfolio-harness/docker/twenty.compose.yml"
export RL="API_RATE_LIMITING_LONG_TTL_IN_MS=3600000 API_RATE_LIMITING_LONG_LIMIT=5"
```

**L0 (step-0 STOP probe, before any build).** Confirm the seeded login reaches YCombinator, and create one API key in each seeded workspace.

- Command: `env $RL node scripts/up.mjs twenty && node scripts/smoke.mjs twenty`, then a GraphQL `createApiKey` in each workspace (mutation shape confirmed from `api-key.resolver.ts:80` at build time; the key value goes to a shell variable only).
- Expected: `smoke ok`; two keys created, one for Apple and one for YCombinator. If YCombinator is unreachable or key creation fails: **STOP**, and item 3b is re-scoped.
- Status now: UNPROBED.

**L1 (item 1, `LOGIC_FUNCTION_TYPE`).**

- Command: `LOGIC_FUNCTION_TYPE=local node scripts/up.mjs twenty; docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' qa-harness-twenty-server-1 | grep '^LOGIC_FUNCTION_TYPE='; node scripts/down.mjs twenty`
- Expected: `up` exit 0; grep prints `LOGIC_FUNCTION_TYPE=local`; `down` exit 0.
- Unset control: `node scripts/up.mjs twenty; docker inspect ... | grep -c '^LOGIC_FUNCTION_TYPE='` then `node scripts/down.mjs twenty`. Expected: `0` (grep exit 1 is also acceptable; the count is the check).

**L2 (item 6, canary, hash only).**

- Command: `HARNESS_TWENTY_CANARY_NAME=P5_CANARY_PROBE HARNESS_TWENTY_CANARY_VALUE="$CANARY" node scripts/up.mjs twenty`, then `docker exec qa-harness-twenty-server-1 sh -c 'printf %s "$P5_CANARY_PROBE" | sha256sum | cut -c1-16'` and, in the harness shell, `printf %s "$CANARY" | sha256sum | cut -c1-16`, then `node scripts/down.mjs twenty`.
- Expected: the two 16-character hex strings are identical. The canary value is never printed.
- Unset control: `docker exec qa-harness-twenty-server-1 printenv P5_CANARY_PROBE` on a stack started without the name. Expected: no output and exit code 1.
- Note: `printenv NAME | sha256sum` hashes the value plus a trailing newline. The check uses `printf %s` so the hash covers exactly the value.

**L3 (item 2, `MEDUSA_FF_RBAC`).**

- Command: `MEDUSA_FF_RBAC=true node scripts/up.mjs medusa; grep -c '^MEDUSA_FF_RBAC=true$' <medusa-dtc-starter>/apps/backend/.env; node scripts/down.mjs medusa`.
- Expected: `up` exit 0; grep prints `1`; `down` exit 0.
- Flag reading: `grep -c 'Using flag MEDUSA_FF_RBAC from environment with value true' <backend log>` expected `1`. The backend log path is confirmed at build step 0; it is UNPROBED now.

**L4 (item 3a, fresh stack and window).**

- Command, in order:
  1. `env $RL node scripts/up.mjs twenty && node scripts/smoke.mjs twenty` (seeds both workspaces).
  2. Target: five `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TARGET_KEY" http://127.0.0.1:3002/rest/people?limit=1`, then a sixth.
  3. Read-only key list: `docker compose $TC exec -T redis redis-cli --scan --pattern 'engine:usage-limit:*'`.
  4. `node scripts/down.mjs twenty` (no `-v`).
  5. `env $RL node scripts/up.mjs twenty`, then the same key list, then five requests on `$TARGET_KEY`.
  6. `node scripts/down.mjs twenty`.
- Expected: step 2 gives `200` five times, then `429`. Step 3 lists `engine:usage-limit:{20202020-1c25-4d02-bf25-6aeccf7ea419}:speed:API:API_REQUEST:apiKey:-:3600` (and a `:1` key). Step 5's key list before any request is empty. The first five requests after `up` return `200` inside the open 3600 s window. That proves a fresh counter, not a time-based reset.

**L5 (item 3a, `TWENTY_REQUIRE_FRESH`).**

- Command, with the volumes from L4 still present:
  1. `TWENTY_REQUIRE_FRESH=1 node scripts/up.mjs twenty`
  2. `docker ps -a --filter name=qa-harness-twenty --format '{{.Names}}'`
  3. `TWENTY_DOWN_VOLUMES=1 node scripts/down.mjs twenty; docker volume ls --format '{{.Name}}' | grep qa-harness-twenty`
  4. `TWENTY_REQUIRE_FRESH=1 node scripts/up.mjs twenty; node scripts/down.mjs twenty`
- Expected: step 1 exits 1 and the message names `qa-harness-twenty_db-data` and `qa-harness-twenty_server-local-data`. Step 2 prints nothing. Step 3 prints nothing from grep after `down -v`. Step 4 exits 0.

**L6 (item 3b, per-workspace reset, read-only SCAN plus targeted DEL).**

- Command, with `$TARGET_KEY` (Apple) and `$CONTROL_KEY` (YCombinator) created in L0:
  1. `env $RL node scripts/up.mjs twenty && node scripts/smoke.mjs twenty`.
  2. Five requests on `$TARGET_KEY`, then one more: expected `200` x5, then `429`.
  3. One request on `$CONTROL_KEY` to `/rest/people?limit=1`: expected `200`.
  4. `docker compose $TC exec -T redis redis-cli --scan --pattern 'engine:usage-limit:*'`: expected a list containing Apple's `{20202020-...}` keys and YCombinator's `{3b8e6458-...}` keys.
  5. `node scripts/reset-counters.mjs twenty 20202020-1c25-4d02-bf25-6aeccf7ea419`: expected output `matched N deleted N` with `N >= 1`, and no key value.
  6. Repeat step 4: expected Apple's `{20202020-...}` keys gone; YCombinator's `{3b8e6458-...}` keys still present; no `{server}` key deleted.
  7. Five requests on `$TARGET_KEY`: expected `200` x5 (inside the open window). Then `$CONTROL_KEY`: expected `200`, unaffected by the reset (MP:804(d) in-stack control).
  8. `node scripts/down.mjs twenty`.
- Refusals (run as separate commands, no stack needed): `node scripts/reset-counters.mjs twenty server` exits non-zero with `not a workspace UUID`; `node scripts/reset-counters.mjs twenty not-a-uuid` exits non-zero the same way.

**L7 (item 4, `PRODUCTS_ROOT`).**

- Command: `npm run build && node -e "import('./dist/config.js').then(m=>console.log(m.loadConfig().productsRoot))"` with `PRODUCTS_ROOT` unset.
- Expected: `/home/user/products` (the repo's parent is `/home/user`; products are at `/home/user/products`).
- Refusal check: `PRODUCTS_ROOT` unset with cwd under a `node_modules` directory throws `PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES`. This is a unit test; no live run.

**L8 (item 5, Cal, UNPROBED in this build).**

- Command: remove `<cal>/.env` (only in a disposable clone of the fork), then `node scripts/up.mjs cal`, then `stat -c %a <cal>/.env`, then `grep -c '^CALENDSO_ENCRYPTION_KEY=.' <cal>/.env`, then `grep -c 'http://localhost:3000' <cal>/.env`, then `node scripts/down.mjs cal`.
- Expected: `up` writes the file (the log names the generated keys, not the values); mode `600`; the key count is `1`; the `localhost` count is `0`.
- Volume guard: with `qa-harness-cal_db_data` present and `.env` deleted, `node scripts/up.mjs cal` exits 1 with `CAL_ENCRYPTION_KEY_VOLUME_EXISTS`.
- Reset: `CAL_DOWN_VOLUMES=1 node scripts/down.mjs cal` exits 0, and `docker volume ls --format '{{.Name}}' | grep qa-harness-cal_db_data` prints nothing.
- The `qa-harness-cal_db_data` name is from compose config, not a runtime observation: UNPROBED.

---

### 3h. Code skeletons (rev 2)

Signatures only. Bodies are built in PR order. No file in this plan changes.

**`src/adapters/twenty-passthrough.ts` (PR A, commit 1)**

```ts
export const TWENTY_PASSTHROUGH_ENV = [
  "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS",
  "IS_BILLING_ENABLED",
  "IS_MULTIWORKSPACE_ENABLED",
  "BILLING_STRIPE_API_KEY",
  "BILLING_STRIPE_WEBHOOK_SECRET",
  "BILLING_STRIPE_PUBLISHABLE_KEY",
  "LOGIC_FUNCTION_TYPE", // appended; upstream config-variables.ts:732-735
] as const;
```

**`src/adapters/twenty-runtime-override.ts`: `readTwentyLogicFunctionType` (PR A, commit 1)**

```ts
export const LOGIC_FUNCTION_TYPE_VALUES = ["DISABLED", "LAMBDA", "LOCAL"] as const;

/** Undefined when unset or blank. Throws TWENTY_LOGIC_FUNCTION_TYPE_INVALID for any other value. */
export function readTwentyLogicFunctionType(env: NodeJS.ProcessEnv): string | undefined;

// writeTwentyRuntimeOverride calls it first, before any fs call:
//   readTwentyLogicFunctionType(opts.env);
```

**`src/adapters/medusa-env.ts`: `MEDUSA_FF_RBAC` (PR A, commit 2)**

```ts
export const MEDUSA_FF_RBAC_VALUES = ["true", "false"] as const;

/** Undefined when unset or blank. Throws MEDUSA_FF_RBAC_INVALID for any other value. */
export function readMedusaFfRbac(env: Record<string, string | undefined>): "true" | "false" | undefined;

export interface MedusaBackendEnvInput {
  databaseUrl: string;
  redisUrl?: string;
  stripeApiKey?: string;
  stripeWebhookSecret?: string;
  /** Written only when defined. Unset leaves the template line as it is. */
  ffRbac?: "true" | "false";
}

/** Like upsertEnvLine, but never deletes: undefined is a no-op. */
function setEnvLineIfDefined(lines: string[], key: string, value: string | undefined): void;
```

**`src/adapters/twenty-canary.ts` (PR A, commit 3)**

```ts
export const CANARY_NAME_ENV = "HARNESS_TWENTY_CANARY_NAME";
export const CANARY_VALUE_ENV = "HARNESS_TWENTY_CANARY_VALUE";
export const CANARY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Undefined when unset. Throws for a bad name, a collision with `reserved`, or a blank value with a name. */
export function readTwentyCanary(
  env: NodeJS.ProcessEnv,
  reserved: ReadonlySet<string>,
): { readonly name: string } | undefined;

/** The override lines: the reference only, never the value. */
export function canaryYamlLines(canary: { readonly name: string } | undefined): string[];
// -> ["      NAME: ${HARNESS_TWENTY_CANARY_VALUE}"] for server and worker
```

**`src/adapters/twenty-limiter-reset.ts` (PR D, commit 8)**

```ts
export const SPEED_COUNTER_PREFIX = "engine:usage-limit:";
export const SHARED_SERVER_HASH_TAG = "server";

/** Throws unless the id is a UUID and is not `server`. */
export function assertDisposableWorkspaceId(workspaceId: string): void;

/** `engine:usage-limit:{<id>}:speed:*` */
export function speedCounterPattern(workspaceId: string): string;

/** ["compose", "-p", "qa-harness-twenty", "-f", <file>..., "exec", "-T", "redis", "redis-cli", ...redisArgs] */
export function buildComposeRedisArgv(files: readonly string[], redisArgs: readonly string[]): string[];

export type RedisCliRunner = (argv: readonly string[]) => Promise<string>;

/** One key per line, from `redis-cli --scan --pattern ...`. */
export function parseScanOutput(stdout: string): string[];

/** Throws if any key lacks the exact `{<workspaceId>}` hash tag. */
export function assertAllKeysInWorkspace(keys: readonly string[], workspaceId: string): void;

export interface ResetResult {
  readonly matched: number;
  readonly deleted: number;
}

/** SCAN, check every key, then DEL the listed keys in batches of 500. Never FLUSH. */
export function resetWorkspaceSpeedCounters(opts: {
  workspaceId: string;
  files: readonly string[];
  run: RedisCliRunner;
}): Promise<ResetResult>;
```

**`src/adapters/twenty-env.ts`: `TWENTY_REQUIRE_FRESH` (PR D, commit 9)**

```ts
/** True only for the exact value "1". Undefined or blank is false. Any other non-blank value throws TWENTY_REQUIRE_FRESH_INVALID. */
export function readTwentyRequireFresh(env: NodeJS.ProcessEnv): boolean;

/** Throws, naming the volumes, when requireFresh is set and a harness volume exists. Called before composeUp. */
export function assertTwentyFreshOrRefuse(opts: {
  requireFresh: boolean;
  volumes: TwentyVolumeCheck;
  projectName?: string;
}): void;
```

**`src/adapters/cal-env.ts` (PR C, commit 6)**

```ts
export const CAL_GENERATED_KEY_BYTES = { NEXTAUTH_SECRET: 32, CALENDSO_ENCRYPTION_KEY: 24 } as const;

/** "missing" = the key is absent; "placeholder" = present with an empty value (as .env.example ships it); "real" = non-empty. */
export type CalEnvValueState = "missing" | "placeholder" | "real";
export function classifyCalEnvValue(value: string | undefined): CalEnvValueState;

/** Replaces "http://localhost:3000" only. Used on creation, as cloud-install.sh:113 does. */
export function rewriteLocalhostToLoopback(text: string): string;

export interface CalEnvFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: "utf8"): string;
  writeFileSync(p: string, data: string, opts: { mode: number }): void;
  copyFileSync(from: string, to: string): void;
  chmodSync(p: string, mode: number): void;
}

export interface EnsureCalRootEnvOptions {
  productRoot: string;
  fs: CalEnvFs;
  randomBytes(size: number): Buffer;
  /** True when qa-harness-cal_db_data exists. */
  calDbVolumeExists(): boolean;
}

export interface EnsureCalRootEnvResult {
  readonly createdFromExample: boolean;
  /** Names only, e.g. ["NEXTAUTH_SECRET"]. Never values. */
  readonly generated: readonly string[];
}

/** Throws CAL_ENCRYPTION_KEY_VOLUME_EXISTS when a new CALENDSO_ENCRYPTION_KEY would be written over an existing volume. */
export function ensureCalRootEnv(opts: EnsureCalRootEnvOptions): EnsureCalRootEnvResult;

/** ["-v"] only when CAL_DOWN_VOLUMES is exactly "1". */
export function calDownArgs(env: NodeJS.ProcessEnv): readonly string[];
```

**`scripts/reset-counters.mjs` (PR D, commit 8)**

```text
usage: node scripts/reset-counters.mjs twenty <workspaceId>
  - refuses unless <workspaceId> is a UUID and is not "server"
  - prints: "matched N deleted N" (no keys, no values)
  - exit 0 on success, 1 on refusal or redis-cli error
```

---

## Appendix A. Probe record

### 2a. Re-read at v0.3.1

Every cited `file:line` was re-read at `7d4a3ae`. There is no CONTRADICTS. Each correction is listed in section 0.1. Upstream lines were read from the Twenty fork at `7cbdfec6` (`7cbdfec6f346b43715bc2056932f4fad5886f733`).

Checks: `grep -rn LOGIC_FUNCTION src/`, `grep -rn MEDUSA_FF_RBAC src/`, `grep -rni canary src/` (no match). Medusa `2.21.2` `rbac.js` and `register-flag.js`. Twenty `config-variables.ts`, `logic-function-driver.interface.ts`, usage-limit constants and utilities, cache-storage `getKey`, `flushByPattern`, `flush`, the throttler, and upstream `docker-compose.yml`.

### 2b. npm ci and npm run check

- `npm ci`: exit 0, `found 0 vulnerabilities`.
- `npm run check`: exit 0. `tsc --noEmit` passed. `npm test`: `# tests 365`, `# suites 138`, `# pass 364`, `# fail 0`, `# skipped 1`, `# todo 0`. Build passed.

### 2c. Live probe: Twenty, one product, down in a trap

- `node scripts/up.mjs twenty`: exit 0. The up log showed `qa-harness-twenty-db-1` healthy and the server starting; the harness then reported the stack up for `twentycrm/twenty:v2.44.0`.
- `node scripts/smoke.mjs twenty`: exit 0. The seed ran `workspace:seed:dev` (both workspaces, since `--light` was not passed). `authenticate` returned a session. `proveAuth` returned `currentUser.email` for `jane.austen@apple.dev` (HTTP 200). `postgres SELECT 1` returned `ok: 1`. The last line was `smoke ok`. The token is not reproduced.
- `node scripts/down.mjs twenty`: exit 0. `docker ps -a --filter name=qa-harness` returned 0 containers. Volumes were not checked; `down` runs without `-v`, so named volumes are kept by design.

Limiter backing store: identified from source (Redis, `engine:usage-limit`). Live counter keys: UNPROBED, because the smoke path uses Bearer login, not an API key, and the stack was torn down before any read. No Redis read or write was performed.

Cal live: UNPROBED. Cal was not started. The root `.env` at `/home/user/products/cal/.env` (mode 600) was written by `scripts/cloud-install.sh` at install.

### 2d. Consumer pins

| Consumer | Repo | Commit checked | `package.json` | `package-lock.json` |
|---|---|---|---|---|
| P1 | `Jayami123/playwright-e2e-ci-framework` | HEAD `2bbdf8b` | `#v0.3.0` (line 38) | `#v0.3.0` (line 9) |
| P2 | `Jayami123/api-webhook-db-test-suite` | `99a2fde` and HEAD `ffa9fd3` | `#v0.3.1` (line 26) | `#v0.3.1` (line 9) |
| P6 | `Jayami123/k6-load-concurrency-suite` | `0533e61` and HEAD `0533e61` | `#v0.2.18` (line 63) | `#v0.2.18` (line 9) |

All three pins are at or below v0.3.1. The release is additive except for item 4 (1.4).

### 2e. Rev 2 verification log

- `docker image inspect redis`: `Config.Volumes = null`, digest `sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53`. No anonymous volume.
- `docker compose -p qa-harness-cal -f <prisma compose> -f docker/cal.compose.yml ... config --volumes` lists `db_data`. Runtime name UNPROBED.
- Twenty fork seed: `data-seed-dev-workspace.command.ts:43-45` (both workspaces unless `--light`). IDs in `seeder-workspaces.constant.ts`.
- P5 plan lines: `MP:317` and `MP:338` name v0.3.2; `MP:339` (GQL-004 needs a fresh functional-profile stack and P-9); `MP:699` (`tw-limiter-last` uses no reset); `MP:837` (P-9); `MP:804` (items a to d).
- Consumer `PRODUCTS_ROOT` settings: section 1.4.
- Not run in revision 2: any live check, including the Twenty stack. The Twenty stack was run in revision 1 only.

### 2f. Checks not run

- `npm run smoke -- cal` (CONTRIBUTING "Before you push"): not run. Cal is UNPROBED (2c).
- Documenso and Medusa live: not run (one product at a time; scope is Twenty).
