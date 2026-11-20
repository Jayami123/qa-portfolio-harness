# Harness v0.6.5: LibreChat L3 primitives (H1 to H9)

- Branch: `feat/2026-11-19-librechat-l3-primitives`, from `main` at `63e4422` (v0.6.4). One release, `v0.6.5`. Draft PR only. No merge, no tag.
- Source: the suite's L3 plan `docs/plans/2026-11-18-l3.md` (section 6, "Blockers", issues H1 to H9) and the master plan's Appendix A. The suite is `Jayami123/ai-agent-mcp-eval-suite`, read from its default branch by a shallow clone on 2026-11-19. The master plan is not a separate file in the suite repo; the L3 plan's Appendix A is read as the source for the coverage table.
- Rules kept: every option is off by default; an unset option leaves the written `librechat.yaml` and env file byte-identical to 0.6.4; no product fork is edited; no secret is printed or written except the existing 0600 `secrets.json` and env file.

## How the docs were obtained

The image was pulled by digest and its source copied out, not read from the web. Pinned image: `ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9` (unchanged from `src/adapters/librechat-env.ts`).

```bash
IMG="ghcr.io/librechat-ai/librechat:v0.8.7@sha256:c5db3331b845e1f289f8d04c0c77936c4bbe372f76730a804abc1c37e44d23a9"
docker pull "$IMG"
CID=$(docker create "$IMG")
docker cp "$CID":/app ./app      # source tree, includes packages/*/src
docker rm "$CID"
```

## Config keys and their pinned-source quotes

| Key | Pinned source (image path) | Quote |
|---|---|---|
| `mcpServers.<name>.requiresOAuth` | `packages/data-provider/src/mcp.ts:190` | "Whether this server requires OAuth authentication. If not specified, will be auto-detected during construction" |
| `mcpServers.<name>.startup` | `packages/data-provider/src/mcp.ts` (BaseOptionsSchema) | "true (default): Server is initialized during app startup" |
| `mcpServers.<name>.chatMenu` | `packages/data-provider/src/mcp.ts` (BaseOptionsSchema) | "Controls visibility in chat dropdown menu (MCPSelect)" |
| `mcpSettings.allowedDomains`, `mcpSettings.allowedAddresses` | `packages/data-provider/src/config.ts:1721-1726` | `mcpSettings: z.object({ allowedDomains: z.array(z.string()).optional(), allowedAddresses: allowedAddressesSchema })` |
| `interface.mcpServers.{use,create,share,public,configureObo,placeholder,trustCheckbox}` | `packages/data-provider/src/config.ts:1133-1150` | UI permission and label keys only. None is a tool policy. |
| Any per-tool ask / allow / deny key | searched: `packages/data-provider/src/mcp.ts`, `packages/data-provider/src/config.ts`, `packages/api/src/mcp/**`, `packages/data-schemas/src/app/**` | No match for `toolApproval`, `autoApprove`, `alwaysAllow`, `allowedTools`, `disabledTools`, `requireConfirm`. The only "allow" lists are domain and address lists (`MCPServersRegistry.ts`). |

The `mcpServers` object is parsed by `MCPOptionsSchema`. The image does not state whether unknown keys are rejected; the harness never writes an unknown key.

## H1: mail catcher for Nextcloud

- **Status: not attempted in this pass.** The L3 plan says H1 is needed only if S2 finds a Nextcloud mail tool. S2 is not recorded in the suite repo. Not built. Needs the S2 answer first.
- **Session 6 (2026-11-19) built H1 with GreenMail, which has IMAP. See "Session 6" at the end of this file.** The Mailpit blocker below no longer applies.

## H2: second identity on each of the five MCP servers

- **Status: not built in this pass.** Each server needs its own second-user seed (Nextcloud user B, Outline viewer, Mattermost second author, Twenty second workspace key, a second LibreChat login). Every one needs a live run against its pinned image to prove the seed. No unit-only version is worth shipping. Left for a follow-up PR.

## H3: LibreChat tool-approval policy knob

- **Status: BLOCKED. Cannot be built against the pinned image (v0.8.7).** There is no `librechat.yaml` key for tool approval, ask, allow or deny globs in v0.8.7 (see the table above). The L3 plan's assumption that such a key exists is not met by this image. Per the rule "stop that item, record why", nothing is written for H3.
- What this blocks: 56 cases tagged `APPR`. The owner needs to decide whether they can use the LibreChat UI approval flow instead (not built here), or move to a LibreChat version that has the key. Neither is chosen here.

## H4: OAuth sign-in mode

- **Status: not built in this pass.** Would set `requiresOAuth: true` for servers that publish OAuth metadata. The current code writes `requiresOAuth: false` on purpose (see `src/adapters/librechat-env.ts`, comment on `requiresOAuth`), and changing that for a live run needs S3 (which servers are OAuth-capable). S3 is not recorded. Not built.

## H5: attack-lab entry in the harness

- **Files:** `src/adapters/librechat-env.ts` (`librechatMcpServerFor`), `src/adapters/librechat-env.test.ts`.
- **Option:** none. A new product name `lab` in `librechatMcpServerFor`. It is used only when `LIBRECHAT_MCP_PRODUCTS` names `lab`, so the default list is unchanged.
- **Effect:** `librechatMcpServerFor("lab")` returns `{ name: "lab", url: "http://p4-attack-lab:9010/mcp", authEnv: null }`. The alias and port come from the L2 plan (`docs/plans/2026-11-18-l2-attack-lab.md`, `LAB_RESOURCE` and alias `p4-attack-lab`, host ports on `127.0.0.1:9010-9012` only). `authEnv: null` because the lab takes no credential.
- **Live status:** the lab container is not in this repo yet (it is L2 work, outside this harness release). So the entry is unit-tested only.

## H6: browser tab that keeps Penpot's plugin running

- **Status: not built in this pass.** Needs Playwright (a pinned dependency, lane D5 in the L3 plan) and a live Penpot run. Not attempted.

