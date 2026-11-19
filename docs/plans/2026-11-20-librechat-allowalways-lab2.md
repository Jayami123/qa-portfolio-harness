# Harness v0.6.7: LibreChat Always allow and a second attack lab (allowAlways, lab2)

- Branch: `feat/2026-11-20-l3-allowalways-lab2`, from `main` at `8a8a5f4` (v0.6.6). One release, `v0.6.7`. Draft PR only. No merge, no tag.
- What it adds, two options, both off by default:
  1. **Always allow**: `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1` writes `endpoints.agents.toolApproval.allowAlways: true` into `librechat.yaml`.
  2. **lab2**: `lab2` in `LIBRECHAT_MCP_PRODUCTS` attaches a second attack-lab MCP server.
- Rules kept: an unset option leaves the written `librechat.yaml` byte-identical to 0.6.6 (unit tested). No product fork is edited. No product `.env` file is written. No secret is printed; the probe prints names and statuses only.

This guide is written so that a new engineer can repeat every step. Run commands from the repository root unless a step says otherwise.

---

## 1. What the options do (read this first)

| Option | Set it with | Accepted values | Written to `librechat.yaml` | Refused when |
|---|---|---|---|---|
| Always allow | `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS` | `1` (on) or unset (off) | `allowAlways: true` as the last key of `endpoints.agents.toolApproval` | the value is anything else (`LIBRECHAT_TOOL_APPROVAL_INVALID`, value not printed); `LIBRECHAT_TOOL_APPROVAL=1` is not set (`LIBRECHAT_TOOL_APPROVAL_NEEDS_FLAG`); `LIBRECHAT_TOOL_APPROVAL_MODE=dontAsk` (`LIBRECHAT_TOOL_APPROVAL_INVALID`) |
| lab2 | add `lab2` to `LIBRECHAT_MCP_PRODUCTS` | a product name in the list | `mcpServers.lab2` with `url: http://p4-attack-lab-2:9011/mcp` and no `Authorization` header | never refused by itself; only used when named |

Code locations:

- `src/adapters/librechat-approval.ts`: `parseAllowAlwaysFlag`, the `allowAlways` field, and `toolApprovalYamlLines` (writes the key only when it is `true`).
- `src/config.ts`: `buildLibreChatToolApproval` (validation and the mode check).
- `src/adapters/librechat-env.ts`: `librechatMcpServerFor`, the `lab2` case.
- `scripts/live/librechat-approval.mjs`: the live H3 check, with the second-call flow.
- `.github/workflows/p4-agent-hosts.yml`: the `allow_always` dispatch input.

### Why Always allow needs the ask rule removed (important)

LibreChat never offers "Always allow" for a tool that an `ask` rule matches. The rule is in `packages/api/src/agents/hitl/allow.ts`, function `isToolAllowAlwaysEligible`: a tool is eligible only if `!matchesToolApprovalPatterns(policy.ask, toolName)`. The `ask` rule is the administrator's "always prompt" rule, so it is excluded on purpose.

Our H3 check used `ask` to force the pause. With Always allow on, that tool can never be offered the choice. The first live run confirmed this (section 5, run A0). So with the flag on, `LIBRECHAT_TOOL_APPROVAL_ASK` must be empty. The tool still pauses, because in `mode: default` a tool that no rule matches asks for approval (the "unmatched-tool ask fallback", `packages/api/src/agents/hitl/policy.ts`, `isToolApprovalPauseCapable`).

The `deny` rule still blocks its tool, as before.

---

## 2. Live probe: the source evidence (done before the code)

The pinned image is LibreChat **v0.8.9** (`LIBRECHAT_IMAGE` in `src/adapters/librechat-env.ts`). The source was read from the tag, not from the web. Commands used:

```bash
git clone --depth 1 --branch v0.8.9 https://github.com/danny-avila/LibreChat.git librechat-src
cd librechat-src
git log -1 --format='%H %ci'
# expected: d4e85d2205c78413ee27d631d7e3b7313556f21d 2026-11-17 09:22:57 -0500
grep -n "toolApproval: toolApprovalPolicySchema" packages/data-provider/src/config.ts
grep -n "allowAlways: z.boolean" -B8 packages/data-provider/src/config.ts
```

