import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";

/** Pinned in docs/pins/p4.md. A dated release tag, never main (ADR 0007, D18). Slim variant. */
export const OPENCLAW_IMAGE =
  "ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503";
export const OPENCLAW_COMPOSE_PROJECT = "qa-harness-openclaw";
/** Named volume for the state and the config (review answer 0.5). Fixed, so the adapter can write into it first. */
export const OPENCLAW_STATE_VOLUME = "qa-harness-openclaw-state";
/** Alias on qa-harness-p4 (review answer 0.1). */
export const OPENCLAW_NETWORK_ALIAS = "openclaw";
export const OPENCLAW_GATEWAY_PORT = 18789;
export const OPENCLAW_PRIMARY_MODEL = "p4-litellm/p4-stub";
/** H5: the primary model with OPENCLAW_NIGHTLY_MODEL=1 in nightly mode. The LiteLLM alias is `p4-nightly`. */
export const OPENCLAW_NIGHTLY_PRIMARY_MODEL = "p4-litellm/p4-nightly";
/** H1: the mock Telegram channel (docs/channels/telegram.md at 2026.10.33). The container joins qa-harness-p4, so the alias resolves. */
export const OPENCLAW_MOCK_CHANNEL_API_ROOT = "http://p4-mock-channel:8788";
/** H1: the fixed identities the suite's mock channel uses: the paired owner, a paired friend, and the allowed group (a negative chat id). */
export const OPENCLAW_MOCK_OWNER_ID = "1001";
export const OPENCLAW_MOCK_FRIEND_ID = "1002";
export const OPENCLAW_MOCK_GROUP_ID = "-100777";
/** H1: the extra env name, written to the env file only when the channel option is on. */
export const OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV = "OPENCLAW_MOCK_TELEGRAM_TOKEN";
/** The env names the config substitutes. The adapter writes all of them, or startup warns (VERIFIED). */
export const OPENCLAW_ENV_NAMES = ["OPENCLAW_GATEWAY_TOKEN", "P4_LITELLM_API_KEY", "OPENCLAW_CONFIG_PATH"] as const;

/** Blank or unset is off. Exactly "1" is on. Anything else throws, without echoing the value. */
export function parseOpenClawResponsesFlag(raw: string | undefined): boolean {
  const value = (raw ?? "").trim();
  if (value === "") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error('OPENCLAW_RESPONSES_API_INVALID: the value must be exactly "1" or unset (the value is not printed).');
}

/** Shared by the H1, H4 and H5 flags: blank is off, exactly "1" is on, anything else throws and never echoes the value. */
function parseOneFlag(raw: string | undefined, name: string): boolean {
  const value = (raw ?? "").trim();
  if (value === "") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error(`${name}_INVALID: the value must be exactly "1" or unset (the value is not printed).`);
}

/** H1: OPENCLAW_CHANNEL_MOCK. */
export function parseOpenClawChannelMockFlag(raw: string | undefined): boolean {
  return parseOneFlag(raw, "OPENCLAW_CHANNEL_MOCK");
}

/** H4: OPENCLAW_LOOP_DETECTION. */
export function parseOpenClawLoopDetectionFlag(raw: string | undefined): boolean {
  return parseOneFlag(raw, "OPENCLAW_LOOP_DETECTION");
}

/** H4: OPENCLAW_WEB_FETCH_PRIVATE_NETWORK. */
export function parseOpenClawWebFetchPrivateNetworkFlag(raw: string | undefined): boolean {
  return parseOneFlag(raw, "OPENCLAW_WEB_FETCH_PRIVATE_NETWORK");
}

/** H5: OPENCLAW_NIGHTLY_MODEL. */
export function parseOpenClawNightlyModelFlag(raw: string | undefined): boolean {
  return parseOneFlag(raw, "OPENCLAW_NIGHTLY_MODEL");
}

/**
 * H5: the nightly model is only reachable in nightly mode. In stub mode the flag throws, so a stub run can never be pointed
 * at the real model by accident (same stance as LibreChat's model list).
 */
export function resolveOpenClawNightlyModel(flag: boolean, mode: "stub" | "nightly"): boolean {
  if (flag && mode !== "nightly") {
    throw new Error("OPENCLAW_NIGHTLY_MODEL_NEEDS_NIGHTLY: OPENCLAW_NIGHTLY_MODEL=1 needs P4_LLM_MODE=nightly.");
  }
  return flag;
}

/**
 * H4: OPENCLAW_WEB_FETCH_ALLOWED_HOSTS. Comma-separated exact hostnames for tools.web.fetch.ssrfPolicy.allowedHostnames.
 * No scheme, port, path or wildcard. Blank is the empty list (off). Never echoes a bad entry.
 */
export function parseOpenClawWebFetchHosts(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const host = part.trim().toLowerCase();
    if (host === "") {
      continue;
    }
    if (host.length > 253 || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) {
      throw new Error("OPENCLAW_WEB_FETCH_HOSTS_INVALID: each entry must be an exact hostname (no scheme, port, path or wildcard; the entry is not printed).");
    }
    if (!out.includes(host)) {
      out.push(host);
    }
  }
  return out;
}

/** H1: a per-run bot token in the Telegram shape (`<digits>:<35 url-safe characters>`). Kept in secrets.json, never printed. */
export function generateOpenClawMockChannelToken(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return `7770001:${randomBytes(26).toString("base64url")}`;
}

