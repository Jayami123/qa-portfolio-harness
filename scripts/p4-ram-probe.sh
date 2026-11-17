#!/usr/bin/env bash
# RAM probe for the P4 stack (ADR 0006). Brings the given products up through the harness, waits for readiness, samples
# `docker stats` for 30 s of steady state, writes evidence/ram-probe.json, and always runs `down` for every product.
#
#   bash scripts/p4-ram-probe.sh nextcloud outline penpot mattermost twenty
#
# Exits 1 when the probe does not fit the committed budget (14 GiB), or when a product fails to become ready.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <product>..." >&2
  exit 2
fi
products=("$@")
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
mkdir -p evidence
: > evidence/ram-samples.tsv
: > evidence/ram-host.tsv
sampler=0

cleanup() {
  if [ "$sampler" -ne 0 ]; then kill "$sampler" 2>/dev/null || true; fi
  for p in "${products[@]}"; do
    npm run down -- "$p" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Sampler: one docker stats snapshot and one host memory reading every 2 s. Only qa-harness-* containers are kept
# later, in p4-ram-summary.mjs.
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
for p in "${products[@]}"; do
  # TWENTY_MCP=1 makes the Twenty adapter mint its scoped MCP key. It has no effect on the other products.
  TWENTY_MCP=1 npm run up -- "$p"
done
node scripts/ready.mjs "${products[@]}"
ready_ms=$(( $(date +%s%3N) - start ))

sleep 30  # steady state, still sampled

kill "$sampler" 2>/dev/null || true
sampler=0
df -BG --output=avail / | tail -1 | tr -dc '0-9' > evidence/.disk

node scripts/p4-ram-summary.mjs "${products[@]}" --ready-ms "$ready_ms" > evidence/ram-probe.json
cat evidence/ram-probe.json

node -e 'const r = require(process.argv[1]); process.exit(r.fit === true ? 0 : 1)' "$repo/evidence/ram-probe.json" || {
  echo "RAM probe did not fit the budget (see evidence/ram-probe.json)" >&2
  exit 1
}
echo "RAM probe fits the budget."