Findings:

| Question | Answer | Where (v0.8.9) |
|---|---|---|
| Exact key name | `allowAlways` (camel case, boolean) | `packages/data-provider/src/config.ts`, `toolApprovalPolicySchema`, line ~1485 |
| Default | `false`: every paused call keeps prompting | same schema; the comment says "Defaults to `false`" |
| Placement | `endpoints.agents.toolApproval.allowAlways` | `agentsEndpointSchema` sets `toolApproval: toolApprovalPolicySchema` (line ~2510). The example file `librechat.example.yaml` line ~1121 shows the same placement |
| Under `dontAsk` | ignored (stored choices are not used) | `packages/api/src/agents/hitl/allow.ts`, `isToolAllowAlwaysEnabled` |
| What "Always allow" stores | the tool name, for the conversation, when the approve decision has `scope: "session"` | `packages/data-provider/src/types/agents.ts` (`ToolApprovalResolution.scope`); `allow.ts`, `collectToolApprovalAllows` |
| Which tools get the choice | a card gets `allow_always: true` only when the tool is not matched by `deny` or `ask`, has no `*` in its name, and is not a native code tool | `allow.ts`, `isToolAllowAlwaysEligible` |

The value is written by the harness; it is not a guess. The `toolApproval` schema in `packages/data-provider/src/config.ts` is the same one the harness already writes for H3.

---

## 3. Build and unit tests

```bash
export PATH="/usr/local/bin:$PATH"   # Cursor and Claude Code cloud images put Node on PATH here
npm ci
npm run check
```

Expected: the last lines are

```text
# tests 892
# pass 891
# fail 0
# skipped 1
```

and the command exits 0. (Before this release the count was `# tests 880`, `# pass 879`.)

To run only the new tests:

```bash
npm run build
node --test --test-name-pattern="allowAlways|lab2|Always allow" "dist-test/**/*.test.js" 2>&1 | grep -E "^ *ok "
```

Expected: lines such as `ok 3 - keeps the whole librechat.yaml byte-identical when allowAlways is false`, `ok 3 - maps lab2 to its own alias and port, with no credential`, and `ok 4 - refuses allowAlways under mode dontAsk, where LibreChat ignores remembered choices`.

What the unit tests prove:

- The default output is unchanged: with `allowAlways` absent or `false`, `librechatYaml(...)` is byte-identical to the output without the key.
- `true` emits exactly one `allowAlways: true` line, as the last key of the block, before `endpoints.custom`.
- An invalid value (`zz-always`, `true`, `yes`, `0`) throws `LIBRECHAT_TOOL_APPROVAL_INVALID` and does not echo the value.
- `lab2` maps to `http://p4-attack-lab-2:9011/mcp` with no credential, and the default five-server YAML contains no `lab` or `lab2` entry.

---

## 4. Turn the options on for a local run (only if you need a live check)

You need Docker and enough free disk for the pulled images (several GB). Start every product through the harness scripts only, and stop each one the same way. Never run `docker compose` by hand against these projects.

```bash
export PATH="/usr/local/bin:$PATH"
export P4_LLM_MODE=stub
export LIBRECHAT_MCP_PRODUCTS=nextcloud
export LIBRECHAT_TOOL_APPROVAL=1
export LIBRECHAT_TOOL_APPROVAL_ASK=""                 # empty: see section 1 (an ask match is never offered Always allow)
export LIBRECHAT_TOOL_APPROVAL_DENY="mcp:nextcloud:nc_contacts_delete_addressbook"
export LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1
export P4_STUB_API_BASE="http://host.docker.internal:9099/v1"
```

Start the approval stub (it answers the model; it never calls a real model), then the three products in order:

```bash
APPROVAL_STUB_PORT=9099 nohup node scripts/live/approval-stub.mjs > stub.log 2>&1 &
curl -s http://127.0.0.1:9099/stats
# expected: {"requests":0,"toolResults":0,"toolResultNames":[],"toolResultTexts":[],"offered":[]}
npm run up -- nextcloud
npm run up -- litellm
npm run up -- librechat
```

`npm run up -- librechat` ends with a line that begins `LibreChat is up` and exits 0. The other two exit 0 as well. Check the policy block that was written:

```bash
sed -n '/^endpoints:/,/^  custom:/p' .harness/librechat/librechat.yaml
```

Expected (the last line of the block is the new key):

```text
endpoints:
  agents:
    toolApproval:
      enabled: true
      mode: default
      allow: []
      deny: ["mcp:nextcloud:nc_contacts_delete_addressbook"]
      ask: []
      allowAlways: true
  custom:
```

If `allowAlways` is missing, the `dist/` build is older than the source. Run `npm run build`, then `npm run down -- librechat` and `npm run up -- librechat` again. (This happened once during this release; see section 5.)

Run the live check, then print only its summary:

```bash
node scripts/live/librechat-approval.mjs "$PWD" | tee probe.txt
tail -1 probe.txt
```

Expected last line: `PASS: H3 live check with Always allow (ask pauses; the remembered approval runs the second call with no pause; deny never runs)`.

Control run (the same configuration with the flag off). It must show the second call pausing again:

```bash
npm run down -- librechat
unset LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS
npm run up -- librechat
node scripts/live/librechat-approval.mjs "$PWD" | tee probe-control.txt
tail -1 probe-control.txt
```

Expected last line: `PASS: H3 live check (ask pauses and resumes; deny never pauses and never runs; the second call pauses without Always allow)`, and the line `ok: control: without Always allow the second call pauses again`.

Always finish with the stop commands and confirm nothing is left:

```bash
npm run down -- librechat
npm run down -- litellm
npm run down -- nextcloud
pkill -f scripts/live/approval-stub.mjs || true
docker ps -a --filter name=qa-harness --format '{{.Names}}'
# expected: no output
```

---

## 5. Live results recorded for this release

Stack: LibreChat v0.8.9 (digest in `src/adapters/librechat-env.ts`), Nextcloud and its MCP as pinned in `docs/pins/p4.md`, LiteLLM in stub mode, the approval stub. Output is the probe's own printout (names and statuses only).

**Run A0, first attempt (configuration error, not a product bug).** Flag on, with the ask rule still set on `nc_contacts_list_addressbooks`:

```text
ok: the ask-listed run pauses for approval (status requires_action)
FAIL: the approval card offers Always allow (allow_always)
```

Cause: an `ask` match is never offered Always allow (section 1). Fix: `LIBRECHAT_TOOL_APPROVAL_ASK` empty when the flag is on. The probe now refuses to run with the flag on and an ask rule set, so this cannot pass silently again.

**Run A1, Always allow on (the result that matters).** The lines below are copied from the probe's output:

```text
ok: the approval card offers Always allow (allow_always)
ok: Always allow needs LIBRECHAT_TOOL_APPROVAL_ASK unset (an ask match is never offered Always allow)
ok: POST /resume accepted the approval (HTTP 200)
ok: the approved tool ran exactly once (toolResults 1)
ok: the second call runs without a pause (the remembered approval persists)
ok: the remembered tool ran once in the second call (toolResults 1)
ok: the deny-listed run never pauses for approval
ok: the address book the deny-listed tool would delete still exists
PASS: H3 live check with Always allow (ask pauses; the remembered approval runs the second call with no pause; deny never runs)
```

The first approval was sent with `scope: "session"` (the harness sends it only when the flag is on). The second call used the same conversation id and the final answer of the first turn as its parent.

**Run A2, control (flag off, same configuration).**

```text
ok: the approval card does not offer Always allow (flag off)
ok: the approved tool ran exactly once (toolResults 1)
ok: control: without Always allow the second call pauses again
PASS: H3 live check (ask pauses and resumes; deny never pauses and never runs; the second call pauses without Always allow)
```

