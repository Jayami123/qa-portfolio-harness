# Harness v0.6.8: wait for the Nextcloud Mail accounts route

- Branch: `fix/2026-11-20-nextcloud-mail-route-wait`, from `origin/main` at `30562a2` (v0.6.7). Draft PR only. No merge, no tag.
- Scope: one fix in the P4 Nextcloud Mail seed, its unit tests, the version bump to 0.6.8, and this note.

## 1. The failure

The P4 mail run (`P4_MAIL=1`, and `P4_SECOND_IDENTITY=1` for the second identity) fails in `configureMailIdentity`:

```
Mail accounts list for qa-owner returned HTTP 404
```

The reported suite CI runs are 44590431418 and 44604176433 (2 of 3 failed). The code path, before the fix:

1. `installMailApp` runs `occ app:enable mail` in the Nextcloud app container.
2. `configureMailIdentity` sends one `GET /index.php/apps/mail/api/accounts` with the identity's Basic credential.
3. Any status other than 200 throws.

Nothing waited between step 1 and step 2.

## 2. Cause: what was confirmed and what was not

Confirmed:

- The code has no wait between enable and the first accounts request, and it throws on any non-200 (`src/adapters/nextcloud-mail-seed.ts`, before this change).
- The P4 agent hosts workflow (`.github/workflows/p4-agent-hosts.yml`) sets `P4_MAIL` and `P4_SECOND_IDENTITY` from the `second_identity` input.

Evidence from this session (local Docker, not CI):

| Check | Result |
|---|---|
| Baseline `npm run up -- nextcloud` with `P4_MAIL=1 P4_SECOND_IDENTITY=1`, unfixed build | exit 0. Both identities configured. The single GET right after enable returned 200 (otherwise it would have thrown). |
| Probe: 5 times, `occ app:disable mail`, `occ app:enable mail`, then poll the accounts route every 50 ms | Each run: first poll was 200. Time to first 200 was 60, 63, 63, 73 and 108 ms. No 404 seen. |
| `gh run view` / `gh api` on 44590431418 and 44604176433 | Not visible from this session (HTTP 404 for the repository's runs). The CI logs were not read here. |

Conclusion: this session did not reproduce the 404. The race did not show up locally in one full run and five enable probes, so the exact window is not measured. The fix does not depend on knowing the window. It polls for the 200 that the route gives once it is ready, and it fails fast on anything else.

## 3. Fix

- `waitForStatus` (in `nextcloud-mail-seed.ts`) takes an optional `retryOn` list of HTTP statuses. Without it, the helper behaves as before, so GreenMail startup is unchanged.
- With `retryOn`, only the listed statuses are polled. Any other status, and any connection failure, throws at once.
- `waitForMailAccountsRoute(baseUrl, identity)` calls the helper with `status 200`, `retryOn [404]`, and the budget from `p4WaitBudgetMs()`. The poll interval is the existing 2 s. There is no fixed sleep.
- The timeout error names the route, the identity and the last status, for example `Mail accounts route /index.php/apps/mail/api/accounts for qa-owner did not answer HTTP 200 within the budget (last: HTTP 404)`.
- `configureMailIdentity` calls `waitForMailAccountsRoute` before its existing list request, so the list request, the account cleanup and the rest of the flow are unchanged.

Not changed: the Mail app, the product forks, the product `.env` files, and the GreenMail path.

## 4. Tests

`src/adapters/nextcloud-mail-seed.test.ts` (7 tests, fetch is stubbed):

| Test | Expected |
|---|---|
| 404 then 404 then 200 | Succeeds after 3 calls |
| 200 at once | Succeeds after 1 call |
| Always 404, short budget | Throws the timeout error that names the route, `for qa-owner`, and `(last: HTTP 404)` |
| 401 then 200 | Throws `returned HTTP 401 (not retried)` after 1 call |
| 500 then 200 | Throws `returned HTTP 500 (not retried)` after 1 call |
| Connection failure then 200 | Throws `request failed (not retried)` after 1 call |
| Credential check | The identity's Authorization header goes to the accounts route only |

## 5. Verification

- `npm run build` and `npm run check`: see the output in the final report.
- Dispatch runs of the P4 agent hosts workflow with `second_identity=true` (this sets `P4_SECOND_IDENTITY=1` and `P4_MAIL=1`), twice, on this branch: see section 6.

## 6. Dispatch runs

Workflow `P4 agent hosts` (`p4-agent-hosts.yml`), `second_identity=true` (sets `P4_SECOND_IDENTITY=1` and `P4_MAIL=1`), on this branch:

| Run | Result | Notes |
|---|---|---|
| 44680758818 | cancelled | Not a result. A second dispatch on the same ref started while it ran, and the workflow's `cancel-in-progress` cancelled it. |
| 44680798245 | success | Both identities logged `Nextcloud Mail: qa-owner@p4.test, qa-user-b@p4.test configured`. The H1 live check step ran. |
| 44683383354 | success | Same log lines. The H1 live check step ran. |

Both successful runs configured the Mail accounts for both identities through the fixed path. Neither run logged a 404 from the route wait.

## 7. Rules kept

- No product fork is edited and no product `.env` is written.
- No secret is printed. The probe prints status codes and milliseconds only. The credential file was read in memory and never printed.
- Local stacks were started and stopped with `npm run up -- nextcloud` and `npm run down -- nextcloud`. After `down`, no `qa-harness-*` container was left.
