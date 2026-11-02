#!/usr/bin/env bash
# One install entry point for cloud environments (Cursor `install`, Claude Code setup script).
#
# Steps: npm ci for the harness, then for each selected product fork a clone at its pinned commit
# under PRODUCTS_ROOT, then that product's dependencies (the same steps as the P2 bootstrap).
#
# - PRODUCTS_ROOT: default ../products (outside this repo). Set it to override.
# - HARNESS_PRODUCTS: space-separated subset of "cal documenso medusa twenty". Default: all four.
# - NODE24: path to a Node 24 binary. Required when documenso is selected (its fork needs Node >= 24).
# - Idempotent. An existing checkout at the pin is kept. A checkout at another commit stops the run.
# - Never prints secrets and never writes a product .env file.
# - Cal's packages/prisma/.env is a git symlink. If the clone does not produce a real symlink, the run stops.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Refuse to run anywhere except the harness checkout, so a wrong path cannot create product folders.
if ! grep -q '"name": "qa-portfolio-harness"' "$REPO_ROOT/package.json" 2>/dev/null; then
  printf 'harness: ERROR %s is not the qa-portfolio-harness checkout (no matching package.json)\n' "$REPO_ROOT" >&2
  exit 1
fi
cd "$REPO_ROOT"
# Any failure, including one set -e does not report by name, exits non-zero with a "harness:" line.
on_err() { printf 'harness: ERROR cloud-install.sh failed at line %s (exit %s)\n' "$1" "$2" >&2; }
trap 'on_err "$LINENO" "$?"' ERR

# Pins: the same commits as the P2 lane bootstrap (plan/2026-11-02-p2-lane-*).
CAL_REF="c2b7ac44c66f24ffef1662b276f0653988a609a3"
DOCUMENSO_REF="f4105e47eba56f5d8d7e70dd516a8fcc0c870d7c"
MEDUSA_REF="f677db438f27294fc50e4c7c6612e71ff38eeff5"
TWENTY_REF="7cbdfec6f346b43715bc2056932f4fad5886f733"
MEDUSA_PNPM="10.11.1"
ALL_PRODUCTS="cal documenso medusa twenty"

log() { printf 'harness: %s\n' "$*"; }
fail() { printf 'harness: ERROR %s\n' "$*" >&2; exit 1; }

product_url() {
  case "$1" in
    cal) echo https://github.com/Jayami123/cal.git ;;
    documenso) echo https://github.com/Jayami123/documenso.git ;;
    medusa) echo https://github.com/Jayami123/medusa-dtc-starter.git ;;
    twenty) echo https://github.com/Jayami123/twenty-CRM.git ;;
    *) fail "unknown product '$1' (use: $ALL_PRODUCTS)" ;;
  esac
}

product_ref() {
  case "$1" in
    cal) echo "$CAL_REF" ;;
    documenso) echo "$DOCUMENSO_REF" ;;
    medusa) echo "$MEDUSA_REF" ;;
    twenty) echo "$TWENTY_REF" ;;
  esac
}

# Folder names the harness resolves under PRODUCTS_ROOT (src/config.ts).
product_dir_name() {
  case "$1" in
    cal) echo cal ;;
    documenso) echo documenso ;;
    medusa) echo medusa-dtc-starter ;;
    twenty) echo twenty-CRM ;;
  esac
}

# Clone at the pinned commit. An existing checkout is kept only when it sits at that commit.
clone_pinned() {
  local url="$1" ref="$2" dest="$3" head
  if [ -d "$dest/.git" ] && head="$(git -C "$dest" rev-parse --verify -q HEAD)"; then
    if [ "$head" = "$ref" ]; then
      log "$dest already at the pin ($ref). Kept."
      return
    fi
    fail "$dest is at $head, the pin is $ref. Move it away and rerun."
  fi
  if [ -d "$dest" ] && [ -n "$(ls -A "$dest")" ]; then
    fail "$dest exists, is not empty and is not a git checkout. Move it away and rerun."
  fi
  log "cloning $url at $ref (depth 1) into $dest"
  mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote add origin "$url"
  # core.symlinks=true asks git for real symlinks. On Windows without symlink rights git writes a plain
  # file instead, and check_cal_symlink then stops the run.
  git -C "$dest" -c core.symlinks=true fetch -q --depth 1 origin "$ref"
  git -C "$dest" -c core.symlinks=true -c advice.detachedHead=false checkout -q FETCH_HEAD
  log "cloned $(git -C "$dest" rev-parse HEAD)"
}

# packages/prisma/.env must be a real symlink (index mode 120000, and a symlink on disk) that resolves.
check_cal_symlink() {
  local dest="$1" link mode
  link="$dest/packages/prisma/.env"
  mode="$(git -C "$dest" ls-files -s -- packages/prisma/.env | cut -d' ' -f1)"
  if [ "$mode" != "120000" ]; then
    fail "packages/prisma/.env is not a symlink in the Cal index (mode '${mode:-none}'). Check the clone."
  fi
  if [ ! -L "$link" ]; then
    fail "packages/prisma/.env is a plain file on disk, not a symlink. Git symlinks are off here (core.symlinks=false or no symlink permission). Enable symlinks and rerun."
  fi
  log "Cal packages/prisma/.env is a real symlink -> $(readlink "$link")"
}

