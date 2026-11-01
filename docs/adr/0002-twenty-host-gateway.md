# 0002. Twenty containers resolve host.docker.internal

- Status: Accepted
- Date: 2026-11-01

## Context

Twenty's server and worker make outbound HTTP calls (workflow actions, webhooks) to hosts on the developer machine, such as a Cal or Documenso webhook receiver bound to the host. Those calls need `host.docker.internal`.

`docker/twenty.compose.yml` gives the `server` and `worker` services no `extra_hosts`. On Docker Desktop, `host.docker.internal` does not resolve inside those containers. On 2026-11-01 the P2 probe (record 1.6) ran `getent hosts host.docker.internal` in the server container and got no resolution. The compose network gateway is `172.18.0.1`, and that address works.

Twenty's own outbound-host allowlist, `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` (`config-variables.ts:106` at `twenty/v2.44.0`), matches hostnames exactly. It needs the name to resolve.

## Decision

Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `server` and `worker` services in `docker/twenty.compose.yml`.

`host-gateway` is a Docker special value. It maps the name to the host's gateway address on the container's network, so the same overlay works on Docker Desktop and on Linux engines.

No other default changes: no port, image, environment key or product file is touched.

## Alternatives considered

- Put the gateway IP literal (`172.18.0.1`) in the allowlist or the URLs. Rejected: the address depends on the compose network and changes when the network is recreated.
- Edit the product compose file (`packages/twenty-docker/docker-compose.yml`). Rejected: the fork is read-only to this harness.

## Consequences

- Requires Docker Engine 20.10 or newer for `host-gateway`. The P2 host runs 29.9.2.
- `getent hosts host.docker.internal` inside the `server` and `worker` containers resolves to the gateway. Acceptance check: plan section 9.2, step 9.
- Adds one overlay key, so `CONTRIBUTING.md` requires this record.
