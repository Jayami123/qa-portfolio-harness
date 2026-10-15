# Contributing

Thank you for helping improve the QA portfolio harness. This package is consumed by P1, P2, P5, and P6 via pinned Git tags.

## Branch and commits

1. Branch from up-to-date `main`: `<type>/YYYY-MM-DD-short-name` (for example `feat/2026-10-09-cal-auth-tweak`).
2. Use [Conventional Commits](https://www.conventionalcommits.org/) in commit messages. PR titles are checked the same way (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`, `refactor:`).
3. One small commit per concern when possible.

## Merge and releases

- Merge with **Create a merge commit**. Do **not** squash: release tags must sit on commits that remain in `main` history.
- Releases: bump `version` in `package.json`, add a dated section in `CHANGELOG.md`, update README if needed, then Jayami tags `vX.Y.Z` on `main`.

## Before you push

From the repo root:

```bash
npm run check
```

`npm run check` is typecheck, the unit tests (`npm test`, node:test over `src/**/*.test.ts`), and build.

When you change adapters or config loading, also run live smoke against a local product fork:

```bash
npm run smoke -- cal
```

For Documenso, run `node scripts/up.mjs documenso` under Node 24 (see README). Full `smoke -- documenso` also needs `DOCUMENSO_API_TOKEN`.

Paste the summary lines in your PR.

## Safety rules

- The Postgres helper is **read-only** intent: no migrations, no destructive SQL in shared helpers.
- Never commit `.env`, storage state, or tokens. Use `.env.example` placeholders only.
- Do not change upstream product defaults in `docker/*.compose.yml` overlays without an ADR-level reason.
- Compose layout: Cal and Twenty files are targeted overrides passed after their upstream Compose files. Documenso's and Medusa's Compose files are standalone and are not layered with a product Compose file (the Medusa DTC starter has none).

## CI

Pull requests run workflow linting, `npm ci` (including `prepare` → `tsc`), typecheck, build, package contents checks, optional import smoke, `npm audit --audit-level=high`, PR title validation, and CodeQL.
