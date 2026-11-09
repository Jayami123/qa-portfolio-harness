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
| Cal.diy   | `../products/cal`                         | web 3000, API v2 **5555**, pg 5450, Redis **6381** (harness compose) |
| Documenso | `../products/documenso`                   | web **3001**, pg **5451** (harness compose), SMTP 2525 |
| Medusa    | `../products/medusa-dtc-starter`          | backend **9000**, pg **5433** (harness compose) |
| Twenty    | `../products/twenty-CRM`                  | app **3002**, pg 5434          |

Cal defaults to web **3000**. `up cal` also starts the Cal API v2 on **127.0.0.1:5555** (health `GET /health` → `OK`, not `/v2/health`) and Redis on **127.0.0.1:6381** (`REDIS_URL`); `down cal` stops both. If port 5555 or 3000 is held by a process the harness did not start, `up` stops and names it. Documenso is started by the harness on **127.0.0.1:3001**. Twenty’s compose overlay publishes **3002**. This harness does **not** change product defaults.

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

## Cloud environments

One install script serves both clouds: `scripts/cloud-install.sh`. It runs `npm ci`, clones each product fork at its pinned commit into `PRODUCTS_ROOT` (default `../products`, outside this repo), and installs that product's dependencies. It stops when a clone sits at another commit, and it stops when Cal's `packages/prisma/.env` is not a real symlink.

Environment variables read by `cloud-install.sh` (names only; set them in the cloud environment, never in a file):

| Variable | Default | Meaning |
|---|---|---|
| `PRODUCTS_ROOT` | `../products` from the current directory | Where the forks are cloned. Unset or blank: `../products` next to the directory you run from, never inside `node_modules` (refused with `PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES`). |
| `HARNESS_PRODUCTS` | `cal documenso medusa twenty` | Subset to prepare, space-separated |
| `NODE24` | `/opt/node24/bin/node` (Cloud) | Node 24 binary. Required only when `documenso` is selected |

### Cursor cloud

**Automatic from the repo:**
- `.cursor/Dockerfile`: Ubuntu 24.04, Node 22.23.3 on `PATH`, Node 24.21.0 as `$NODE24`, pnpm 10.11.1 through corepack, Docker 28.5.2 with `fuse-overlayfs`, and a non-root `ubuntu` user.
- `.cursor/environment.json`: `install` runs `bash scripts/cloud-install.sh`, and `start` runs `sudo service docker start`.

**Pasted by hand (Cursor settings):**
- Point the cloud environment's location at this repo's `.cursor/environment.json`, and build from `.cursor/Dockerfile`.
- Environment variables (optional): `HARNESS_PRODUCTS`, `PRODUCTS_ROOT`.
- Docker Hub (optional): `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Cursor has no session-start hook, so nothing logs in for you there. To log in by hand, run `printf '%s' "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin`. Allow `index.docker.io` in the network list.
- Network access: allow the domains in the list below.
- Cursor builds from the default branch, so changes under `.cursor/` apply after they merge to `main`.

### Claude Code cloud

**Automatic from the repo:**
- `.claude/settings.json`: the `SessionStart` hook, and no Claude attribution lines in commits or PRs.
- `.claude/hooks/session-start.sh` (cloud sessions only): puts `/usr/local/bin` first on `PATH`, exports `NODE24`, starts Docker in its own session (`setsid -f`, so it keeps running after the hook ends), and prints `WARNING:` lines on stderr when Node 24 or the harness dependencies are missing.

**Pasted by hand (Claude Code environment, Edit):**
1. **Setup script:** paste the script below as it is.
2. **Network access:** Limited, with "Allow package managers" ticked, and these domains:

   | Domain | Why |
   |---|---|
   | `nodejs.org` | Node 22.23.3 and 24.21.0 tarballs and `SHASUMS256.txt` (setup script) |
   | `registry.npmjs.org` | `npm ci` for the harness and Documenso, pnpm packages |
   | `repo.yarnpkg.com` | Corepack fetches Yarn 4 for the Cal fork |
   | `github.com`, `codeload.github.com` | product fork clones |
   | `archive.ubuntu.com`, `security.ubuntu.com`, `ports.ubuntu.com` | apt packages (Docker prerequisites) |
   | `download.docker.com` | Docker apt repository and signing key |
   | `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | product and Docker images |
   | `index.docker.io` | Docker Hub login (`docker login` in the session-start hook, when `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set) |

