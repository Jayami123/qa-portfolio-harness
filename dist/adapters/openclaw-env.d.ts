/** Pinned in docs/pins/p4.md. A dated release tag, never main (ADR 0007, D18). Slim variant. */
export declare const OPENCLAW_IMAGE = "ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:dcd5925b76a2f3b6ac55e173741223a7ab1fe6b3b1c53c419ee2e3d3cbdcf503";
export declare const OPENCLAW_COMPOSE_PROJECT = "qa-harness-openclaw";
/** Named volume for the state and the config (review answer 0.5). Fixed, so the adapter can write into it first. */
export declare const OPENCLAW_STATE_VOLUME = "qa-harness-openclaw-state";
/** Alias on qa-harness-p4 (review answer 0.1). */
export declare const OPENCLAW_NETWORK_ALIAS = "openclaw";
export declare const OPENCLAW_GATEWAY_PORT = 18789;
export declare const OPENCLAW_PRIMARY_MODEL = "p4-litellm/p4-stub";
/** H5: the primary model with OPENCLAW_NIGHTLY_MODEL=1 in nightly mode. The LiteLLM alias is `p4-nightly`. */
export declare const OPENCLAW_NIGHTLY_PRIMARY_MODEL = "p4-litellm/p4-nightly";
/** H1: the mock Telegram channel (docs/channels/telegram.md at 2026.10.33). The container joins qa-harness-p4, so the alias resolves. */
export declare const OPENCLAW_MOCK_CHANNEL_API_ROOT = "http://p4-mock-channel:8788";
/** H1: the fixed identities the suite's mock channel uses: the paired owner, a paired friend, and the allowed group (a negative chat id). */
export declare const OPENCLAW_MOCK_OWNER_ID = "1001";
export declare const OPENCLAW_MOCK_FRIEND_ID = "1002";
export declare const OPENCLAW_MOCK_GROUP_ID = "-100777";
/** H1: the extra env name, written to the env file only when the channel option is on. */
export declare const OPENCLAW_MOCK_TELEGRAM_TOKEN_ENV = "OPENCLAW_MOCK_TELEGRAM_TOKEN";
/** The env names the config substitutes. The adapter writes all of them, or startup warns (VERIFIED). */
export declare const OPENCLAW_ENV_NAMES: readonly ["OPENCLAW_GATEWAY_TOKEN", "P4_LITELLM_API_KEY", "OPENCLAW_CONFIG_PATH"];
/** Blank or unset is off. Exactly "1" is on. Anything else throws, without echoing the value. */
export declare function parseOpenClawResponsesFlag(raw: string | undefined): boolean;
/** H1: OPENCLAW_CHANNEL_MOCK. */
export declare function parseOpenClawChannelMockFlag(raw: string | undefined): boolean;
/** H4: OPENCLAW_LOOP_DETECTION. */
export declare function parseOpenClawLoopDetectionFlag(raw: string | undefined): boolean;
/** H4: OPENCLAW_WEB_FETCH_PRIVATE_NETWORK. */
export declare function parseOpenClawWebFetchPrivateNetworkFlag(raw: string | undefined): boolean;
/** H5: OPENCLAW_NIGHTLY_MODEL. */
export declare function parseOpenClawNightlyModelFlag(raw: string | undefined): boolean;
/**
 * H5: the nightly model is only reachable in nightly mode. In stub mode the flag throws, so a stub run can never be pointed
 * at the real model by accident (same stance as LibreChat's model list).
 */
export declare function resolveOpenClawNightlyModel(flag: boolean, mode: "stub" | "nightly"): boolean;
/**
 * H4: OPENCLAW_WEB_FETCH_ALLOWED_HOSTS. Comma-separated exact hostnames for tools.web.fetch.ssrfPolicy.allowedHostnames.
 * No scheme, port, path or wildcard. Blank is the empty list (off). Never echoes a bad entry.
 */
export declare function parseOpenClawWebFetchHosts(raw: string | undefined): string[];
/** H1: a per-run bot token in the Telegram shape (`<digits>:<35 url-safe characters>`). Kept in secrets.json, never printed. */
export declare function generateOpenClawMockChannelToken(randomBytes?: (n: number) => Buffer): string;
export declare function generateOpenClawGatewayToken(randomBytes?: (n: number) => Buffer): string;
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
export declare function openClawConfig(opts?: OpenClawConfigOptions): Record<string, unknown>;
/** The env file for compose and for the gateway. Mode 0600. It lives outside the state volume (OpenClaw reads ~/.openclaw/.env). */
export declare function openClawEnvText(values: {
    gatewayToken: string;
    liteLlmKey: string;
    mockChannelToken?: string;
}): string;
export declare function openClawComposeFiles(): string[];
/** A pin is a dated release tag. main and latest are refused (D18). */
export declare function assertOpenClawPinIsRelease(image: string): void;
//# sourceMappingURL=openclaw-env.d.ts.map