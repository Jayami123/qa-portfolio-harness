# 0007. Add LiteLLM, LibreChat and OpenClaw as image-only P4 agent hosts

- Status: Accepted (plan review answers 2026-11-18; the build follows `docs/plans/2026-11-18-harness-p4-agent-hosts.md`)
- Date: 2026-11-18

## Context

Part B1 of P4 Lane 1 needs three agent hosts the suite can start like the Part A products: a chat host (LibreChat), a
personal agent (OpenClaw) and one OpenAI-compatible proxy (LiteLLM) that logs which model answered. ADR 0006 sets the
architecture: `productRoot = .harness/<product>` (D1), run state (D7), digest pins, and loopback host ports. This ADR
records what is new: a shared external network with aliases, the proxy's aliases and MCP use, the OpenClaw config path,
the CI shape, and the licences.

## Decision

1. **Same architecture as ADR 0006.** Three adapters extend `BaseAdapter`. Pure helpers sit beside them, each with a unit
   test. `productRoot = .harness/<product>` for each. `loadConfig()` is unchanged.
2. **Official images, pinned by digest, no fork.** LiteLLM `v1.110.0`, LibreChat `v0.8.7`, OpenClaw `2026.10.33-slim`
   (a dated release tag, never `main`) and MongoDB 8 for LibreChat. All are in `docs/pins/p4.md`.
3. **One external network, `qa-harness-p4`, for agent hosts and MCP services (no host networking).** Each MCP-facing
   service and each agent host joins it under a unique alias: `nextcloud-mcp`, `outline`, `twenty-server`, `penpot-mcp`,
   `mattermost-mcp`, `litellm`, `librechat`, `openclaw`. Each project keeps its default network for intra-stack DNS. Host
   ports stay on `127.0.0.1`. Inside a container a service listens on `0.0.0.0`, since a `127.0.0.1` listener is not
   reachable through a port publish (verified in the spike). MongoDB is not published to the host.
4. **LiteLLM: two aliases, no fallbacks, stub by default (D14).** `p4-stub` answers from config-level `mock_response`, so no
   route stub or fixture server exists in B1 (verified on v1.110.0). `p4-nightly` names `gemini/gemma-4-31b-it`. The Gemini
   key reaches the container only in nightly mode, and readiness never sends `p4-nightly`.
5. **LiteLLM MCP is not used (D15).** No documented key turns off `/mcp` in v1.110.0. `LITELLM_ENABLE_ADMIN_MCP` covers only
   enterprise `/admin/mcp`, so it stays unset or `false`. No MCP server is granted, and readiness asserts that `tools/list`
   is empty. `litellm_enterprise` is in the image and is not used.
6. **LibreChat MCP is attached by alias, through a generated `librechat.yaml` with placeholders only (D16).**
   `mcpSettings.allowedDomains` lists the aliases, because LibreChat refuses other hosts. The Authorization values come from
   the Part A run states into a 0600 env file. The fake owner is created with `create-user --email-verified=true`, and
   `ALLOW_REGISTRATION` stays `false`. Proof: `GET /api/mcp/connection/status` reports each server `connected`, and
   `GET /api/mcp/tools` lists at least one tool per server (verified in the spike with the Penpot MCP: five tools).
7. **OpenClaw uses `${VAR}` placeholders, with the config written into its state volume (D17, revised).** The gateway token
   and the LiteLLM key resolve from a 0600 env file under `.harness/openclaw/`, which is outside the state volume because
   OpenClaw reads `~/.openclaw/.env`. The config has no secret, so it needs no 0600. A one-off container running as uid 1000
   with no network writes it into the volume. No root helper is used. The gateway binds `lan` inside its container, with
   token auth on. Approvals are on: `tools.exec.ask: always`, `security: allowlist`, `approvals.exec.enabled: true`.
   No channel is enabled. `channels.qa-channel` is UNVERIFIED and is decided later.
8. **CI: the full set first, in one advisory job.** The job records `df` before and after start, and `diskFreeGiB`
   (owner-reported 88 GiB free in Part A run 44242421839, not re-read here). The three-stack split is a documented fallback
   only, recorded in `0008-p4-stack-split.md` if it is adopted after a measured failure.

## Alternatives considered

- **Host networking on Linux.** Rejected after the review: it gives the agents the host's network namespace, and it is not
  portable to Docker Desktop. The shared network with aliases needs no host network.
- **A route stub listener for `p4-stub`.** Rejected: `mock_response` in the generated config proves the same route with no
  extra process. The suite's fixture server replaces it in part B2 by switching `p4-stub` to `api_base`.
- **A root helper container to write the OpenClaw config.** Last resort, not used: the placeholder config is written as
  uid 1000 with no network.
- **LiteLLM virtual keys with a database.** Rejected for B1: the master key is enough, and a database adds a service.
- **A three-stack CI split first.** Deferred to the fallback: the measured disk and memory figures fit a single job.

## Consequences

- Linux only for the agent-host stack, since it relies on Docker's container networking and on `ss` in CI.
- The Twenty overlay changes only by joining the network under the `twenty-server` alias. Its publishes and defaults are unchanged.
- Images to pull, from `docker images` in the session: LiteLLM 1.9 GB, LibreChat 3.83 GB, MongoDB 1.16 GB, OpenClaw slim
  2.98 GB (about 9.9 GB together). The full set was estimated at about 19 GB with Part A's images (INFERRED).
- Licences: LiteLLM core MIT (read from the image); `litellm_enterprise` in the image is not used; LibreChat MIT (read from
  the image); OpenClaw MIT (image label); MongoDB SSPL, accepted for local QA only (review answer 0.10). The upstream release
  notes were not readable in the session (UNVERIFIED).
- A `docker inspect` shows container environment. Acceptable on a throwaway loopback stack, as ADR 0006 R14 records.