3. **Environment variables:**
   - Git identity, so commits are attributed to the owner: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`.
   - Optional: `HARNESS_PRODUCTS`, `PRODUCTS_ROOT`.
   - Optional Docker Hub login (avoids anonymous pull limits): `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. When both are set, the session-start hook runs `docker login --password-stdin` and prints `harness: docker login ok`, or a `harness:` error line. The token is never printed. Docker Hub account names are lowercase. If `DOCKERHUB_USERNAME` has an uppercase letter, the hook prints a `harness:` error that names the variable and skips the login; set the lowercase name. Use a read-only Docker Hub access token.
   - No product passwords. Do not add any `*_PASSWORD` variable here.

**Setup script (root, idempotent; any failure exits non-zero with a `harness:` line):**

```bash
# --- qa-portfolio-harness: toolchain, Docker, dependencies and product forks (root, idempotent) ---
set -euo pipefail
HARNESS_NODE22_VERSION=22.23.3
HARNESS_NODE24_VERSION=24.21.0
HARNESS_PNPM_VERSION=10.11.1
HARNESS_DOCKER_VERSION=5:28.5.2-1~ubuntu.24.04~noble
# The checkout: the cloud's project directory, else the current directory. Never a fixed path.
HARNESS_REPO="${CLAUDE_PROJECT_DIR:-$PWD}"
if [ ! -f "$HARNESS_REPO/package.json" ] || ! grep -q '"name": "qa-portfolio-harness"' "$HARNESS_REPO/package.json"; then
  echo "harness: ERROR no qa-portfolio-harness checkout at $HARNESS_REPO (set CLAUDE_PROJECT_DIR to it)" >&2
  exit 1
fi

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

case "$(uname -m)" in
  x86_64) harness_arch=x64 ;;
  aarch64) harness_arch=arm64 ;;
  *) echo "harness: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

# harness_install_node <version> <prefix>: skip if installed, else download and verify before extracting.
harness_install_node() {
  local version="$1" prefix="$2" tar tmp
  tar="node-v$version-linux-$harness_arch.tar.xz"
  if [ "$("$prefix/bin/node" -v 2>/dev/null)" = "v$version" ]; then return 0; fi
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$tmp/$tar" "https://nodejs.org/dist/v$version/$tar"
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$version/SHASUMS256.txt"
  (cd "$tmp" && grep " $tar\$" SHASUMS256.txt | sha256sum -c -)
  if [ "$prefix" != /usr/local ]; then $SUDO rm -rf "$prefix"; fi
  $SUDO mkdir -p "$prefix"
  $SUDO tar -xJf "$tmp/$tar" -C "$prefix" --strip-components=1
  rm -rf "$tmp"
}

# Docker from Docker's apt repository (as in .cursor/Dockerfile). Skipped when docker is already present.
harness_install_docker() {
  if command -v docker >/dev/null 2>&1; then return 0; fi
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq "docker-ce=$HARNESS_DOCKER_VERSION" "docker-ce-cli=$HARNESS_DOCKER_VERSION" containerd.io docker-buildx-plugin docker-compose-plugin
}

# Start the daemon when it is not answering (no systemd in many cloud images).
harness_start_docker() {
  if docker info >/dev/null 2>&1; then return 0; fi
  ($SUDO dockerd > /tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  echo "harness: dockerd did not start; see /tmp/dockerd.log" >&2
  return 1
}

harness_install_node "$HARNESS_NODE22_VERSION" /usr/local
harness_install_node "$HARNESS_NODE24_VERSION" /opt/node24
export PATH="/usr/local/bin:$PATH"
$SUDO corepack enable
corepack prepare "pnpm@$HARNESS_PNPM_VERSION" --activate
harness_install_docker
harness_start_docker
echo "node $(node -v), node24 $(/opt/node24/bin/node -v), pnpm $(cd / && pnpm -v), docker $(docker version --format '{{.Server.Version}}')"

# Dependencies and forks: any failure stops here with a "harness:" line and a non-zero exit.
if [ ! -f "$HARNESS_REPO/scripts/cloud-install.sh" ]; then
  echo "harness: ERROR scripts/cloud-install.sh is missing in $HARNESS_REPO" >&2
  exit 1
fi
bash "$HARNESS_REPO/scripts/cloud-install.sh" || { echo "harness: ERROR cloud-install.sh failed (exit $?); see the lines above" >&2; exit 1; }
```

