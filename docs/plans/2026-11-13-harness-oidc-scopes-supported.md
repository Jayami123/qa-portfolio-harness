# Harness fix: the Documenso mock IdP publishes scopes_supported

Append-only. Each decision is a block with five fields: context, options considered, choice, reason, evidence.

Branch: `fix/2026-11-13-harness-oidc-scopes-supported` (draft PR, not ready, not merged).
Base: `origin/main` at `9cddd68` (v0.5.0). Confirmed an ancestor of the fetched `origin/main` (`git merge-base --is-ancestor`).
Working checkout at the start was `claude/clever-cerf-bct4dh` (also at `9cddd68`). The fix branch was created from `origin/main`; the checkout branch was not changed.

## D-HAR-F1: scope of the fix and the stop rule

- Context: P5 run 43400737495 (external, not in this repository) reports that Documenso treats a discovery document without `scopes_supported` as "no scopes", so login returns 500 before any Documenso check runs. The pinned mock IdP (`navikt/mock-oauth2-server:2.1.11`, D-HAR-B2 in `2026-11-13-harness-v0.5.0-pr-d.md`) is the provider whose discovery document lacks the field.
- Options considered: (a) make the pinned image publish `scopes_supported` through its own documented configuration (`JSON_CONFIG`, or a documented image option), keeping the same image digest; (b) bump to a different image tag or digest that already publishes it; (c) a harness-owned discovery server or custom IdP in the repository.
- Choice: (a) first. If the pinned image cannot do it, record the evidence and stop. Option (b) needs a new pin and is a separate owner decision. Option (c) is out of scope without owner approval.
- Reason: the brief says the image's own configuration is the fix and that a custom server needs owner approval. A changed digest would also change every existing OIDC claim in D-HAR-B3 and B4, so it is not a silent change.
- Required scope: at least `openid`, `email`, `profile` in `scopes_supported`. Live probe through the harness (`npm run up -- documenso` with `DOCUMENSO_OIDC=1`, `npm run down -- documenso` in a trap). No fork edits, no secrets printed, no product `.env` written.
- Evidence: this record is written before any probe, from the repository files and the brief only.

## Facts (repository, before the probe)

- `docker/documenso.oidc.compose.yml` sets `JSON_CONFIG` inline. Its `tokenCallbacks` and `interactiveLogin` keys are the only ones set. Nothing sets a scopes key.
- `src/adapters/documenso-oidc.ts` holds `DOCUMENSO_OIDC_IDP_CONFIG`. The compose JSON must equal it (a unit test checks this in `src/adapters/documenso-oidc.test.ts`).
- The well-known URL is `http://127.0.0.1:8081/default/.well-known/openid-configuration` (`DOCUMENSO_OIDC_WELL_KNOWN_URL`).
- Node: `NODE24=/opt/node24/bin/node` (v24). The harness `npm run check` runs on the default Node 22 (`node -v` v22.23.3), so use `export PATH="/usr/local/bin:$PATH"` as CLAUDE.md says for harness commands.
- Docker reachable (`docker info` ok). No `qa-harness-*` container running at the start.

## D-HAR-F2: the pinned image cannot publish scopes_supported (evidence)

- Context: D-HAR-F1 option (a). The question was whether `navikt/mock-oauth2-server:2.1.11` (pinned digest `d1ab5857…`) can publish `scopes_supported` through its own configuration.
- Options considered: (a) a `JSON_CONFIG` key or another documented image option; (b) a newer tag (2.2.0); (c) a custom server (out of scope without owner approval).
- Choice: no change to the pin, the compose file, or the adapter. Stop per the brief.
- Reason, from the image's own classes (extracted from the image layers, not run):
  - The discovery document is built by `no/nav/security/mock/oauth2/http/WellKnown` (class strings). Its constructor takes `issuer`, the endpoint URLs, and five fixed lists: `response_types_supported`, `response_modes_supported`, `subject_types_supported`, `id_token_signing_alg_values_supported`, `code_challenge_methods_supported`. There is no scopes field.
  - `OAuth2Config` (the `JSON_CONFIG` model) has `tokenCallbacks`, `httpServer`, `interactiveLogin`, `loginPagePath`, `staticAssetsPath`, `rotateRefreshToken` and `tokenProvider`. No key feeds a scopes list, so an added config key would have nothing to set.
  - The string `scopes_supported` and the identifiers `ScopesSupported`/`scopesSupported` appear in no class of 2.1.11. The only scope identifier is `scopesWithoutOidcScopes` (in `NimbusExtensionsKt` and `DefaultOAuth2TokenCallback`), a token-scope filter, not discovery.
  - Tag 2.2.0 (digest `sha256:5cea519b…`, resolved with `docker buildx imagetools inspect`): its `WellKnown.class` also has no `scopes_supported` and no scopes identifier.
