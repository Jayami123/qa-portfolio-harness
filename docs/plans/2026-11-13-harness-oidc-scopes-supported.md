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
