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

export function generateOpenClawGatewayToken(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The gateway config. It holds placeholders only, so it is safe to keep unencrypted in the volume (review answer 0.5).
 * `${VAR}` resolves from the environment (VERIFIED: a SecretRef on env OPENCLAW_GATEWAY_TOKEN and the provider key).
 * `bind: lan` makes the gateway listen on all interfaces inside its container. The host publish stays on 127.0.0.1.
 * Token auth stays on. Approvals are on (D19). No channel is enabled in B1 (review answer 0.3).
 */
export function openClawConfig(opts: { responsesApi?: boolean } = {}): Record<string, unknown> {
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
    },
    approvals: { exec: { enabled: true, mode: "session" } },
    agents: { defaults: { model: { primary: OPENCLAW_PRIMARY_MODEL } } },
    models: {
      mode: "merge",
      providers: {
        "p4-litellm": {
          baseUrl: "http://litellm:4000/v1",
          apiKey: "${P4_LITELLM_API_KEY}",
          api: "openai-completions",
          models: [{ id: "p4-stub", name: "p4-stub" }],
        },
      },
    },
    channels: {},
  };
}

/** The env file for compose and for the gateway. Mode 0600. It lives outside the state volume (OpenClaw reads ~/.openclaw/.env). */
export function openClawEnvText(values: { gatewayToken: string; liteLlmKey: string }): string {
  return [
    `OPENCLAW_GATEWAY_TOKEN=${values.gatewayToken}`,
    `P4_LITELLM_API_KEY=${values.liteLlmKey}`,
    `OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json`,
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
