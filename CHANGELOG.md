# Changelog

## v0.2.4 — 2026-10-11

- Optional `DOCUMENSO_PUBLIC_URL` (for example `http://p1.lvh.me:3001`) sets `NEXT_PUBLIC_WEBAPP_URL` so WebAuthn can use a hostname RP ID. `NEXT_PRIVATE_INTERNAL_WEBAPP_URL`, listen, and health stay on `DOCUMENSO_BASE_URL` (`http://127.0.0.1:3001`). Unset keeps v0.2.3 behaviour.
- `DOCUMENSO_PUBLIC_URL` must be http(s), its port must match the listen port, and its hostname must not be localhost or an IP. Before `up()`, the hostname must resolve to `127.0.0.1` (hosts file); there is no localhost fallback.
- When the public URL is set, a process that already answers on `127.0.0.1:3001` with a different `NEXT_PUBLIC_WEBAPP_URL` is reported as stale. The harness never kills it.

## v0.2.3 — 2026-10-11

- Documenso `up()` starts the harness-owned Postgres (127.0.0.1:5451) and Inbucket (SMTP 127.0.0.1:2525), then migrates, seeds, builds, and starts the stock Remix app on 127.0.0.1:3001. It no longer depends on the fork's `docker/development/compose.yml`.
- Documenso `up()` requires Node 24 or newer and stops before any side effect on older Node.
- Documenso health requires HTTP 200 on `/signin` and `/api/auth/csrf` on 127.0.0.1. A localhost-only answer is reported as an `ENVIRONMENT finding`, never a pass.
- A port that is in use by an unhealthy process is reported with its PID and executable (Windows). The harness never stops it.
- Default `DOCUMENSO_BASE_URL` is `http://127.0.0.1:3001` and `DOCUMENSO_DB_URL` uses port 5451. `localhost` is rejected.
- Add `npm test` (node:test, no new dependency) and `npm run check`. CI runs `npm test`. The packed tarball includes `docker/documenso.compose.yml`.
- `composeUp` accepts `{ wait: true }` (`docker compose up -d --wait`). `pollHealth` accepts `isOk` and `alternateLoopback`. Defaults are unchanged for Cal.

## v0.2.2 — 2026-10-09

- Add MIT `LICENSE`, `SECURITY.md`, `.github/CODEOWNERS`, pull request template, and `CONTRIBUTING.md`.
- Add CI workflow: actionlint, `npm ci` / `prepare`, typecheck, build, `npm pack --dry-run` contents checks, import smoke, and `npm audit --audit-level=high`.
- Add PR title validation, CodeQL (TypeScript and GitHub Actions), and Dependabot for npm and GitHub Actions.
- Add `.nvmrc` (Node 22) and `.editorconfig`.
- Security: bump `@faker-js/faker` to 10.6.0 (GHSA-qxc2-j82w-r537). Harness factory helpers already used v10-compatible APIs (`faker.person.*`, `faker.internet.email`); no source changes required.

## v0.2.1 — 2026-10-08

- Generate Cal tRPC types with `yarn turbo run build --filter=@calcom/trpc` before `next build`, then require `packages/trpc/types/server/routers/_app.d.ts`.
- Skip Cal `next build` only when `apps/web/.next/required-server-files.json` exists and `harness-build.json` `gitSha` matches product `HEAD`. Uncommitted Cal working-tree edits are not detected; use `CAL_WEB_REBUILD=1` after local Cal edits.
- `CAL_TRPC_BUILD_MS` overrides the tRPC turbo timeout (default 600000, min 120000).
- Add `npm run typecheck` (`tsc --noEmit`).

## v0.2.0 — 2026-10-08

- Default Cal `up()` to `next build` then `next start`.
- Skip `next build` when a production `.next` marker exists unless `CAL_WEB_REBUILD=1`.
