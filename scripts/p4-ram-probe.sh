#!/usr/bin/env bash
# RAM probe for the P4 stack (ADR 0006, ADR 0007). Brings the given products up through the harness, waits for readiness,
# checks the loopback binds, samples `docker stats` for 30 s of steady state, writes the report, and always runs `down`.
#
#   bash scripts/p4-ram-probe.sh litellm nextcloud outline twenty penpot mattermost librechat openclaw
#
# Order matters: litellm first (LibreChat and OpenClaw read its run state), and each MCP product before librechat (LibreChat
# reads each Part A run state). Output path: P4_RAM_OUT, default evidence/ram-probe.json. Exits 1 when the probe does not fit
# the committed budget (14336 MiB), when a product is not ready, or when a bind is beyond loopback.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <product>..." >&2
  exit 2
fi
products=("$@")
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

# Stub mode only in CI (ADR 0007, review answer 0.9). A Gemma call is never made by this script.
export P4_LLM_MODE="${P4_LLM_MODE:-stub}"
if [ "${CI:-}" = "true" ] && [ "$P4_LLM_MODE" != "stub" ]; then
  echo "P4_LLM_MODE must be stub in CI. Refusing to run." >&2
  exit 2
fi

needs_litellm=0
for p in "${products[@]}"; do
  case "$p" in librechat|openclaw) needs_litellm=1 ;; esac
done
if [ "$needs_litellm" -eq 1 ] && [ "${products[0]}" != "litellm" ]; then
  echo "litellm must be the first product when librechat or openclaw is started (they read its run state)." >&2
  exit 2
fi

mkdir -p evidence
out="${P4_RAM_OUT:-evidence/ram-probe.json}"
: > evidence/ram-samples.tsv
: > evidence/ram-host.tsv
sampler=0

cleanup() {
  if [ "$sampler" -ne 0 ]; then kill "$sampler" 2>/dev/null || true; fi
  # Reverse order: agent hosts and their clients stop before the services they use.
  for ((i=${#products[@]}-1; i>=0; i--)); do
    npm run down -- "${products[$i]}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Sampler: one docker stats snapshot and one host memory reading every 2 s. Only qa-harness-* containers are kept later.
(
  while true; do
    t=$(date +%s)
    docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' 2>/dev/null | awk -v t="$t" -F'\t' '{print t"\t"$1"\t"$2}' >> evidence/ram-samples.tsv || true
    free -m | awk -v t="$t" '/^Mem:/{print "host\t"$3}' >> evidence/ram-host.tsv || true
    sleep 2
  done
) &
sampler=$!

start=$(date +%s%3N)
df -BG --output=avail / | tail -1 | tr -dc '0-9' > evidence/.disk_before
for p in "${products[@]}"; do
  # TWENTY_MCP=1 makes the Twenty adapter mint its scoped MCP key. It has no effect on the other products.
  TWENTY_MCP=1 npm run up -- "$p"
done
node scripts/ready.mjs "${products[@]}"
ready_ms=$(( $(date +%s%3N) - start ))

# Bind check inside the probe, before cleanup stops everything. Only loopback host binds are allowed (review answer 0.1).
ss -ltn > evidence/listen.txt
for port in 4000 3080 18789 3002 3011 4401 8065 8066 8765 9001; do
  if grep -E "[ ]((0\.0\.0\.0|\*|\[::\]):)${port}[ ]" evidence/listen.txt; then
    echo "port ${port} is bound beyond loopback" >&2
    exit 1
  fi
done

sleep 30  # steady state, still sampled

kill "$sampler" 2>/dev/null || true
sampler=0
df -BG --output=avail / | tail -1 | tr -dc '0-9' > evidence/.disk

node scripts/p4-ram-summary.mjs "${products[@]}" --ready-ms "$ready_ms" > "$out"
cat "$out"

node -e 'const r = require(process.argv[1]); process.exit(r.fit === true ? 0 : 1)' "$repo/$out" || {
  echo "RAM probe did not fit the budget (see $out)" >&2
  exit 1
}
echo "RAM probe fits the budget."
