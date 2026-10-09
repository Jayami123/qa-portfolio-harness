# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest release tag (currently `v0.2.2` after release) | Yes |
| `main` | Yes |
| Older tags | Best effort only |

## Reporting a vulnerability

**Do not open a public GitHub issue** for security problems.

Use [GitHub private vulnerability reporting](https://github.com/Jayami123/qa-portfolio-harness/security/advisories/new) (Security → Report a vulnerability).

Include enough detail to reproduce the issue. **Never** paste live tokens, API keys, database URLs with passwords, or Playwright `storageState` JSON into a public channel.

## Scope

In scope for this repository:

- The `qa-portfolio-harness` npm package (adapters, config loading, token minting helpers, read-only Postgres helper, compose overlays under `docker/`, and redaction in `scripts/`).
- CI workflows and Dependabot configuration in `.github/`.

Out of scope:

- Vulnerabilities in **Cal.com**, **Documenso**, **Medusa**, or **Twenty** themselves. Report those to each upstream project using their own `SECURITY.md`.

## Response

This is a solo-maintainer portfolio project. Reports are handled on a best-effort basis; there is no guaranteed SLA.