So the persistence in A1 comes from the remembered choice, not from the setup: the same second call pauses when the choice was not made.

**Stack cleanup:** `down` for `librechat`, `litellm` and `nextcloud` exited 0; `docker ps -a --filter name=qa-harness` printed nothing.

### Incident in this release (for the next engineer)

The first LibreChat bring-up wrote a YAML without `allowAlways`, even though the environment variable was set. The cause was a stale `dist/` build: the harness scripts load `dist/`, and `npm test` does not rebuild it. Fix: `npm run build`, then restart LibreChat. The loader check was also run against the stale build, which is why it looked right at first. Always run `npm run build` (or `npm run check`) before a live run.

---

## 6. Dispatch run: the full stack with the new options on

The workflow is **P4 agent hosts** (`.github/workflows/p4-agent-hosts.yml`, `workflow_dispatch`). It has three inputs:

| Input | Default | This release's run |
|---|---|---|
| `tool_approval` | false | true |
| `allow_always` (new, needs `tool_approval`) | false | true |
| `second_identity` | false | true |

With `allow_always`, the job sets `LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1` and leaves `LIBRECHAT_TOOL_APPROVAL_ASK` empty (the same rule as section 1). Without it, the ask rule stays and the H3 check is unchanged except that its second-call flow must now pause (the control).

Trigger it from the GitHub UI: **Actions**, **P4 agent hosts**, **Run workflow**, choose branch `feat/2026-11-20-l3-allowalways-lab2`, tick the three inputs, **Run workflow**. Or from a terminal with GitHub CLI, if it is installed:

```bash
gh workflow run p4-agent-hosts.yml --ref feat/2026-11-20-l3-allowalways-lab2 -f tool_approval=true -f allow_always=true -f second_identity=true
gh run list --workflow p4-agent-hosts.yml --limit 1
```

Where to look in the run:

- Step **Live H3 check (tool_approval only)**: the PASS line of section 4, with the second call.
- Step **Live H2 check**, **Live H1 check**, **Live H6 check**: the existing second-identity checks, unchanged.
- The last step, **No harness containers left**, must pass.
- Artifacts `h2-live-check` and `ram-probe-full`.

Run result: see section 8.

---

## 7. lab2: what is built and what is not

- Built and unit tested: `librechatMcpServerFor("lab2")` returns `{ name: "lab2", url: "http://p4-attack-lab-2:9011/mcp", authEnv: null }`. Naming `lab2` in `LIBRECHAT_MCP_PRODUCTS` writes a second `mcpServers` entry and adds `p4-attack-lab-2` to `mcpSettings.allowedDomains`.
- Off by default: the default five-server YAML has no `lab` or `lab2` entry (unit tested).
- **Not built here:** the lab container itself. There is no lab compose file in this repo (the L2 attack-lab work is outside it), so nothing answers at `p4-attack-lab-2:9011`. The `lab` entry (H5) is in the same state.
- Port choice: 9011 is the next host port after `lab`'s 9010. The L2 plan (`docs/plans/2026-11-18-l2-attack-lab.md`) is not in this repo; check it when the lab lands and adjust the alias or port in one place (`librechatMcpServerFor`).
- **Not enabled in the dispatch run.** Naming `lab2` there would make LibreChat try to reach a host that does not exist. Enable it when the container is in the repo, with a live check that lists the tools of both lab servers.

---

## 8. Results

Filled in after the dispatch run (see the PR description for the run ID and links).

---

## 9. Not done, and why

- **lab2 live check:** no lab container in this repo (section 7).
- **Always allow for a second tool, or across conversations:** not tested. The live check covers one tool in one conversation, which is what the owner asked for.
- **Admin `allowAlwaysMaxTools`, `allowAlwaysMaxToolNameLength`, `grantLookupTimeoutMs`:** not exposed. The defaults (64 tools, 256 characters) apply. They can be added later as options with their own unit tests.
- **`agentModes`:** not exposed. It is marked in the v0.8.9 example as an opt-in after all replicas are upgraded; the harness runs one replica.