export function generateOpenClawGatewayToken(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The gateway config. It holds placeholders only, so it is safe to keep unencrypted in the volume (review answer 0.5).
 * `${VAR}` resolves from the environment (VERIFIED: a SecretRef on env OPENCLAW_GATEWAY_TOKEN and the provider key).
 * `bind: lan` makes the gateway listen on all interfaces inside its container. The host publish stays on 127.0.0.1.
 * Token auth stays on. Approvals are on (D19). No channel is enabled in B1 (review answer 0.3).
 */
export interface OpenClawConfigOptions {
  responsesApi?: boolean;
  /** H1: write channels.telegram for the suite's mock channel, and commands.ownerAllowFrom. */
  channelMock?: boolean;
  /** H4: tools.loopDetection.enabled true (upstream default is off). */
  loopDetection?: boolean;
  /** H4: tools.web.fetch.ssrfPolicy.allowedHostnames (exact hosts). Empty or unset writes nothing. */
  webFetchAllowedHosts?: string[];
  /** H4: tools.web.fetch.ssrfPolicy.dangerouslyAllowPrivateNetwork true. */
  webFetchPrivateNetwork?: boolean;
  /** H5: primary model p4-litellm/p4-nightly. The caller has already checked the mode (resolveOpenClawNightlyModel). */
  nightlyModel?: boolean;
}

/** H4: the tools.web block. Absent unless an option asks for it. */
function webFetchBlock(opts: OpenClawConfigOptions): Record<string, unknown> {
  const hosts = opts.webFetchAllowedHosts ?? [];
  const policy: Record<string, unknown> = {};
  if (hosts.length > 0) {
    policy.allowedHostnames = hosts;
  }
  if (opts.webFetchPrivateNetwork === true) {
    policy.dangerouslyAllowPrivateNetwork = true;
  }
  return Object.keys(policy).length === 0 ? {} : { web: { fetch: { ssrfPolicy: policy } } };
}

/** H1: the mock Telegram channel. The token is a ${VAR} placeholder, never a value. */
function mockTelegramChannel(): Record<string, unknown> {
  return {
    telegram: {
      enabled: true,
      botToken: "${" + OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV + "}",
      apiRoot: OPENCLAW_MOCK_CHANNEL_API_ROOT,
      dmPolicy: "pairing",
      allowFrom: [OPENCLAW_MOCK_OWNER_ID],
      groupPolicy: "allowlist",
      // Numeric user ids only. The group is allowed through `groups`, not here (docs/channels/telegram/access-control.md).
      groupAllowFrom: [OPENCLAW_MOCK_OWNER_ID],
      groups: { [OPENCLAW_MOCK_GROUP_ID]: {} },
    },
  };
}

export function openClawConfig(opts: OpenClawConfigOptions = {}): Record<string, unknown> {
  const nightly = opts.nightlyModel === true;
  return {
    gateway: {
      mode: "local",
      bind: "lan",
      port: OPENCLAW_GATEWAY_PORT,
      auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
      // Opt-in headless run endpoint (docs/gateway/openresponses-http-api.md at 2026.10.33). Off by default upstream.
      ...(opts.responsesApi === true ? { http: { endpoints: { responses: { enabled: true } } } } : {}),
    },
    tools: {
      exec: { ask: "always", security: "allowlist" },
      // With the headless run on, offer the client tools as direct schemas. Tool Search is on by default for embedded runs and
      // defers schemas behind tool_search / dispatch_action; "Set tools.toolSearch: false to restore direct schemas"
      // (docs/tools/tool-search.md at 2026.10.33). Unset keeps the upstream default, so the default config is unchanged.
      ...(opts.responsesApi === true ? { toolSearch: false } : {}),
      ...(opts.loopDetection === true ? { loopDetection: { enabled: true } } : {}),
      ...webFetchBlock(opts),
    },
    approvals: { exec: { enabled: true, mode: "session" } },
    agents: { defaults: { model: { primary: nightly ? OPENCLAW_NIGHTLY_PRIMARY_MODEL : OPENCLAW_PRIMARY_MODEL } } },
    models: {
      mode: "merge",
      providers: {
        "p4-litellm": {
          baseUrl: "http://litellm:4000/v1",
          apiKey: "${P4_LITELLM_API_KEY}",
          api: "openai-completions",
          models: [
            { id: "p4-stub", name: "p4-stub" },
            ...(nightly ? [{ id: "p4-nightly", name: "p4-nightly" }] : []),
          ],
        },
      },
    },
    channels: opts.channelMock === true ? mockTelegramChannel() : {},
    // The owner allowlist is written only with the mock channel (docs/gateway/config-channels/commands.md).
    ...(opts.channelMock === true ? { commands: { ownerAllowFrom: [`telegram:${OPENCLAW_MOCK_OWNER_ID}`] } } : {}),
  };
}

/** The env file for compose and for the gateway. Mode 0600. It lives outside the state volume (OpenClaw reads ~/.openclaw/.env). */
export function openClawEnvText(values: { gatewayToken: string; liteLlmKey: string; mockChannelToken?: string }): string {
  return [
    `OPENCLAW_GATEWAY_TOKEN=${values.gatewayToken}`,
    `P4_LITELLM_API_KEY=${values.liteLlmKey}`,
    `OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json`,
    ...(values.mockChannelToken === undefined ? [] : [`${OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV}=${values.mockChannelToken}`]),
    "",
  ].join("\n");
}

export function openClawComposeFiles(): string[] {
  return [harnessComposeFile("openclaw.compose.yml")];
}

/** A pin is a dated release tag. main and latest are refused (D18). */
export function assertOpenClawPinIsRelease(image: string): void {
  if (/:(main|latest)/.test(image) || !/:\d{4}\.\d{1,2}\.\d{1,3}/.test(image)) {
    throw new Error("OPENCLAW_PIN_NOT_RELEASE: the pin must be a dated release tag");
  }
}
