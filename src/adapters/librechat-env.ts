import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";
import { LITELLM_ALIASES, LITELLM_NIGHTLY_ALIAS, LITELLM_STUB_ALIAS, type P4LlmMode } from "./litellm-env.js";
import { toolApprovalYamlLines, type LibreChatToolApproval } from "./librechat-approval.js";
import { mcpOauthYamlLines, oauthAllowedHosts } from "./librechat-oauth.js";

/** Pinned in docs/pins/p4.md. v0.8.9 is the newest stable tag (tag date 2026-11-17; checked by git tag and by pulling the tag, 2026-11-19). */
export const LIBRECHAT_IMAGE =
  "ghcr.io/librechat-ai/librechat:v0.8.9@sha256:4a3967a47031c1fdba8302a6a341be7671101e40b617f7934ba25aac69fcea2b";
/** Pinned MongoDB, the database LibreChat needs. Not published to the host (review answer 0.1). */
export const LIBRECHAT_MONGO_IMAGE = "mongo:8@sha256:05b334b0a7a78fe913caac0cd2e1ecccf4da515d9a3a44be911b6ea3734c17cd";
export const LIBRECHAT_COMPOSE_PROJECT = "qa-harness-librechat";
/** Alias on qa-harness-p4 (review answer 0.1). */
export const LIBRECHAT_NETWORK_ALIAS = "librechat";
/** The config version of v0.8.9 (VERIFIED in the v0.8.9 source: packages/data-provider/src/config.ts, CONFIG_VERSION = '1.3.19'). */
export const LIBRECHAT_CONFIG_VERSION = "1.3.19";
/** The Mongo service name on the project's default network. */
export const LIBRECHAT_MONGO_HOST = "mongodb";
export const LIBRECHAT_MONGO_USER = "librechat";
export const LIBRECHAT_OWNER_EMAIL = "qa-owner@p4.test";
export const LIBRECHAT_OWNER_USERNAME = "qa-owner";
export const LIBRECHAT_OWNER_NAME = "QA Owner";
/** The LiteLLM alias URL that LibreChat's custom endpoint uses (review answer 0.1). */
export const LIBRECHAT_LITELLM_BASE_URL = "http://litellm:4000/v1";

export interface LibreChatMcpServer {
  /** The name in mcpServers. Used by the proof routes. */
  name: string;
  /** The alias URL on qa-harness-p4 (review answer 0.1). Never a 127.0.0.1 address. */
  url: string;
  /** Env var that holds the Authorization header value. null means no header (Penpot single-user). */
  authEnv: string | null;
  /** H4: set only with LIBRECHAT_MCP_OAUTH=1 for an OAuth product. Absent means static auth (the default). */
  oauth?: { authorizationUrl: string; tokenUrl: string; clientId: string; redirectUri: string; scope: string };
}

/**
 * The Part A MCP endpoints, reached by alias on qa-harness-p4. The table is the only source of URLs for LibreChat.
 * Ports are the container ports (review answer 0.1).
 */
export function librechatMcpServerFor(product: string): LibreChatMcpServer {
  switch (product) {
    case "nextcloud":
      return { name: "nextcloud", url: "http://nextcloud-mcp:8000/mcp", authEnv: "P4_NEXTCLOUD_MCP_AUTHORIZATION" };
    case "outline":
      return { name: "outline", url: "http://outline:3000/mcp", authEnv: "P4_OUTLINE_MCP_AUTHORIZATION" };
    case "twenty":
      return { name: "twenty", url: "http://twenty-server:3000/mcp", authEnv: "P4_TWENTY_MCP_AUTHORIZATION" };
    case "penpot":
      return { name: "penpot", url: "http://penpot-mcp:4401/mcp", authEnv: null };
    case "mattermost":
      return { name: "mattermost", url: "http://mattermost-mcp:8066/mcp", authEnv: "P4_MATTERMOST_MCP_AUTHORIZATION" };
    case "lab":
      // The attack lab (L2 plan). Its alias on qa-harness-p4 and container port 9010. It takes no credential.
      return { name: "lab", url: "http://p4-attack-lab:9010/mcp", authEnv: null };
    case "lab2":
      // A second attack-lab instance, for cases that need two lab servers at once (cross-server shadowing). Opt-in: used only
      // when LIBRECHAT_MCP_PRODUCTS names lab2. Its own alias and container port 9011 (the next host port after lab's 9010).
      // It takes no credential. No lab2 container is in this repo; the entry is unit-tested only.
      return { name: "lab2", url: "http://p4-attack-lab-2:9011/mcp", authEnv: null };
    default:
      throw new Error(`LIBRECHAT_MCP_UNKNOWN: no MCP server is defined for "${product}"`);
  }
}

/** Hostnames that mcpSettings.allowedDomains must list: each server's host, plus the LiteLLM alias. */
export function allowedDomainsFor(servers: LibreChatMcpServer[]): string[] {
  const hosts = servers.map((s) => new URL(s.url).hostname);
  hosts.push(new URL(LIBRECHAT_LITELLM_BASE_URL).hostname);
  // H4: the browser authorize host of an OAuth server (LibreChat validates every pinned OAuth URL against this list).
  hosts.push(...oauthAllowedHosts(servers));
  return [...new Set(hosts)];
}

