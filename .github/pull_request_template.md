## Why

<!-- What gap or risk does this close? Link an issue or ADR if one exists. -->

## What changed

<!-- Files, behaviour, defaults. Keep it factual. -->

## Consumer impact

Does this change public exports in `src/index.ts`, env vars in `src/config.ts` / `.env.example`, defaults, timeouts, or adapter behaviour?

- [ ] No consumer impact (docs / CI / governance only)
- [ ] Yes — describe below

Which consumer repin is needed?

- P1 (current pin): `github:Jayami123/qa-portfolio-harness#vX.Y.Z`
- P2 / P5 / P6: later

## Release impact

- [ ] None (no tag; `## Unreleased` in CHANGELOG only)
- [ ] Patch / minor — version bumped in `package.json`, README, and a dated CHANGELOG section

Jayami tags after merge (merge commit, not squash).

## Verification

Paste real command output or CI links (never secrets):

```text
npm ci
npm run typecheck
npm run build
npm run smoke -- cal   # when adapter/config changed
```

## Checklist

- [ ] Conventional PR title (`feat:`, `fix:`, `chore:`, …)
- [ ] CHANGELOG updated when behaviour or exports change
- [ ] README / `.env.example` updated for new env vars
- [ ] No secrets, tokens, or storage state in logs or committed files
- [ ] DB helper stays read-only (no migrations or writes in harness SQL helpers)
- [ ] No product-default changes in `docker/*.compose.yml`
- [ ] Merge with **Create a merge commit** (never squash)
