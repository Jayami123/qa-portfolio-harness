import { type P4LlmMode } from "./litellm-env.js";
import { type LibreChatToolApproval } from "./librechat-approval.js";
/** Pinned in docs/pins/p4.md. v0.8.9 is the newest stable tag (tag date 2026-11-17; checked by git tag and by pulling the tag, 2026-11-19). */
export declare const LIBRECHAT_IMAGE = "ghcr.io/librechat-ai/librechat:v0.8.9@sha256:4a3967a47031c1fdba8302a6a341be7671101e40b617f7934ba25aac69fcea2b";
/** Pinned MongoDB, the database LibreChat needs. Not published to the host (review answer 0.1). */
export declare const LIBRECHAT_MONGO_IMAGE = "mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd";
export declare const LIBRECHAT_COMPOSE_PROJECT = "qa-harness-librechat";
/** Alias on qa-harness-p4 (review answer 0.1). */
export declare const LIBRECHAT_NETWORK_ALIAS = "librechat";
/** The config version of v0.8.9 (VERIFIED in the v0.8.9 source: packages/data-provider/src/config.ts, CONFIG_VERSION = '1.3.19'). */
export declare const LIBRECHAT_CONFIG_VERSION = "1.3.19";
/** The Mongo service name on the project's default network. */
export declare const LIBRECHAT_MONGO_HOST = "mongodb";
export declare const LIBRECHAT_MONGO_USER = "librechat";
export declare const LIBRECHAT_OWNER_EMAIL = "qa-owner@p4.test";
export declare const LIBRECHAT_OWNER_USERNAME = "qa-owner";
export declare const LIBRECHAT_OWNER_NAME = "QA Owner";
/** The LiteLLM alias URL that LibreChat's custom endpoint uses (review answer 0.1). */
export declare const LIBRECHAT_LITELLM_BASE_URL = "http://litellm:4000/v1";
export interface LibreChatMcpServer {
    /** The name in mcpServers. Used by the proof routes. */
    name: string;
    /** The alias URL on qa-harness-p4 (review answer 0.1). Never a 127.0.0.1 address. */
    url: string;
    /** Env var that holds the Authorization header value. null means no header (Penpot single-user). */
    authEnv: string | null;
    /** H4: set only with LIBRECHAT_MCP_OAUTH=1 for an OAuth product. Absent means static auth (the default). */
    oauth?: {
        authorizationUrl: string;
        tokenUrl: string;
        clientId: string;
        redirectUri: string;
        scope: string;
    };
}
/**
 * The Part A MCP endpoints, reached by alias on qa-harness-p4. The table is the only source of URLs for LibreChat.
 * Ports are the container ports (review answer 0.1).
 */
export declare function librechatMcpServerFor(product: string): LibreChatMcpServer;
/** Hostnames that mcpSettings.allowedDomains must list: each server's host, plus the LiteLLM alias. */
export declare function allowedDomainsFor(servers: LibreChatMcpServer[]): string[];
/**
 * The model aliases LibreChat lists, in order; the first is the default. Blank means [p4-stub], plus p4-nightly in nightly
 * mode. An explicit list may only name the two LiteLLM aliases, and p4-nightly only in nightly mode. LibreChat talks to
 * LiteLLM only, so the Gemma key never reaches it.
 */
export declare function resolveLibreChatModels(raw: string | undefined, mode: P4LlmMode): string[];
/**
 * Builds librechat.yaml. No secret value appears: Authorization values are ${VAR} placeholders read from the env
 * file (D16). The file is safe to keep at mode 0644.
 */
export declare function librechatYaml(opts: {
    models: string[];
    servers: LibreChatMcpServer[];
    toolApproval?: LibreChatToolApproval | null;
}): string;
/** The compose env file, one NAME=value per line. Written mode 0600 by the adapter. Values are never printed. */
export declare function librechatEnvText(values: Record<string, string>): string;
/**
 * The compose files for LibreChat. With recording on (H9), the override file adds the mcp-recorder service and makes the
 * app wait for it. With recording off the list is exactly the one file it was before H9.
 */
export declare function librechatComposeFiles(recording?: boolean): string[];
/** Per-run secrets. Hex lengths match LibreChat's CREDS_KEY (32 bytes) and CREDS_IV (16 bytes). */
export declare function librechatSecretValues(randomBytes?: (n: number) => Buffer): {
    mongoPassword: string;
    jwtSecret: string;
    jwtRefreshSecret: string;
    credsKey: string;
    credsIv: string;
    ownerPassword: string;
};
export type LibreChatSecrets = ReturnType<typeof librechatSecretValues>;
//# sourceMappingURL=librechat-env.d.ts.map