## H7: seeded Mattermost posts from the second user

- **Status: not built in this pass.** Depends on H2 (the second identity). Not attempted.

## H8: nothing to build

- The L3 plan lists H8 as "not needed". Seed helpers are lane code, not a harness change. Recorded here only, as the plan asks.

## H9: recording proxy

- **Status: built in session 7 (v0.6.9), opt-in with `LIBRECHAT_MCP_RECORDING=1`.** See "Session 7" at the end of this file.

## Findings

- **F1. H3 cannot be built on the pinned LibreChat image.** The search above shows no tool-approval key in v0.8.7. The 56 `APPR` cases stay blocked. Owner decision needed (see H3).
- **F2. The L3 plan's source is in the suite repo, not in this repo.** The plan and its Appendix A are read from the suite's default branch.
- **F3. Most H items are not built in this pass.** H1, H2, H4, H6, H7 and H9 each need a live run against a pinned image or a decision from the suite (S2, S3). They are recorded as not attempted, not as blocked, so the next PR can take them one at a time.
- **F4. H5 is unit-tested only.** The lab container is not in the harness, so no live run of the lab entry is possible in this release.

## Session 2 results (2026-11-19, same branch)

### H3 re-check: a tool-approval key exists in LibreChat v0.8.8, not in the pinned v0.8.7

Source: the LibreChat git tags (`git clone` of `danny-avila/LibreChat`, tags `v0.8.7`, `v0.8.8`, `v0.8.9`). The GitHub release API was not reachable from this session, so release notes were not read; the source was.

- v0.8.7 (tag date 2026-06-24): no tool-approval key (searched `packages/data-provider`, `packages/api/src/mcp`, `packages/data-schemas`, `librechat.example.yaml`).
- **v0.8.8 (tag date 2026-09-30) adds `endpoints.agents.toolApproval`.** Schema: `packages/data-provider/src/config.ts` (`toolApprovalPolicySchema`, placed in the agents endpoint schema next to `toolApproval: toolApprovalPolicySchema`). Documented in `librechat.example.yaml` inside the commented `endpoints.agents` block:
  - `enabled` (boolean), `mode` (`default` | `dontAsk` | `bypass`), `allow`, `deny`, `ask` (string arrays of globs), `reason` (string with `{tool}`), `hooks` (module-loaded policy hooks).
  - Example from the file: `allow: ["mcp:trusted-server:read_*"]`, `deny: ["mcp:*:delete_*"]`, `ask: ["mcp:*:*"]`.
  - Its own comment: "Require user approval before matching tool calls. Disabled by default." and "`dontAsk`: deny anything not explicitly allowed (headless / API-key flows)".
  - Also needs a durable checkpointer (`endpoints.agents.checkpointer`, default `mongo`).
- v0.8.9 (tag date 2026-11-17) keeps the same key and adds approval handling in `packages/api/src/mcp/approval.ts` and `tools/approval`.

**Consequence:** the pinned image cannot provide the H3 knob. The owner decides whether to move the LibreChat pin to v0.8.8 or v0.8.9. A pin move changes every LibreChat run and must be a separate PR with its own live check. No workaround is built here.

**Pin correction:** `src/adapters/librechat-env.ts` and `docs/pins/p4.md` say v0.8.7 was "the newest stable tag at 2026-11-18". That was wrong: v0.8.8 (2026-09-30) and v0.8.9 (2026-11-17) already existed. The comment needs fixing in the pin PR.

### S2: does the Nextcloud MCP expose a mail tool? Yes.

Image `ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864…d325`, package `/opt/venv/lib/python3.14/site-packages/nextcloud_mcp_server/server/mail.py`. Tools: `nc_mail_list_accounts`, `nc_mail_list_mailboxes`, `nc_mail_list_messages`, `nc_mail_get_message`, `nc_mail_send_message`, `nc_mail_save_draft`, `nc_mail_get_attachment`, `nc_mail_view_attachment`, `nc_mail_get_message_source`, `nc_mail_set_flags`, `nc_mail_create_tag`, `nc_mail_set_tag`, `nc_mail_remove_tag`, `nc_mail_move_message`, `nc_mail_delete_message`.

They call `nextcloud_client.mail` (`/opt/venv/.../nextcloud_client/mail.py`), which uses the **Nextcloud Mail app** REST and OCS routes (`/index.php/apps/mail/api/...`, `/ocs/v2.php/apps/mail/...`). So the mail app must be installed, with a mail account configured.

**Decision: H1 is blocked, not built.** The read tools (list, get, source, attachments) need an IMAP account, and the pinned catcher cannot serve IMAP. The pinned Mailpit `axllent/mailpit:v1.22.3@sha256:f7f7c31d…0fe08` has SMTP (`--smtp`) and POP3 (`--pop3`) only (checked with `--help` from the pinned image). So `nc_mail_send_message` could reach a sink, but the inbox cases could not be read back. Fixing this needs an IMAP-capable image (for example Dovecot), a new pin the owner must approve. Not built.

### S3: which servers support OAuth discovery

| Server | Discovery evidence (pinned image or fork) | Result |
|---|---|---|
| Nextcloud MCP 0.213.2 | `nextcloud_mcp_server/app.py` ~3089: `/.well-known/oauth-protected-resource` (`authorization_servers` = the MCP itself) inside its OAuth mode (`oauth_enabled`). Default mode does not publish it. | Only in OAuth mode. Needs an OIDC setup. Not built. |
| Twenty v2.44.0 (fork HEAD `7cbdfec6`) | `packages/twenty-server/src/engine/api/mcp/guards/mcp-auth.guard.ts:27` sends `resource_metadata` pointing to `/.well-known/oauth-protected-resource/mcp`; `oauth-discovery.controller.ts:94` sets `authorization_servers: [base]`. | Yes. |
| Mattermost MCP @ `96ecd17` | `mcpserver/oauth_metadata.go`, `http_server.go:540`: `/.well-known/oauth-protected-resource` always on; the authorization server is the Mattermost site URL. | Yes, but Mattermost's own OAuth metadata was not verified. |
| Outline 1.13.0 | No `oauth-protected-resource` or `oauth-authorization-server` in `/app` or `/usr/src`. | No. |
| Penpot MCP 2.19.2 | None; the MCP uses a user token (`?userToken=`). | No. |

