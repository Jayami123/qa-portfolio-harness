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
  # Own session (setsid -f) and no inherited stdio, so the hook's process-group teardown does not stop dockerd.
  $SUDO setsid -f dockerd >/tmp/dockerd.log 2>&1 </dev/null
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
if ! docker info >/dev/null 2>&1; then
  echo "WARNING: Docker is not available (dockerd missing or failed to start; see /tmp/dockerd.log). Product stacks will not start." >&2
fi

# Docker Hub login, only when both variables are set. The token goes to docker on stdin and is never printed.
# Docker Hub account names are lowercase. An uppercase letter makes docker send a malformed Authorization header,
# so the hook prints an error that names the variable, not its value, and skips the login.
if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  if [ "$DOCKERHUB_USERNAME" != "$(printf '%s' "$DOCKERHUB_USERNAME" | tr 'A-Z' 'a-z')" ]; then
    echo "harness: ERROR DOCKERHUB_USERNAME has an uppercase letter; set the lowercase Docker Hub name (Docker Hub names are lowercase). Docker login skipped." >&2
  elif printf '%s' "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin >/dev/null 2>&1; then
    echo "harness: docker login ok"
  else
    echo "harness: ERROR docker login to Docker Hub failed (check DOCKERHUB_USERNAME and DOCKERHUB_TOKEN)" >&2
  fi
fi

# Missing pieces are reported by name only, never by value.
if [ ! -x /opt/node24/bin/node ]; then
  echo "WARNING: Node 24 missing at /opt/node24; Documenso needs it. Run the Claude setup script (README, Cloud environments)." >&2
fi
if [ ! -f "$REPO_ROOT/node_modules/.package-lock.json" ]; then
  echo "WARNING: harness dependencies are not installed; run: bash scripts/cloud-install.sh" >&2
fi
exit 0
