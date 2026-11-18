#!/usr/bin/env bash
# RAM probe for the P4 stack (ADR 0006, ADR 0007). Brings the given products up through the harness, waits for readiness,
# checks the loopback binds, samples `docker stats` for 30 s of steady state, writes the report, and always runs `down`.
#
#   bash scripts/p4-ram-probe.sh litellm nextcloud outline twenty penpot mattermost librechat openclaw
#
# The report is written on every path, including a failed `up`, a failed readiness wait and a failed bind check. Each of
# those is recorded in the JSON (readiness, bindCheck and overallPass). The exit code is 0 only when readiness passed, the
# binds are loopback-only, and the RAM fits the committed budget (14336 MiB). Output path: P4_RAM_OUT, default
# evidence/ram-probe.json.
#
# Order matters: litellm first (LibreChat and OpenClaw read its run state), and each MCP product before librechat.
set -uo pipefail

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

# 1. Start each product. A failed up stops the list here, and the rest are not started.
up_failed=""
for p in "${products[@]}"; do
  # TWENTY_MCP=1 makes the Twenty adapter mint its scoped MCP key. It has no effect on the other products.
  if ! TWENTY_MCP=1 npm run up -- "$p"; then
    up_failed="$p"
    echo "up failed for ${p}; the remaining products were not started" >&2
    break
  fi
done

# 2. Readiness. Skipped when an up failed. The first product that is not ready is recorded.
ready_status="failed"
ready_failed_product="${up_failed}"
if [ -z "$up_failed" ]; then
  if node scripts/ready.mjs "${products[@]}" 2>&1 | tee evidence/ready.txt; then
    ready_status="ok"
    ready_failed_product=""
  else
    ready_failed_product="$(grep -m1 '^not ready ' evidence/ready.txt | awk '{print $3}' | tr -d ':')"
    [ -z "$ready_failed_product" ] && ready_failed_product="unknown"
  fi
fi
ready_ms=$(( $(date +%s%3N) - start ))

# 3. Bind check. Runs on every path, before cleanup stops the containers. Only loopback host binds are allowed.
bind_status="ok"
offending=""
if ! command -v ss >/dev/null 2>&1; then
  bind_status="failed"
  offending="ss-not-installed"
else
  ss -ltn > evidence/listen.txt 2>/dev/null || true
  # Every host port that this PR or Part A added to a P4 compose file, plus Twenty's app port 3002. Twenty's 3002:3000
  # publish predates P4 and binds on all interfaces. It is exempt by name below, and only there: a separate follow-up
  # will bind it to 127.0.0.1. Twenty's other ports (5434, 8025, 1025) are not added by P4 and are not checked here.
  p4_host_ports="4000 3080 18789 3002 3011 4401 4402 5460 5461 5462 5463 8027 8028 8065 8066 8080 8765 9001"
  twenty_exempt_port=3002
  for port in $p4_host_ports; do
    if [ "$port" = "$twenty_exempt_port" ]; then
      continue
    fi
    if grep -E "[ ]((0\.0\.0\.0|\*|\[::\]):)${port}[ ]" evidence/listen.txt >/dev/null; then
      offending="${offending} ${port}"
    fi
  done
  offending="${offending# }"
  [ -n "$offending" ] && bind_status="failed"
fi
if [ "$bind_status" = "failed" ]; then
  echo "bind check failed: ${offending:-see evidence/listen.txt}" >&2
fi

# 4. Steady state, only after a passing readiness. The samples are kept either way.
if [ "$ready_status" = "ok" ]; then
  sleep 30
fi

kill "$sampler" 2>/dev/null || true
sampler=0
df -BG --output=avail / | tail -1 | tr -dc '0-9' > evidence/.disk

# 5. The report, always. The summary reads the samples and receives the readiness and bind results as arguments.
if ! node scripts/p4-ram-summary.mjs "${products[@]}" \
  --ready-ms "$ready_ms" \
  --readiness "$ready_status" \
  --failed-product "${ready_failed_product}" \
  --bind "$bind_status" \
  --bind-offending "${offending}" > "$out" 2>evidence/summary.err; then
  # The report must exist even when the summary fails. This minimal one keeps the readiness and bind results.
  echo "the summary script failed (see evidence/summary.err); writing a minimal report" >&2
  printf '{"readiness":{"status":"%s","failedProduct":"%s"},"bindCheck":{"status":"%s","offendingPorts":"%s"},"overallPass":false,"note":"minimal report: the summary script failed"}\n' \
    "$ready_status" "${ready_failed_product:-unknown}" "$bind_status" "$offending" > "$out"
fi
cat "$out" 2>/dev/null || true

# 6. Exit code: 0 only when readiness, the bind check and the RAM budget all pass.
if node -e 'const r = require(process.argv[1]); process.exit(r.overallPass === true ? 0 : 1)' "$repo/$out" 2>/dev/null; then
  echo "P4 probe passed: readiness, binds and RAM budget."
  exit 0
fi
echo "P4 probe did not pass (see $out: readiness, bindCheck, fit)." >&2
exit 1