Limits of this script: Claude Code snapshots an environment only when its setup script finishes in about five minutes ([environment caching](https://code.claude.com/docs/en/cloud-environments#environment-caching)). `cloud-install.sh` runs the Cal yarn install (about 21 minutes in this repo's run), so the snapshot is not taken on a full install. To cache a faster set, put `HARNESS_PRODUCTS=twenty` in the environment variables. Products then install on demand with `bash scripts/cloud-install.sh` in the session.

**Symlinks.** Cal's `packages/prisma/.env` must be a real symlink. A Windows host without symlink rights writes a plain file, and `cloud-install.sh` stops there with the reason. Cloud Linux images create the symlink.

## Limitations / TODOs

Honest gaps:

- **Cal** `up cal` writes the root `.env` when it is missing, with generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`, mode 600. Values are never printed. Real values are never overwritten. If the Cal database volume exists, `up` refuses to create a new encryption key; reset with `CAL_DOWN_VOLUMES=1 npm run down -- cal`. `scripts/cloud-install.sh` still writes the same file at install time; it exits early when the file exists.
- **Cal** `CAL_DOWN_VOLUMES=1` (exactly `1`) removes the Cal database volume on `down`; anything else keeps it.
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
| `HARNESS_EL_PRELOAD` | off | Absolute path to a readable file (no whitespace). When set, Cal's web server, the Medusa backends (`server` and `server-2`), the Documenso app and the Twenty server and worker start with `--require=<file>` in `NODE_OPTIONS`. The Documenso env is shared with its build and seed commands, so they get it too. The preload writes NDJSON to `HARNESS_EL_OUT`. Blank or empty is off. A relative, missing, unreadable or whitespace-containing path makes `up()` fail. The Medusa `pnpm` build, migrate and seed steps and Cal's non-web commands never get it. |
| `HARNESS_EL_OUT` | required with `HARNESS_EL_PRELOAD` | Absolute directory where the preload writes `el-<pid>.ndjson`. Created with `mkdir -p` when missing. For Twenty it is set to mode `0777`, because the containers run as UID 1000. |
| `HARNESS_PG_STATS` | off | Exactly `1` turns on `pg_stat_statements` for the four harness-owned Postgres databases (Medusa, Documenso, Cal, Twenty). Each database gets `shared_preload_libraries=pg_stat_statements` and `track_io_timing=on` through an opt-in `docker/<product>.pg-stats.compose.yml` overlay, and `CREATE EXTENSION IF NOT EXISTS` runs once after the database is healthy, as the compose superuser (`POSTGRES_USER`). Any other value, including empty, is off. |
| `MEDUSA_FF_RBAC` | unset | Exactly `true` or `false` is written into the harness-generated backend `.env`. Unset or blank leaves the file unchanged (Medusa default `false`). Any other value, including `1` or `TRUE`, makes `up()` fail before the file is written. |

- **Twenty** pins `twentycrm/twenty:v2.44.0` (overlay + `TWENTY_IMAGE_TAG`; `latest` is rejected). Compose `healthcheck.start_period` is 300s so `--wait` survives a slow first boot. App is on **127.0.0.1:3002**; health requires HTTP **200** on `/healthz`. `up()` bootstraps gitignored `ENCRYPTION_KEY` / `APP_SECRET` when missing or placeholder; if Twenty volumes already exist, it refuses to generate new keys while either value is still missing or a placeholder (reset with `down -v`; see CHANGELOG). It does not verify keys against volume contents. Mailpit UI **8025** and SMTP **1025** do not overlap Documenso Inbucket **9003** / **2525**.
- **Twenty** smoke defaults: Admin `jane.austen@apple.dev` and shared dev-seeder `TWENTY_PASSWORD` (fork `seed-users.util.ts`; set overrides in harness `.env`, do not commit). `authenticate()` uses `signIn` on `/metadata`, then `getAuthTokensFromLoginToken` with workspace `subdomainUrl` when needed. `proveAuth()` reads `currentUser.email` on `/metadata`. Optional `TWENTY_API_KEY` bypasses login.
- **Twenty** harness compose is fork `docker-compose.yml` + `docker/twenty.compose.yml` only (no fork `docker-compose.validation.yml`). Mailpit and SMTP live in the overlay; `IS_MULTIWORKSPACE_ENABLED=false` so smoke auth uses `127.0.0.1:3002` without workspace subdomains.
- **Twenty** rate-limit knobs (optional): `API_RATE_LIMITING_SHORT_TTL_IN_MS`, `API_RATE_LIMITING_SHORT_LIMIT`, `API_RATE_LIMITING_LONG_TTL_IN_MS`, `API_RATE_LIMITING_LONG_LIMIT`, `APPLICATION_API_RATE_LIMITING_TTL_IN_MS` and `APPLICATION_API_RATE_LIMITING_LIMIT` are read from the harness process at `up()` and written into the Twenty server and worker when set to a whole number of at least 1. Exact-name allowlist: nothing else is forwarded under this rule (the opt-in `LOGIC_FUNCTION_TYPE` and canary variables below are separate). Unset or blank keeps the image default (`1000`, `100`, `60000`, `100`, `60000`, `500` in that order); a blank value is never written, because Twenty reads an empty value as 0. With no variable set, no override file is written (`.harness/twenty.runtime.compose.yml` is removed if a previous run left it). A value that is not a whole number of at least 1 makes `up()` fail before any file is written.
- **Twenty** opt-in `LOGIC_FUNCTION_TYPE` (`DISABLED`, `LAMBDA` or `LOCAL`, case-insensitive) is forwarded to the server and worker by name when set. Unset passes nothing, so the upstream default applies.
- **Twenty** opt-in `HARNESS_TWENTY_CANARY_NAME` and `HARNESS_TWENTY_CANARY_VALUE` write one caller-named variable into the Twenty server and worker. The name must match `^[A-Z][A-Z0-9_]{2,63}$` and must not collide with a harness-owned name. The value is never logged or written to disk; it reaches the container by compose interpolation.
- **Twenty** contract: after `down` without `-v`, counters are empty and rows are kept. After `down -v` (`TWENTY_DOWN_VOLUMES=1`), counters and rows are both empty, and the next `up` must be seeded by smoke or by an explicit seed. A first non-429 is not evidence of either (MP:804).
- **Twenty** opt-in `TWENTY_REQUIRE_FRESH=1` (exactly `1`): `up` refuses before compose when `qa-harness-twenty_db-data` or `qa-harness-twenty_server-local-data` exists, and names the volumes that exist. Unset or blank does nothing; any other value makes `up` fail with `TWENTY_REQUIRE_FRESH_INVALID`. Reset with `TWENTY_DOWN_VOLUMES=1 npm run down -- twenty`.
- **Twenty** A per-workspace limiter reset (P5 request item 3b) is deferred: no current P5 row uses one, and the in-stack second-workspace control is unreachable while `IS_MULTIWORKSPACE_ENABLED` is false.
- **Twenty** P1 later: listen/health at `TWENTY_BASE_URL`. Multi-workspace forks may use `workspaceUrls.subdomainUrl` in the browser; harness smoke does not. Tokens: httpOnly session cookie (`packages/twenty-front/src/modules/auth/hooks/useMarkSessionActive.ts` lines 8–10); client flag `isCookieAuthActiveState` in `localStorage` (`…/states/isCookieAuthActiveState.ts` lines 3–10).
- No Playwright, page objects, k6, ZAP, or P1–P7 test suites in this repo.
- `createPgClient` does **not** run migrations. Use a read-only DB role in shared environments.

### Known gaps (post v0.2.2)

- ESLint and Prettier (same setup as P1).
- Unit tests for pure modules (config parsing, timeouts, URL handling, redaction) plus a `test` script and CI job.
- Bump `package.json` `engines.node` to `>=22` (Node 20 reached end-of-life in April 2026; CI uses Node 22 via `.nvmrc`).

## License

[MIT](LICENSE) — Copyright (c) 2026 Jayami Hettigoda. Not published to npm; consumers install from Git tags.