# The symlink target is the Cal root .env. Same steps as the P2 bootstrap (prepare_cal_env): copy .env.example
# when .env is missing, point the web URL at 127.0.0.1, and append locally generated test-only secrets.
# Existing .env is left as is. Values are never printed. The file is created with mode 600.
prepare_cal_env() {
  local dest="$1" tmp
  if [ -f "$dest/.env" ]; then log "$dest/.env exists. Left as is."; return; fi
  [ -f "$dest/.env.example" ] || fail "$dest/.env.example is missing; cannot create the Cal root .env."
  umask 077
  cp "$dest/.env.example" "$dest/.env"
  sed -i 's|http://localhost:3000|http://127.0.0.1:3000|g' "$dest/.env"
  tmp="$dest/.env.tmp"
  grep -v '^NEXTAUTH_SECRET=' "$dest/.env" | grep -v '^CALENDSO_ENCRYPTION_KEY=' > "$tmp"
  mv "$tmp" "$dest/.env"
  printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> "$dest/.env"
  printf 'CALENDSO_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 24)" >> "$dest/.env"
  log "wrote $dest/.env (generated secrets not shown)"
}

# After prepare_cal_env, the symlink target must exist. Fail loudly when it does not.
require_cal_target() {
  local dest="$1"
  [ -e "$dest/packages/prisma/.env" ] || fail "packages/prisma/.env resolves to nothing. The Cal root .env was not created."
  log "Cal root .env present (values not shown)"
}

# Yarn 4 can print "Failed with error" in its link step and still exit 0. Then its build scripts (Prisma
# generate among them) do not run. The first pass on a fresh checkout hits this (EEXIST while it persists the
# workspace symlink it just created); a second pass completes. So: retry once, and fail when it still fails.
install_cal() {
  local dest="$1" attempt out rc
  if [ -d "$dest/node_modules" ]; then log "$dest/node_modules exists. Install skipped."; return; fi
  for attempt in 1 2; do
    out="$(mktemp)"
    log "yarn install --immutable in $dest (attempt $attempt)"
    set +e
    (cd "$dest" && TURBO_TELEMETRY_DISABLED=1 COREPACK_ENABLE_STRICT=0 corepack yarn install --immutable) 2>&1 | tee "$out"
    rc=${PIPESTATUS[0]}
    set -e
    if [ "$rc" -eq 0 ] && ! grep -q 'Failed with error' "$out"; then rm -f "$out"; return; fi
    rm -f "$out"
    log "yarn install in $dest failed (exit $rc, or 'Failed with error' in the output); attempt $attempt"
  done
  fail "yarn install in $dest failed twice. Build scripts such as Prisma generate did not run. Remove $dest/node_modules and rerun."
}

install_medusa() {
  local dest="$1"
  if [ -d "$dest/node_modules" ]; then log "$dest/node_modules exists. Install skipped."; return; fi
  log "pnpm install --frozen-lockfile in $dest"
  (cd "$dest" && COREPACK_ENABLE_STRICT=0 corepack "pnpm@$MEDUSA_PNPM" install --frozen-lockfile)
}

install_documenso() {
  local dest="$1" node24="${NODE24:-/opt/node24/bin/node}"
  if [ -d "$dest/node_modules" ]; then log "$dest/node_modules exists. Install skipped."; return; fi
  [ -n "$node24" ] && [ -x "$node24" ] || fail "documenso needs Node >= 24. Set NODE24 to a Node 24 binary."
  log "npm ci in $dest (Node $("$node24" --version))"
  (cd "$dest" && PATH="$(dirname "$node24"):$PATH" npm ci)
}

# Harness dependencies first.
if [ -f package-lock.json ]; then
  npm ci
else
  fail "package-lock.json is missing. Cannot run npm ci."
fi

# Products root: env, else ../products next to this repo. Created if missing.
products_root="${PRODUCTS_ROOT:-$REPO_ROOT/../products}"
mkdir -p "$products_root"
products_root="$(cd "$products_root" && pwd)"
log "PRODUCTS_ROOT=$products_root"

selected="${HARNESS_PRODUCTS:-$ALL_PRODUCTS}"
for product in $selected; do
  product_url "$product" >/dev/null
  dest="$products_root/$(product_dir_name "$product")"
  clone_pinned "$(product_url "$product")" "$(product_ref "$product")" "$dest"
  if [ "$product" = "cal" ]; then check_cal_symlink "$dest"; fi
done

for product in $selected; do
  dest="$products_root/$(product_dir_name "$product")"
  case "$product" in
    cal) install_cal "$dest"; prepare_cal_env "$dest"; require_cal_target "$dest" ;;
    medusa) install_medusa "$dest" ;;
    documenso) install_documenso "$dest" ;;
    twenty) ;; # the Twenty stack runs from its image; the harness does not install its dependencies
  esac
done

log "done. Products: $selected"