- Evidence: see the Live section.

## D-HAR-F3: stop and hand the decision to the owner

- Context: the brief says that if the pinned image cannot do it, record evidence and stop, and that a custom server needs owner approval.
- Options considered for the owner (not chosen here): (1) a different IdP image that publishes `scopes_supported` (new pin, new digest, re-probe of B3/B4 claims, a new decision record); (2) a harness-owned discovery document or custom server (the brief requires owner approval); (3) a Documenso-side change to accept a missing `scopes_supported` (a fork edit, which the brief forbids).
- Choice: stop. No code, no CHANGELOG entry (no behaviour change), no PR, no merge, no tag.
- Reason: none of the three options is in the brief's scope. Option (1) changes a pinned digest the existing B3 and B4 probes depend on, so it needs its own decision and probes.
- Evidence: D-HAR-F2 and the Live section.

## Live section

- Harness build: `dist/` was stale (it predated the OIDC code, so `up` silently ignored `DOCUMENSO_OIDC=1`). Ran `npm run build` (tsc, exit 0). This is local generated output, not committed (`dist` is in `.gitignore`).
- Probe (`DOCUMENSO_OIDC=1 npm run up -- documenso`, then `curl` on the well-known URL, then `npm run down -- documenso` in an EXIT trap): `up` exit 0; the `qa-harness-documenso-oidc` container was created and started; the well-known endpoint answered `WK_HTTP=200`; `down` exit 0; `qa-harness-*` containers after `down`: none.
- Discovery keys (names only): `issuer, authorization_endpoint, end_session_endpoint, revocation_endpoint, token_endpoint, userinfo_endpoint, jwks_uri, introspection_endpoint, response_types_supported, response_modes_supported, subject_types_supported, id_token_signing_alg_values_supported, code_challenge_methods_supported`. `scopes_supported` is absent (`null`). `issuer` is `http://127.0.0.1:8081/default`.
- Image inspection: `docker save` of the pinned digest, then the classes layer extracted and searched (read-only; no container started). Tag 2.2.0 pulled by digest and inspected the same way, then removed (`docker image rm`).
- Not run: no Documenso login was attempted, since the blocker is upstream of login. No unit test was added, because no config change was made. `npm run check` runs before the record commit, as CLAUDE.md requires.
- Outcome: the fix is blocked on an owner decision (D-HAR-F3). The P5 failure (run 43400737495) is external and was not re-run.

## D-HAR-F4: owner decision: replace the mock with a standards-complete OIDC provider

