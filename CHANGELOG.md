# Changelog

## v0.2.1 — 2026-10-08

- Generate Cal tRPC types with `yarn turbo run build --filter=@calcom/trpc` before `next build`, then require `packages/trpc/types/server/routers/_app.d.ts`.
- Skip Cal `next build` only when `apps/web/.next/required-server-files.json` exists and `harness-build.json` `gitSha` matches product `HEAD`. `CAL_WEB_REBUILD=1` still forces a rebuild.

## v0.2.0 — 2026-10-08

- Default Cal `up()` to `next build` then `next start`.
- Skip `next build` when a production `.next` marker exists unless `CAL_WEB_REBUILD=1`.
