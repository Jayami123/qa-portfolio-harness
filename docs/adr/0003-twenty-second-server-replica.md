# 0003. Opt-in second Twenty server replica

- Status: Accepted
- Date: 2026-11-03

## Context

`up twenty` runs one server replica. The P2 Twenty cache cases (P2-TW-CACHE-001) need two replicas that share one database and one Redis. The compose file `docker/twenty.compose.yml` is an upstream-shaped overlay, so changing its defaults needs an ADR (CONTRIBUTING.md:40).

## Decision

Add `TWENTY_SERVER_REPLICAS`. Unset, blank or `1` keeps one replica. Exactly `2` adds `docker/twenty.replicas.compose.yml`, which starts `server-2` on `127.0.0.1:3003` with `DISABLE_DB_MIGRATIONS=true` and `DISABLE_CRON_JOBS_REGISTRATION=true`. Any other value stops `up()` before anything starts. `down()` passes `--remove-orphans`, so `server-2` is removed even when the variable is unset at `down` time.

## Consequences

- A consumer that sets nothing gets the same compose argv as before.
- `server-2` copies the server's environment by hand, so a change to the server's environment in the fork must be repeated in the overlay.
- The rate-limit knobs written to `.harness/twenty.runtime.compose.yml` apply to `server` and `worker` only, not to `server-2`.
- Cost: measured in the live run (see the PR body), not estimated here.
