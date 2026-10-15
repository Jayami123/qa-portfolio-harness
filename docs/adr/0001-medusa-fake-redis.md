# 0001. Medusa stays on fake Redis

- Status: Accepted
- Date: 2026-10-15

## Context

Webhook and subscriber tests want a real Redis event bus. The DTC starter does not wire one.

`apps/backend/medusa-config.ts` sets `projectConfig.databaseUrl` and `projectConfig.http` only. It does not set `projectConfig.redisUrl`.

`@medusajs/framework` 2.21.2 `dist/config/config.js` logs `redisUrl not found. A fake redis instance will be used.` when that field is missing. It does not read `REDIS_URL`.

On 2026-10-15, `medusa start` was run with `REDIS_URL=redis://127.0.0.1:6380` in the gitignored `apps/backend/.env` and no Redis container. The log still said `redisUrl not found` and `Local Event Bus installed. This is not recommended for production.` Locking used the in-memory default. `GET http://127.0.0.1:9000/health` returned HTTP 200.

## Decision

- `docker/medusa.compose.yml` starts Postgres 15 only. It does not start `redis:7`.
- The harness backend env writer drops `REDIS_URL` unless a later change proves Medusa reads it without editing tracked product files.
- Do not edit `medusa-config.ts` in `medusa-dtc-starter` to pass `redisUrl`.

## Alternatives considered

- Start `redis:7` on `127.0.0.1:6380` anyway. Rejected: the process never opens that port, so the container would sit idle.
- Edit `medusa-config.ts` to pass `process.env.REDIS_URL`. Rejected: the product fork stays read-only for this adapter.

## Consequences

- Medusa `up()` is smaller and does not depend on Redis being healthy.
- Subscribers and the event bus stay in-process. A test that needs a real bus cannot see one until the product config sets `redisUrl` or a harness overlay can add it without a tracked-file edit.
- Revisit this when task 4 looks at config overlays, or when a fork change sets `projectConfig.redisUrl`.
