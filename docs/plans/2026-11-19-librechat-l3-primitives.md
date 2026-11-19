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

- **Status: not built in this pass.** Optional in the L3 plan ("optional until D5 PR"). Not attempted.

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
