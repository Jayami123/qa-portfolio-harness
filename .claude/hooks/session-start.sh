#!/bin/bash
# Cloud sessions only: put Node 22 (/usr/local/bin) first on PATH, expose Node 24 for Documenso as $NODE24,
# and start Docker. Exports go through $CLAUDE_ENV_FILE so they persist. The hook never blocks the session.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  # shellcheck disable=SC2016  # the PATH must expand when the env file is sourced
  echo 'export PATH="/usr/local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
  if [ -x /opt/node24/bin/node ]; then
    echo 'export NODE24=/opt/node24/bin/node' >> "$CLAUDE_ENV_FILE"
  fi
fi

if command -v dockerd >/dev/null && ! docker info >/dev/null 2>&1; then
  ($SUDO dockerd > /tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
if ! docker info >/dev/null 2>&1; then
  echo "WARNING: Docker is not available (dockerd missing or failed to start; see /tmp/dockerd.log). Product stacks will not start." >&2
fi

# Missing pieces are reported by name only, never by value.
if [ ! -x /opt/node24/bin/node ]; then
  echo "WARNING: Node 24 missing at /opt/node24; Documenso needs it. Run the Claude setup script (README, Cloud environments)." >&2
fi
if [ ! -f "$REPO_ROOT/node_modules/.package-lock.json" ]; then
  echo "WARNING: harness dependencies are not installed; run: bash scripts/cloud-install.sh" >&2
fi
exit 0
