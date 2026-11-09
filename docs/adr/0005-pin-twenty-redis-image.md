# 0005. Pin the Twenty Redis image by version and digest

- Status: Accepted
- Date: 2026-11-10

## Context

The Twenty stack runs Redis as the rate-limit backing store. The fork's `packages/twenty-docker/docker-compose.yml:128-133` defines `redis` with `image: redis`, the unpinned tag. The overlay `docker/twenty.compose.yml` did not set a Redis image, so every `up twenty` used whatever `redis` pointed to at pull time.

The facts that bear on the pin (PLAN 1.3(a)):

- Redis has no named volume. The only named volumes are `db-data` and `server-local-data`. The Redis data lives in the container's writable layer, so `down` without `-v` removes the Redis counters.
- The `redis` image declares no `VOLUME`. For the digest `redis@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53`, `docker image inspect` reports `Config.Volumes = null`, so there is no anonymous volume either.
- The unpinned tag may resolve to a different digest on a later pull. Counter behaviour and the RDB snapshot behaviour would then change without a repository change.

`CONTRIBUTING.md:40` requires an ADR-level reason before an upstream-default change to a `docker/*.compose.yml` overlay.

## Decision

The overlay sets the Redis image to:

`redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53`

The fork's compose file is not edited. The overlay's `redis` service merges over the fork's `redis` service, so only the image changes.

## Consequences

- Counter and snapshot behaviour is reproducible for this digest. A Redis update is a deliberate, ADR-backed change, not a side effect of a fresh pull.
- The digest is the one the probe already pulled, so no image changes on the date this ADR is accepted.
- The pin does not change the reset contract. `down` without `-v` still removes the Redis container and its counters (PLAN 1.3(a)).