- Context: the owner chose option 1 of D-HAR-F3. The pinned mock cannot publish `scopes_supported` (D-HAR-F2). The new provider must publish it and must support the controls in the brief.
- Options considered: Dex and Keycloak (the owner's list). Both are official images.
- Choice: evaluate both live, then choose the lighter one that meets every requirement (see D-HAR-F5 and F6).
- Reason: the owner asked for this comparison and for the lighter one to win.
- Evidence: F5 and F6 below.

## D-HAR-F5: candidate tags and digests (resolved from the registries)

- Dex: `ghcr.io/dexidp/dex:v2.45.0@sha256:b8469881d3cb3a73001506f0d3aaefecb9c45d2311c1e0f405d8ac538316c59d` (newest tag that resolved; `v2.44.0`, `v2.43.0` and `v2.41.1` also resolve).
- Keycloak: `quay.io/keycloak/keycloak:26.5.0@sha256:5fdd7cda82e58775ed124294c7e16fabc33166d38dfc4aabebda7d64e7a964bf` (newest tag that resolved; `26.4.7` and `26.4.0` also resolve).
- The GitHub API for `dexidp/dex` is not enabled in this session, so release notes were not read. Tag resolution and live probes are the evidence.

## D-HAR-F6: live comparison, Dex v2.45.0 and Keycloak 26.5.0

Probes ran as standalone containers named `qa-probe-dex` and `qa-probe-kc` on `127.0.0.1:18081`, removed afterwards, with the flow driven by a scratch script (PKCE S256, `state`, `nonce`, the login form, the token endpoint). Values are not recorded; claim names and booleans only.

| Requirement | Dex v2.45.0 | Keycloak 26.5.0 |
|---|---|---|
| Discovery 200, `scopes_supported` present | yes: `openid`, `email`, `groups`, `profile`, `offline_access` | yes: includes `openid`, `email`, `profile` (plus others) |
| Static confidential client, exact redirect URI | yes (static client, secret, redirect list) | yes; unregistered `redirect_uri` at authorize: 400 |
| Per-user `email_verified` `true` | yes | yes |
| Per-user `email_verified` `false` | **no**: both users returned `email_verified: true` | **yes**: the seeded user with `emailVerified: false` returned `false` |
| `state` echoed, `nonce` in id_token | yes, yes | yes, yes |
| Code single-use | yes (second use 400) | yes (second use 400) |
| Wrong client secret | 401 | 401 |
| Wrong PKCE verifier | 400 | 400 |
| Wrong redirect at token | 400 | 400 |
| Idle memory (`docker stats`) | about 8.5 MiB | about 656 MiB |
| Image size (`docker image ls`) | 211 MB | 730 MB |
| Client secret and user passwords set per run without a file | not tested: a static client secret needs a config value; Dex's `${VAR}` placeholder was not expanded (a literal secret was needed) | yes: set through the admin REST API after start (client `PUT` with `secret`, `reset-password` for each user); the realm file holds no secret |

- Dex: the static-password users cannot be `email_verified: false`. The owner's requirement needs both values, so Dex does not meet it, however light it is.
- Keycloak: meets every requirement. It is heavier (about 80 times the idle memory and about 3.5 times the image size of Dex).
- Choice: Keycloak 26.5.0. The "lighter one that supports" the full list is Keycloak, because Dex does not support the `false` case.

## D-HAR-F7: how the Keycloak test provider is configured

- Context: Keycloak's realm import does not substitute `${env.VAR}` in the client secret or the user passwords (the placeholder was stored literally, and a login with the literal placeholder as the password succeeded). A per-run secret therefore cannot go into the realm file.
- Options considered: (a) a realm file with a fixed or per-run secret and password written to disk (violates CLAUDE.md and B7); (b) set the client secret, the redirect URIs and the two user passwords through the admin REST API after the realm imports; (c) keep the mock.
- Choice: (b). The realm file (`docker/documenso-oidc/qa-realm.json`) holds no secret and no password. The adapter generates the admin password, the client secret and the two user passwords per run, passes the admin password to the container through compose interpolation, and sets the rest over the admin API. Values are held in memory only and never logged or written.
- Reason: the brief forbids secrets in files, and option (b) keeps the public interface (`DOCUMENSO_OIDC=1`, port 8081) unchanged.
- Evidence: the probe in D-HAR-F6 (admin API `PUT` 204, `reset-password` 204 twice, then the login and token checks passed with the per-run values).
- Residual (for the P5 PR): the two test-user passwords exist only in the `up` process memory. A P5 test in another process cannot log in until a channel for them is decided. Recorded here for the owner; this PR does not choose it.
- Residual (dev mode): `start-dev` serves HTTP on loopback with the dev-mode defaults. It is a test provider, not a production configuration.

## Stale dist/ (build log only)

- Observation: `dist/` predated the OIDC code, so `npm run up -- documenso` ignored `DOCUMENSO_OIDC=1` with no error (`scripts/lib.mjs` loads `dist/index.js`). The fix was `npm run build`. This is recorded here only, not in the README or CHANGELOG, as the owner asked.

## D-HAR-F8: the B3/B4 probes re-run on the new provider

- Context: the owner asked for the B3 and B4 probes to be re-run on the replacement image. B3 (discovery, authorize with PKCE, token exchange, client-secret, redirect and PKCE checks, code reuse) and B4 (per-user `email_verified` through login).
- Choice: run the probes through the harness. A driver process called `getAdapter("documenso").up()` with `DOCUMENSO_OIDC=1`, read the per-run client secret and user passwords through the in-process accessor `oidcTestAccess()` (never printed), ran the flow with them passed as child-process environment variables (never written), and called `down()` in a `finally`.
- Results (booleans and claim names only):
  - Discovery 200, issuer `http://127.0.0.1:8081/realms/qa`, `scopes_supported` present and includes `openid`, `email`, `profile`.
  - Verified user: code issued, `state` echoed, redirect is the Documenso callback, token 200, `email_verified` true, `nonce` matches, `aud` is `qa-documenso`, access token and refresh token present. Second use of the same code 400. Wrong secret 401. Wrong PKCE verifier 400. Wrong redirect at token 400.
  - Unverified user: the same results, with `email_verified` false.
  - Unregistered redirect at authorize: 400.
  - Earlier standalone runs of the same checks (D-HAR-F6) matched.
- Deviation: the candidate comparison (D-HAR-F6) ran as standalone containers, because the harness had no adapter for Dex or Keycloak until this change. This record is the only place those candidate probes are recorded.
- Harness up and down, real path (`DOCUMENSO_OIDC=1 npm run up -- documenso`, then `npm run down -- documenso`): `up` exit 0; the provider and the Documenso web both answered 200; `down` exit 0; no `qa-harness-*` container left; nothing listening on 127.0.0.1:3001.
- Observation (harness down, not changed here): the driver's `down()` failed with `DocumensoWebStopError` ("still listening on 127.0.0.1:3001"). The pid record held `10785`, which was already dead (the wrapper), while the listener was a child process `node build/server/main.js` from `/home/user/products/documenso/apps/remix`. The listener was stopped by hand (SIGTERM to that process chain), then `npm run down -- documenso` exited 0. The shell path (`npm run up` / `npm run down`) did not hit this. Cause not established; the owner should decide whether `down` should walk the child tree. Recorded here only.
- Residual (P5 PR): the per-run test-user passwords and client secret are in memory of the `up` process. A P5 test in another process cannot log in until a channel is chosen (D-HAR-F7).

## D-HAR-F9: a credential channel for the test users (owner decision, in this PR)

- Context: the per-run passwords lived only in the `up` process, so a test in another process could not log in (residual of D-HAR-F7).
- Options considered: (a) a fixed test password in a tracked file (violates CLAUDE.md, which forbids passwords in files); (b) a per-run run-state file in the harness's existing gitignored runtime state directory, mode 0600, removed on `down`, read through a typed reader; (c) an environment variable supplied by the operator.
- Choice: (b). `up` (flag `1`) writes `<harnessRoot>/.harness/documenso-oidc-run.json` with mode 0600 (`fs.writeFileSync` with `mode: 0o600`, then `chmodSync` so an existing looser file is tightened). `down` removes it first, so it is removed even if a later step fails. `up` also removes any stale file before it generates new values. `documensoOidcTestUsers()` (`src/adapters/documenso-oidc-run-state.ts`, exported from the index) returns `{ verified, unverified }` usernames and passwords.
- Reason: this is the owner's decision. It keeps the values out of tracked files and logs, and makes them readable from another process.
- Errors: `DOCUMENSO_OIDC_NOT_ENABLED` (flag unset or not `1`), `DOCUMENSO_OIDC_RUN_STATE_MISSING` (file absent, names the path), `DOCUMENSO_OIDC_RUN_STATE_INVALID` (not JSON or the wrong shape; the content is never printed).
- Evidence: `src/adapters/documenso-oidc-run-state.test.ts` (mode 0600, overwrite tightened, removal and idempotent removal, each reader error with no value in its message, the happy path returning only usernames and passwords, no output from the writer, remover or reader, and a static check that the adapter's OIDC log lines never interpolate a secret or password). Live check: see below.
- Residual: the file is readable by any process running as the same user while `up` is active. Consumers must not upload, print or commit it.

## D-HAR-F8 follow-up (build log only, not fixed here)

- Harness `down()` does not walk the child process tree of the web server. When the recorded pid is a dead wrapper, `down()` refuses to stop a live child listener on 127.0.0.1:3001 (see D-HAR-F8 above). Out of scope for this PR (owner decision). A follow-up should decide whether `down()` stops the process tree and how it proves the listener is ours.
- D-HAR-F9 live check (`DOCUMENSO_OIDC=1 npm run up -- documenso`, then `npm run down -- documenso`): `up` exit 0; the run-state file was created with mode 600 and the keys `clientId, clientSecret, redirectUri, users, version` (names only); the typed reader, called from a separate process, returned the two usernames and non-empty passwords; with the flag unset it threw `DOCUMENSO_OIDC_NOT_ENABLED`; the `up` log and the web log contain zero credential values; `down` exit 0 removed the file; no `qa-harness-*` container and no listener on 3001 remained.