### H4: not built

LibreChat's `requiresOAuth: true` (schema at `packages/data-provider/src/mcp.ts:190`) makes LibreChat run a browser sign-in and consent. That needs an interactive browser (Playwright, the D5 dependency) to prove, and the harness has no such test. Mattermost's authorization server is not verified. So a knob written without a live proof would be unverified. Not built. Live verification is needed first.

### H2, H6, H7: not attempted in this session

Each needs a live seed or a browser run for each server, with its own proof. Not started. H9 is left for a later PR, as the owner asked.

### Full-stack CI

The new options in this PR are unchanged from the first push: H5 (lab, excluded by the owner's request) is the only one. The "every new option on" run therefore has nothing new to enable. The existing P4 workflows were run on `232d1a4`; results are in the PR.

## Session 3 results (2026-11-19, after #70 merged)

- `main` (with the v0.8.9 pin, #70) merged into this branch (merge commit `f41abce`). `npm run check`: 782 pass.

### H2, Nextcloud: built and live-verified

- Flag `P4_SECOND_IDENTITY=1` (exact value; any other value throws without echoing it). Unset: nothing changes.
- With the flag on, `NextcloudAdapter.seed()` creates `qa-user-b` over OCS as the owner (`POST /ocs/v2.php/cloud/users`), or resets its password if it already exists (code 102). The password is random per run and never written to disk. An app password is minted as that user and written to `.harness/nextcloud-b-run.json` (mode 0600).
- Live check (`npm run up -- nextcloud` with `P4_SECOND_IDENTITY=1`, then a probe that reads the run-state files and prints only identities and statuses): `nextcloud` → OCS `cloud/user` id `qa-owner`, MCP initialize HTTP 200; `nextcloud-b` → OCS `cloud/user` id `qa-user-b`, MCP initialize HTTP 200. Then `npm run down -- nextcloud`: both run-state files removed, no `qa-harness` containers left.
- Not done for H2: Outline, Twenty, Penpot and Mattermost second identities.

### H3, tool approval: built, unit-tested, partly live-verified

- Flag `LIBRECHAT_TOOL_APPROVAL=1`. Mode `LIBRECHAT_TOOL_APPROVAL_MODE` (`default`, `dontAsk` or `bypass`; default `default`). Rule lists `LIBRECHAT_TOOL_APPROVAL_ALLOW`, `_DENY`, `_ASK`: comma-separated `mcp:<server>:<tool>` globs. `<server>` must be `*` or an entry in `LIBRECHAT_MCP_PRODUCTS`. Rules without the flag throw `LIBRECHAT_TOOL_APPROVAL_NEEDS_FLAG`.
- Off by default: the YAML is byte-identical to 0.6.4 (unit tested).
- Written block (v0.8.9 schema: `agentsEndpointSchema` in `packages/data-provider/src/config.ts`, key `toolApproval` at line ~1889):

  ```yaml
  endpoints:
    agents:
      toolApproval:
        enabled: true
        mode: default
        allow: [...]
        deny: [...]
        ask: [...]
    custom:
      ...
  ```
- Unit tests: 795 pass, including flag and mode parsing, rule validation (form, unknown server), YAML with the policy off (byte-identical) and on (order and keys), and config loading.
- **Live, verified:** LibreChat v0.8.9 starts with `LIBRECHAT_MCP_PRODUCTS=nextcloud`, `LIBRECHAT_TOOL_APPROVAL=1`, `LIBRECHAT_TOOL_APPROVAL_ASK=mcp:nextcloud:*`. The generated `librechat.yaml` has the block above, and the app log shows `Custom config file loaded` with a `toolApproval` object. The adapter's readiness, login, seed and MCP wait all passed.
- **Live, NOT verified:** that an ask-listed tool really pauses for approval. That needs a model that emits a tool call (for example, an OpenAI-compatible stub behind `P4_STUB_API_BASE`), an agent that has the Nextcloud tool, a chat turn, and the pause event from `POST /api/agents/chat` followed by `POST /resume`. Not built in this session. Until it is, H3 is **unit-tested plus config-verified**, not behavior-verified.

### Incidents this session

- The Docker daemon was not running when the bring-up started. It was started the way `.claude/hooks/session-start.sh` starts it (`setsid -f dockerd`).
- The container's temp volume filled during a run. The first LibreChat start then failed in MongoDB's WiredTiger recovery (exit 1, no fatal line). The cause is most likely a write that failed on the full disk. The harness-owned LibreChat Mongo volume was removed (it held no seeded data), and LibreChat started on the next try. No other data was touched.
- Scratch copies made during this session were removed to free space: an extracted LibreChat source tree, a Nextcloud MCP image extract, a Penpot MCP extract, and two clones. The findings they produced are recorded above.

### Still open

- H3 behavior check (above).
- H2 for Outline, Twenty, Penpot, Mattermost.
- H7 (Mattermost posts from the second user; needs H2 for Mattermost).
- H6 (Penpot browser tab; needs Playwright, a D5 dependency).
- H1 (digest-pinned IMAP and SMTP server, for example GreenMail, and the Nextcloud Mail account). Not built.
- H4 and H9: moved to a later PR, as the owner asked.
- Full-stack run on this branch with every new option on except `lab`. Not dispatched in this session.

## Session 4: scope of this PR and the live H3 result

### What this PR builds

| Item | Status | Evidence |
|---|---|---|
| H5, attack-lab entry (`librechatMcpServerFor("lab")`) | Built, unit-tested. Not live: the lab container is not in this repo. | `librechat-env.test.ts` |
| H3, `endpoints.agents.toolApproval` | Built, off by default (`LIBRECHAT_TOOL_APPROVAL=1`). **Live-verified** (see below). | `librechat-approval.test.ts`, `scripts/live/librechat-approval.mjs` |
| H2, Nextcloud second identity | Built, off by default (`P4_SECOND_IDENTITY=1`). Live-verified (Session 3). | `p4-second-identity.test.ts`, `nextcloud.adapter.ts` |

### Live H3 check (passes)

`scripts/live/librechat-approval.mjs` drives LibreChat v0.8.9 through the real API. The model side is a fixture, `scripts/live/approval-stub.mjs`, an OpenAI-compatible stub that LiteLLM reaches through `P4_STUB_API_BASE`. It never calls a real model.

- Policy: `LIBRECHAT_TOOL_APPROVAL=1`, ask `mcp:nextcloud:nc_contacts_list_addressbooks`, deny `mcp:nextcloud:nc_contacts_delete_addressbook`, mode `default`.
- Agent: a saved agent with both Nextcloud tools, on `P4 LiteLLM` / `p4-stub`.
- Flow A (ask-listed): the chat turn starts; `GET /api/agents/chat/status/{id}` reports `requires_action` with a `tool_approval` pending action naming the tool; the stub has received **0** tool results while paused; `POST /api/agents/chat/resume` with `decisions: [{tool_call_id, decision: "approve"}]` returns 200; the run finishes with the stub's final answer; the stub received **exactly 1** tool result.
- Flow B (deny-listed): no pause at any point; the model receives a result for the deny-listed tool ("Blocked: Blocked by hook"); the address book the tool would delete still exists afterwards (checked through the Nextcloud MCP).

Findings from getting the check to pass (each one is a bug in the check or the setup, not in the product):

1. `POST /api/agents` returned `Illegal request`. Cause: LibreChat's `uaParser` middleware rejects any client that is not a recognized browser (`api/server/middleware/uaParser.js`). The check now sends a browser User-Agent on every LibreChat call.
2. `POST /api/agents/chat` returns JSON (`streamId`, `conversationId`) at once and runs the generation in the background. The `conversationId` it returns can differ from the one sent, so the check uses the returned one. Cancelling the response body disconnects the client, and LibreChat then aborts the job; the check no longer does that.
3. The status endpoint returns `active: false` and no status string once a job ends. So the check cannot wait for a "done" status. It waits for the stub's final answer in the messages instead.
4. The Nextcloud `notes` app is not installed in this image, so every `nc_notes_*` tool answers "unavailable". The check uses the core contacts tools.
5. The first deny result was a real pause, but the cause was the setup: the LibreChat container had been started with stale notes-tool rules in `librechat.yaml`, which are rendered at `up`. With the contacts rules in place, the deny tool is denied with no pause.
6. The Nextcloud second-identity bootstrap failed on a kept volume: Nextcloud answers "user already exists" with HTTP 400 and OCS status 102. The adapter now decides by the OCS status code (fixed in `7d8297e`, with a unit test).

### Dispatch with options on

The full-stack workflow (`p4-agent-hosts.yml`) has two `workflow_dispatch` inputs, both off by default: `tool_approval` (sets `LIBRECHAT_TOOL_APPROVAL=1` with the ask and deny rules above, `P4_STUB_API_BASE` for the stub, starts the stub, and runs the live check) and `second_identity` (sets `P4_SECOND_IDENTITY=1`). The run with both on is recorded in the PR description with its run ID and result.

### Follow-up PRs (not in this PR)

- **H2 for Outline, Twenty, Penpot and Mattermost.** Each needs its own second-user seed and a live proof. Twenty and Mattermost publish OAuth discovery; see the Session 2 table.
- **H7, Mattermost posts from the second user.** Depends on H2 for Mattermost.
- **H6, Penpot browser tab.** Needs Playwright (lane D5).
- **H1, mail.** Nextcloud's `nc_mail_*` tools read through the Mail app's IMAP account. The pinned Mailpit has SMTP and POP3 only. Needs a digest-pinned IMAP and SMTP server (GreenMail is a candidate) and a new image pin the owner must approve. The Mail app is also not installed in the Nextcloud image.
- **H4, OAuth sign-in mode.** Needs an interactive consent run to prove.
- **H9, recording proxy.** Optional; left for a later PR, as the owner asked.

## Session 4 addendum: PR #71 results (H2 on five servers) and H7

This addendum records what #71 built and proved, and the limits that were found. It is recorded here, not in a new plan, so the next reader has one place for H-item status.

### #71: H2 second identity on five servers (merged)

- Branch `feat/2026-11-19-l3-h2-identities`, merged into `main` as merge commit `d5666b5` at 2026-11-19 13:34:59Z by the owner's account. The PR was marked ready by the agent. The merge was not made by the agent.
- Dispatch `P4 agent hosts` with `second_identity=true`, on head `67ef6eb`: run `44531609090`, success. Its H2 steps passed: the five-product start and readiness probe (RAM budget included), `H2 stack up`, `Live H2 check`, `H2 stack down`, `Upload H2 evidence`, `No harness containers left`. The H3 steps were skipped as designed.
- PR-triggered run on the same head: `44531604752`, success. CodeQL, actionlint, typecheck and build, semantic title and the P4 adapters checks were green.
- Local live check (same code, before the dispatch), all five passed, each with two distinct identities and tools listed for both credentials: Nextcloud (110 tools per credential), Outline (20), Twenty (7), Penpot (5), Mattermost (121).

| Server | Second identity | What the MCP proves | Limit |
|---|---|---|---|
| Nextcloud | second user, its own app password | 110 tools per credential, two OCS user ids | none |
| Outline | second team member, its own API key | 20 tools per key; auth.info emails differ | none |
| Twenty | dev seeder's Member, shared password | 7 tools per key; currentUser emails differ | see below |
| Penpot | second profile over RPC | 5 tools; the two profiles differ | see below |
| Mattermost | second member, its own PAT | 121 tools per PAT; users/me names differ | none |

**Twenty: the second MCP credential is a workspace key, not a per-member key.** A Member is denied API-key management (`getApiKeyRoles`: "Entity performing the request does not have permission", live 2026-11-19). Keys belong to the workspace, not to a user. The second key is therefore minted by the workspace admin, with the owner's least-privilege role, and recorded against the Member. The Member's own sign-in is proven by `currentUser`. The MCP cannot tell the two members apart.

**Penpot: the MCP is single-user and cannot be bound per user.** The harness runs the MCP without `--multi-user`, and its plugin sends no token, so the MCP takes no credential for either profile. Its per-user mode (`?userToken=`) needs the browser plugin, which is H6. The identity proof for Penpot is the two profiles, through RPC login and `get-profile`, not the MCP.

**Mattermost, local only.** The MCP image build failed in this sandbox with `TLS: server certificate not trusted` on `apk`, because the sandbox proxy's CA is not in the build image. It was worked around with the existing `MATTERMOST_EXTRA_CA_FILE` option. CI did not need it. This is an environment fact, not a harness change.

### H7: Mattermost posts from the second user (this PR, not merged in this addendum)

- Branch `feat/2026-11-19-l3-h7-mattermost-posts`, from `main` after #71.
- Option `P4_SECOND_POSTS=1` (exact value, off by default). It needs `P4_SECOND_IDENTITY=1`: config fails with `MATTERMOST_POSTS_NEEDS_SECOND_IDENTITY` otherwise. The value is never echoed.
- The second member logs in with its derived password (the H2 account), reads town-square of team `qa`, and posts only the missing messages from three fixed ones, prefixed `p4-h7:`. A kept volume posts nothing new.
- The dispatch sets `P4_SECOND_POSTS` from the same `second_identity` input, so the full-stack run covers H7 without a new input. `scripts/live/mattermost-posts.mjs` reads the channel as the owner, and passes only if each message exists once, none is missing, and every one is authored by the second user's id. Its evidence is uploaded with H2's.

### Still open after this addendum

- H6 (Penpot browser tab, needs Playwright). Also the only route to a per-user Penpot MCP.
- H1 (IMAP and SMTP catcher for Nextcloud mail).
- H4 and H9, as before.

## Session 5: H6, a per-user Penpot MCP through open browser tabs

H6 is built on `feat/2026-11-19-l3-h6-penpot-plugin` from `main` after the H7 merge. The option is `P4_PENPOT_PLUGIN=1` (exact value, off by default). It needs `P4_SECOND_IDENTITY=1`, so there are two profiles to tell apart. Unset, the written compose files are the base files.

### How the per-user path works (read from the pinned images, 2.19.2)

- **Multi-user MCP.** The MCP image takes `--multi-user`. A request to `/mcp` names its user with `?userToken=`, and the plugin connects to `/mcp/ws?userToken=` with the same token. The override `docker/penpot.multiuser.compose.yml` adds the flag. Redis is not needed for one instance.
- **The toolbar is gated by a flag and by the profile.** The workspace shows the MCP toolbar only when the frontend flag `enable-mcp` is set (`contains? flags :mcp`) and the profile has the `mcp-enabled` prop. The UI sets the prop and creates an access token of type `mcp` when a user generates their token. The override sets `enable-mcp` on the frontend and backend, and the base `PENPOT_FLAGS` are unchanged.
- **The image serves the MCP routes when the flag is on.** With `enable-mcp` the frontend's nginx serves `/mcp/ws` and `/mcp/stream` itself from `PENPOT_MCP_URI_WS` and `PENPOT_MCP_URI`. The harness overlay `penpot-mcp-ws.conf` then duplicated `/mcp/ws` and nginx refused to start (live, 2026-11-19). The override mounts an empty overlay in its place.
- **The plugin's identity is the token.** The host starts the MCP plugin with `mcp.getToken()`, which is the workspace's MCP token. A tab that connected with a token is one user's plugin.

### Live result (local, 2026-11-19)

- Both tabs open with the plugin connected: `tab owner: plugin connected with a user token (file h6-owner-file)` and `tab second: ... (file h6-second-file)`.
- `node scripts/live/penpot-plugin.mjs`: `ok penpot per-user plugin: owner tab sees file=h6-owner-file (matches=true), second tab sees file=h6-second-file (matches=true), distinct=true, mcp tools owner=4 second=4`.
- The H2 probe still passes in multi-user mode: `ok penpot: ... distinct=yes mcp tools owner=4 second=4`. The single-user MCP listed 5 tools in the H2 probe before this change. I have not found why the count differs.
- `down` stops the tab process, removes its state files, and leaves no `qa-harness-*` container.

### Limits

- **The plugin cannot read the user.** The plugin manifest asks for no `user:read`, so `penpot.currentUser` is not available to it. The probe tells the profiles apart by the file each one opened (`penpot.currentFile.name`), not by a user field.
- **The tabs are a detached process.** `up -- penpot` starts them, and they stay open until `down -- penpot`. A run that stops without `down` leaves them running. The state folder `.harness/penpot/` is removed by `down`, and so is the tab process.
- **Browser version.** Playwright 1.63.0 pins the Chromium build (`chromium-1243`). The dispatch installs it with `npx playwright install --with-deps chromium`. This is a version pin, not a digest pin, and the owner should decide whether a digest pin is needed.
- **Test tokens.** Exploration created MCP access tokens named `h6-probe` and `h6-shape` for both profiles. They live only in the local Penpot volume and are not in CI. They can be deleted through `delete-access-token` when the local volume is removed.

### Still open

- H1 (IMAP and SMTP catcher), H4, H9. H6 is now in its own PR (`feat/2026-11-19-l3-h6-penpot-plugin`).

## Session 6: H1, mail for Nextcloud (GreenMail)

Branch `feat/2026-11-19-l3-h1-greenmail`, from `origin/main` at `f747f1a`. Release `v0.6.6`. Draft PR only. No merge, no tag.

### Why GreenMail

S2 (session 2) found that the Nextcloud MCP's `nc_mail_*` tools read through the Mail app over IMAP, and that the pinned Mailpit has SMTP and POP3 only. So the list and get tools could not be served. GreenMail 2.1.15 (`greenmail/standalone`, Docker Hub, pinned by digest 2026-11-19) serves IMAP and SMTP, so H1 can be built with it. The newest tag on Docker Hub when the session started was 2.1.15 (2026-10-25).

### What was checked before the code was written (2026-11-19, this container)

- **The app container cannot reach the Nextcloud app store.** `wget https://apps.nextcloud.com/...` from a container on the bridge fails with "Connection reset by peer". The host can reach it. So the Mail app is downloaded on the host, checked against a pinned SHA-256, copied into the container with `docker cp`, and enabled with occ.
- **Mail 5.13.3 is the newest stable release that declares Nextcloud 35.** `info.xml` says `nextcloud min 32 max 35` and `php min 8.1 max 8.5`. Its SHA-256 is `c9660a13b6734b26e84b2a9f87058a96cd89905e3834beae5b6da8d1d4007d7c`. The licence in the source is AGPL-3.0-only. The app-store signature was not verified.
- **The image's PHP has no `imap` extension** (`php -m`). Mail 5.x uses Horde's pure-PHP IMAP client, and its `info.xml` declares no `imap` dependency, so this is not needed.
- **GreenMail echoes `GREENMAIL_OPTS` on startup.** `docker logs` showed `-Dgreenmail.users=qa-owner:<password>@p4.test` in the first line. So the users are created over GreenMail's REST API (`POST /api/user`, password in the body) and never in the environment. After that, `docker logs` contains 0 occurrences of the password.
- **GreenMail logins use the login name, not the address.** IMAP `LOGIN qa-owner` works and `LOGIN qa-owner@p4.test` fails. SMTP AUTH PLAIN works. A `LOGIN` mechanism with an initial response is rejected with `500 Unsupported auth mechanism`. The Mail app's account therefore uses `qa-owner` for IMAP and SMTP.
- **The Mail app will not send until it knows a Sent mailbox.** Without one, `SentMailboxHandler` sets `STATUS_NO_SENT_MAILBOX`, and the API returns a generic `500 Could not send message`. Nothing reaches `nextcloud.log` in that case, which made it hard to find. A `Sent` folder created after the account exists is not picked up either: the mailbox list stayed at INBOX until the account was recreated. So the adapter creates `Sent` over IMAP (`CREATE`) before it creates the account.
- **The MCP reads cached envelopes, and the container has no cron.** A message that arrives after the last sync stays invisible to `nc_mail_list_messages`. The live check runs `occ mail:account:sync <id>` before it lists the inbox, and retries up to five times.
- **`nc_mail_list_mailboxes` returns `databaseId`** (camelCase), which the live check uses as the mailbox id.

### What was built

- `docker/greenmail.compose.yml`: GreenMail on `qa-harness-p4` with alias `greenmail`. IMAP 3143 and the REST API 8029 are bound to `127.0.0.1` only. SMTP stays on the network.
- `docker/nextcloud.mail.compose.yml`: adds the app container to `qa-harness-p4`. It is used only with `P4_MAIL=1`.
- `src/adapters/greenmail-env.ts`, `greenmail-imap.ts`, `nextcloud-mail.ts`, `nextcloud-mail-seed.ts`, `mcp-call.ts`: pins, the flag, REST and IMAP helpers, the occ arguments, the Mail app install, and the MCP tool client. Each pure function has a unit test. The IMAP socket code is tested against a fake IMAP server.
- `src/adapters/nextcloud.adapter.ts`: with `P4_MAIL=1`, `up` starts GreenMail (empty), then Nextcloud, then the Mail app and the accounts, then the MCP. `down` always stops GreenMail. `probeMail()` is the live check.
- `scripts/live/mail.mjs`: the live check. It prints one line per identity and exits 1 on any failed step.
- Config: `P4_MAIL` is validated like `P4_SECOND_IDENTITY` (exactly `1`, or unset). An invalid value throws `P4_MAIL_INVALID` without echoing the value.

### Per-run passwords

Each `up` makes a new password for each identity (`generateNextcloudSecret`). It is kept in memory only: it goes to GreenMail in a REST body, to occ as an argument (`runCapture` with `redact`), and to the IMAP `CREATE` call. It is never printed, logged, or written to `secrets.json`, `.harness/*` or the env file. GreenMail is recreated on each `up`, so no old user or password survives. The Mail app stores the account's password in the Nextcloud database, as any Mail account does.

### Live result (local, 2026-11-19, `P4_MAIL=1 P4_SECOND_IDENTITY=1`)

```
ok owner: qa-owner@p4.test account=4 inbox listed (0 before) sent=yes greenmail stored=yes listed after sync=yes
ok second: qa-user-b@p4.test account=5 inbox listed (0 before) sent=yes greenmail stored=yes listed after sync=yes
H1 live check passed for: nextcloud mail (2 identities)
```

The same run also showed the kept-volume path: `up` deleted the previous run's account (`Deleted account 3`) and created account 4 for `qa-owner`. The first `up` on the kept volume from the prototype deleted account 2 and created account 3.

### Limits and what is not claimed

- The GreenMail licence is UNVERIFIED. The jar in the image carries no licence file, and the upstream licence was not read in this session. Recorded as such in `docs/pins/p4.md`.
- The Mail app tarball comes from GitHub at `up` time. A run needs `github.com` to be reachable from the runner. The SHA-256 is checked, but the app-store signature is not.
- The live check syncs with `occ`, because the container has no cron. The check does not test the Mail app's background sync.
- The message body is not checked, only the marker subject.
- RAM for GreenMail and the Mail app was not measured in this session. The CI full-set probe (`ram-probe-full.json`) measures it on the dispatch with `second_identity` on.

### Still open

- H3, H4, H9: unchanged. H2, H6 and H7 are on `main` and ship in 0.6.6 (see CHANGELOG).

---

## Session 7: H9, the MCP recording proxy (v0.6.9)

This section is a guide. A new engineer should be able to repeat every step from it. Commands run from the repository root.

Branch: `feat/2026-11-20-l3-h9-recording-proxy`, from `origin/main` at `e796439` (v0.6.8). One release, `v0.6.9`. Draft PR only. No merge, no tag.

### 1. What H9 is, in one paragraph

H9 is an optional recording proxy. It sits between LibreChat and each MCP server, forwards every byte unchanged, and writes a copy of each request and response to a log. The copy is redacted: credentials never reach the log. It is off by default. With the switch off, every file the harness writes is the same as in 0.6.8.

### 2. What the L3 cases need (the probe, part A)

Question: which L3 cases need H9, and what must they observe?

- **What the repo says.** The L3 plan marks H9 as optional ("optional until D5 PR"). It names no case IDs.
- **What this session could read.** The suite's own L3 plan (`docs/plans/2026-11-18-l3.md` in `Jayami123/ai-agent-mcp-eval-suite`) is in another repository. This session may not read other repositories, so the case list is **not confirmed here**. Treat it as an open question for the owner (see section 9).
- **What H9 must observe, from the harness side.** For each MCP server LibreChat uses: every JSON-RPC request (method, tool name, arguments, with credentials removed), the response status, the response body (for a long stream, its head at once and its body when it closes), and the session handshake (`initialize`, `notifications/initialized`, `ping`, the event stream, `tools/list`, `DELETE`).

### 3. The live probe (part B): what the wire looks like

Run against the stack on this container (Nextcloud 35, its MCP 0.213.2, LiteLLM stub mode, LibreChat v0.8.9). The probe script is not committed. Its results are below, with every credential read from the run-state file and never printed.

**B1. The Nextcloud MCP, called directly (no recorder).**

| Step | Result |
|---|---|
| `initialize` | HTTP 200, `content-type: text/event-stream`, a `mcp-session-id` header, body `event: message` then `data: {...}` |
| `notifications/initialized` | HTTP 202, empty body |
| `tools/list` | HTTP 200, `text/event-stream`, **272,783 bytes** |

So MCP answers are server-sent events, not plain JSON. The recorder must read SSE bodies line by line, and must clip large bodies.

**B2. LibreChat's own traffic, through the recorder (flag on).**

`docker logs qa-harness-librechat-mcp-recorder-1` on the first run, after LibreChat started:

| Order | Method | Headers of note | Notes |
|---|---|---|---|
| 1 | `POST /mcp` `initialize` | `user-agent: undici`, `accept: application/json, text/event-stream` | no session id yet |
| 2 | `POST /mcp` `notifications/initialized` | `mcp-session-id` | |
| 3 | `POST /mcp` `ping` | `mcp-session-id` | |
| 4 | `GET /mcp` | `accept: text/event-stream` | **long-lived**: its response only ends when the session closes |
| 5, 6 | `POST /mcp` `tools/list` | `mcp-session-id` | twice per connection |
| 7 | `DELETE /mcp` | `accept: */*` | closes the session |

The first run wrote 12 requests and 11 responses. The eleventh response was missing because the `GET` stream had not ended. That is why the recorder now writes the response head on arrival (section 5).

**B3. The config LibreChat received.** Diffing `librechat.yaml` with the flag off and on shows exactly two changed lines: the allowed domain `nextcloud-mcp` becomes `mcp-recorder`, and the URL becomes `http://mcp-recorder:9100/nextcloud/mcp`. Nothing else moves. Its `Authorization` header is still sent by LibreChat, and the recorder redacts it.

**B4. The leak check on real traffic.**
- Nextcloud direct, through the recorder: 2 secret values checked, 0 found in the log.
- LibreChat's recording: 11 secret values from the env file and the secrets file checked, 0 found. Every `authorization`, `cookie` and `set-cookie` header in the log reads `[REDACTED]`.

### 4. Choosing the proxy (justification)

The task allowed either a pinned, established proxy image or a small in-repo proxy. I chose **the small in-repo proxy**, for these reasons:

1. **Redaction is the risky part, and it has to be tested.** The redaction code lives in `src/mcp-recorder/redact.ts`, in TypeScript, and runs under the same `npm test` that guards the rest of the harness. A third-party image would need its redaction rules written in another language and tested apart from this repo.
2. **Streaming must be right.** MCP answers with server-sent events, and the `GET` stream never ends. The proxy pipes bytes as they arrive. A buffering proxy would hold them back.
3. **No new third-party image to license-check.** The `GreenMail` licence was left UNVERIFIED in an earlier session. Avoiding a new image avoids a new unverified licence.

The industry tool for recording HTTP traffic is **mitmproxy**. It is a fine choice when you need TLS interception, which this harness does not need, since its MCP servers answer plain HTTP on the private network. A mitmproxy addon would also need its own pinned image, a Python test runner, and a second redaction implementation.

The recorder runs as `node:22-alpine`, pinned by digest (`docs/pins/p4.md`). The `.nvmrc` pins Node 22, so the runtime matches. The recorder's code is the compiled `dist/mcp-recorder` folder, mounted read-only. No secret is passed to the recorder container.

### 5. What was built

| File | What it does |
|---|---|
| `src/mcp-recorder/redact.ts` | Redaction (no imports). Headers, text, JSON, SSE data lines, and `countLeakedValues` for the leak checks. |
| `src/mcp-recorder/routes.ts` | Parses `MCP_RECORDER_ROUTES` (`name=origin`). Refuses credentials, paths, queries and non-http schemes, and never prints a URL. Matches `/<name>/...`. |
| `src/mcp-recorder/proxy.ts` | The reverse proxy. Forwards bytes unchanged. It asks the upstream for `accept-encoding: identity`, so bodies are plain text the redaction can read; logs `request`, then `response` (head on arrival), then `response_body` (on end). Bodies are clipped at 64 KiB, dropping the last 512 bytes of a clipped body. Requests over 4 MiB get 413. |
| `src/mcp-recorder/main.ts` | Container entry. Stdout gets one JSON line per record; stderr gets the start message. |
| `docker/librechat.recording.compose.yml` | Override file: the `mcp-recorder` service (read-only, no capabilities, healthcheck) and `app` waits for it. Included only with the flag on. |
| `src/adapters/librechat-recording.ts` | The flag (`1` or unset), `recordedServers` (URL rewrite), `recorderRoutes`. |
| `src/adapters/librechat-env.ts` | `librechatComposeFiles(recording = false)`. The default returns the same single file as before. |
| `src/adapters/librechat.adapter.ts` | Writes the recorded URLs and adds the override file only with the flag on. Fails with `MCP_RECORDER_NOT_BUILT` if `dist/` is missing. |
| `src/config.ts` | `LIBRECHAT_MCP_RECORDING`, default off, `mcpRecording` on the LibreChat config. |
| `scripts/live/mcp-recording.mjs` | The live H9 check. Reads `docker logs`, checks health, handshakes, no forwarding errors, redacted headers and the leak check. A pass copies the redacted log to `evidence/`. |
| `.github/workflows/p4-agent-hosts.yml` | Dispatch input `mcp_recording` (off by default). Sets the flag for the whole job; runs its own H9 stack, the check, and uploads the evidence. |
| `docs/pins/p4.md`, `src/adapters/p4-pins.test.ts` | The Node image pin and the new compose file in the pins test. |

### 6. How to run it (for a new engineer)

```bash
export PATH="/usr/local/bin:$PATH"
npm ci
npm run build                      # the recorder mounts dist/; the adapter refuses to start without it
LIBRECHAT_MCP_RECORDING=1 LIBRECHAT_MCP_PRODUCTS=nextcloud npm run up -- nextcloud
LIBRECHAT_MCP_RECORDING=1 LIBRECHAT_MCP_PRODUCTS=nextcloud npm run up -- litellm
LIBRECHAT_MCP_RECORDING=1 LIBRECHAT_MCP_PRODUCTS=nextcloud npm run up -- librechat
LIBRECHAT_MCP_PRODUCTS=nextcloud node scripts/live/mcp-recording.mjs
npm run down -- librechat
npm run down -- litellm
npm run down -- nextcloud
docker ps --filter name=qa-harness --format '{{.Names}}'   # must print nothing
```

Read the raw log with `docker logs qa-harness-librechat-mcp-recorder-1`. Every line is JSON. Credentials show as `[REDACTED]`.

### 7. Checks that prove it

- **Unit tests** (`npm test`): redaction of every credential form (headers, Bearer, Basic, JWT, cookies, query tokens, JSON and SSE keys, unterminated quotes); a leak check over a recording built from fake secrets planted everywhere; route parsing and refusals (credentials are never printed); the proxy against a real local upstream (forwarding unchanged, SSE streamed and logged head-first, large bodies clipped, 404, 413, 502 with a code only); the flag, the recorded URLs, and the default-off compose file list; the config default.
- **Default off** (`librechat-recording.test.ts`, `config-p4.test.ts`): with the flag unset, the compose list is the single file and the config flag is `false`.
- **Live** (section 3 and section 8): the flag-off YAML was saved before the change and compared after it (section 8).

### 8. Results (local, 2026-11-20, this container, final code)

Commands are those in section 6, with `LIBRECHAT_MCP_PRODUCTS=nextcloud`.

| Check | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run check` (typecheck, tests, build) | exit 0. `# tests 946, # pass 945, # fail 0, # skipped 1` (the skip was there before this session) |
| Flag off: `librechat.yaml` against the 0.6.8 baseline saved before the change | **identical** (`diff` empty) |
| Flag off: recorder container after `up` | none. A recorder left from an earlier flag-on run is removed by `down` (orphan removal) |
| Flag on: `scripts/live/mcp-recording.mjs` | passed. Recorder healthy; 12 requests and 12 responses; `initialize` answered 200 for `nextcloud`; 0 forwarding errors; every credential header `[REDACTED]`; leak check 11 values, 0 found |
| `down` for librechat, litellm, nextcloud | exit 0 each. `docker ps -a --filter name=qa-harness` lists nothing |

The live probe that came before the code (section 3) and the Nextcloud direct probe through the recorder (section 3, B1) were run on this container too. Earlier rounds of the check printed one response fewer than requests, because the long `GET` stream had not ended; the response head is now logged on arrival, which fixed that.

CI dispatch result: see section 10.

### 9. Limits, deviations and open points

- **The L3 case list is not confirmed.** This session cannot read `ai-agent-mcp-eval-suite`. The owner needs to name which cases use H9.
- **Streams are logged head-first.** A long `GET` stream's body is written only when the stream closes. A stream still open at `down` is not fully logged.
- **Clipping.** A body over 64 KiB is logged as a prefix (its last 512 bytes dropped). The clip is marked `bodyTruncated: true`. A credential is still never written, but a prefix of a large body is all that is recorded.
- **Redaction is pattern-based.** It covers the forms listed in section 7. A credential with a new shape and no key name, sent in a plain-text body, would not be caught. The live leak check covers the values this run holds.
- **Not built:** TLS interception, recording to a file, and recording the Penpot, Outline, Twenty and Mattermost servers. The recorder takes any route, but only the Nextcloud server was run live here.