/**
 * The model aliases LibreChat lists, in order; the first is the default. Blank means [p4-stub], plus p4-nightly in nightly
 * mode. An explicit list may only name the two LiteLLM aliases, and p4-nightly only in nightly mode. LibreChat talks to
 * LiteLLM only, so the Gemma key never reaches it.
 */
export function resolveLibreChatModels(raw: string | undefined, mode: P4LlmMode): string[] {
  const listed = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const models = listed.length > 0 ? [...new Set(listed)] : mode === "nightly" ? [LITELLM_STUB_ALIAS, LITELLM_NIGHTLY_ALIAS] : [LITELLM_STUB_ALIAS];
  for (const m of models) {
    if (!(LITELLM_ALIASES as readonly string[]).includes(m)) {
      throw new Error(`LIBRECHAT_MODEL_UNKNOWN: "${m}" is not a LiteLLM alias (expected ${LITELLM_ALIASES.join(" or ")})`);
    }
    if (m === LITELLM_NIGHTLY_ALIAS && mode !== "nightly") {
      throw new Error(`LIBRECHAT_MODEL_NOT_ALLOWED: ${LITELLM_NIGHTLY_ALIAS} needs P4_LLM_MODE=nightly`);
    }
  }
  return models;
}

/**
 * Builds librechat.yaml. No secret value appears: Authorization values are ${VAR} placeholders read from the env
 * file (D16). The file is safe to keep at mode 0644.
 */
export function librechatYaml(opts: { models: string[]; servers: LibreChatMcpServer[]; toolApproval?: LibreChatToolApproval | null }): string {
  const lines: string[] = [`version: ${LIBRECHAT_CONFIG_VERSION}`, "cache: true", "mcpSettings:", "  allowedDomains:"];
  for (const host of allowedDomainsFor(opts.servers)) {
    lines.push(`    - "${host}"`);
  }
  lines.push("mcpServers:");
  for (const s of opts.servers) {
    // requiresOAuth: false skips LibreChat's OAuth auto-detection, which probes without the configured headers and marks a
    // server that publishes RFC 9728 metadata (or answers 401 with a Bearer challenge) as OAuth-only, so it never connects
    // with the Authorization header. Schema: packages/data-provider/src/mcp.ts:190; skip: MCPServerInspector.ts:122.
    // H4 (LIBRECHAT_MCP_OAUTH=1) writes requiresOAuth: true for an OAuth product only; every other server is unchanged.
    lines.push(
      `  ${s.name}:`,
      "    type: streamable-http",
      `    url: ${s.url}`,
      `    requiresOAuth: ${s.oauth !== undefined ? "true" : "false"}`,
      "    initTimeout: 30000",
      "    timeout: 60000",
    );
    if (s.authEnv !== null) {
      lines.push("    headers:", `      Authorization: "\${${s.authEnv}}"`);
    }
    lines.push(...mcpOauthYamlLines(s));
  }
  lines.push(
    "endpoints:",
    ...(opts.toolApproval ? toolApprovalYamlLines(opts.toolApproval) : []),
    "  custom:",
    '    - name: "P4 LiteLLM"',
    '      apiKey: "${P4_LITELLM_API_KEY}"',
    `      baseURL: "${LIBRECHAT_LITELLM_BASE_URL}"`,
    "      models:",
    `        default: [${opts.models.map((m) => `"${m}"`).join(", ")}]`,
    "        fetch: false",
    "      titleConvo: false",
    "",
  );
  return lines.join("\n");
}

/** The compose env file, one NAME=value per line. Written mode 0600 by the adapter. Values are never printed. */
export function librechatEnvText(values: Record<string, string>): string {
  if (Object.keys(values).some((k) => /^GEMINI_/i.test(k))) {
    throw new Error("LIBRECHAT_ENV_GEMINI_REFUSED: LibreChat talks to LiteLLM only and never receives the Gemini key");
  }
  return `${Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
}

export function librechatComposeFiles(): string[] {
  return [harnessComposeFile("librechat.compose.yml")];
}

/** Per-run secrets. Hex lengths match LibreChat's CREDS_KEY (32 bytes) and CREDS_IV (16 bytes). */
export function librechatSecretValues(randomBytes: (n: number) => Buffer = crypto.randomBytes) {
  return {
    mongoPassword: randomBytes(24).toString("base64url"),
    jwtSecret: randomBytes(32).toString("base64url"),
    jwtRefreshSecret: randomBytes(32).toString("base64url"),
    credsKey: randomBytes(32).toString("hex"),
    credsIv: randomBytes(16).toString("hex"),
    ownerPassword: randomBytes(24).toString("base64url"),
  };
}

export type LibreChatSecrets = ReturnType<typeof librechatSecretValues>;
