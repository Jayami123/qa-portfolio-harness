# Agent notes

Rules for AI agents working in this repository (Cursor cloud, Claude Code cloud, or local). Cloud setup: see the
"Cloud environments" section of [README.md](README.md).

## Rules

- Run `npm run check` before every push.
- Never edit the product forks under `PRODUCTS_ROOT`, and never write a product `.env` file. The harness generates its own values.
- Start and stop products only through the harness scripts: `npm run up -- <product>` and `npm run down -- <product>`.
  Always finish a run with `down`, and confirm no `qa-harness-*` container is left.
- Never put secrets, passwords or API keys in a file, a log or a commit. Print variable names, never values.
- Use "the maintainer" or "the owner", never a personal name, in files and commit messages.
- Conventional Commits with lowercase subjects, small logical commits, `git add` by explicit path (never `-A`), no force-push.
- Do not add `Co-Authored-By`, "Generated with", `Claude-Session` or session-link lines to commits or PRs.
- Dated branches: `fix/2026-11-DD-<topic>`, `feat/...`, `chore/...`, `plan/...`. A plan branch never gets a PR.

## Cursor cloud

- `.cursor/environment.json` runs `bash scripts/cloud-install.sh` at install and starts Docker at start.
- Cursor's own Node is on `PATH`. Before a harness command, run `export PATH="/usr/local/bin:$PATH"`.
- Documenso needs Node 24: use `$NODE24` (set by the image).

## Claude Code cloud

- `.claude/hooks/session-start.sh` (cloud sessions only) puts `/usr/local/bin` first on `PATH`, exports `NODE24`, starts Docker,
  and prints `WARNING:` lines on stderr for a missing Node 24 or missing harness dependencies.
- The setup script and the environment settings are pasted by hand; the README lists them.
