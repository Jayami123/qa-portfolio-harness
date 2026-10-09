# Changelog

## Unreleased

- Add MIT `LICENSE`, `SECURITY.md`, `.github/CODEOWNERS`, pull request template, and `CONTRIBUTING.md`.
- Add CI workflow: actionlint, `npm ci` / `prepare`, typecheck, build, `npm pack --dry-run` contents checks, import smoke, and `npm audit --audit-level=high`.
- Add PR title validation, CodeQL (TypeScript and GitHub Actions), and Dependabot for npm and GitHub Actions.
- Add `.nvmrc` (Node 22) and `.editorconfig`.
- No runtime or API changes; no release.

## v0.2.1 — 2026-10-08

- Generate Cal tRPC types with `yarn turbo run build --filter=@calcom/trpc` before `next build`, then require `packages/trpc/types/server/routers/_app.d.ts`.
- Skip Cal `next build` only when `apps/web/.next/required-server-files.json` exists and `harness-build.json` `gitSha` matches product `HEAD`. Uncommitted Cal working-tree edits are not detected; use `CAL_WEB_REBUILD=1` after local Cal edits.
- `CAL_TRPC_BUILD_MS` overrides the tRPC turbo timeout (default 600000, min 120000).
- Add `npm run typecheck` (`tsc --noEmit`).

## v0.2.0 — 2026-10-08

- Default Cal `up()` to `next build` then `next start`.
- Skip `next build` when a production `.next` marker exists unless `CAL_WEB_REBUILD=1`.
