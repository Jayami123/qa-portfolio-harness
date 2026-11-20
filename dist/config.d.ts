import { type LibreChatToolApproval } from "./adapters/librechat-approval.js";
import { type LibreChatMcpOauth } from "./adapters/librechat-oauth.js";
import { type ProductId } from "./types.js";
/** Inbucket REST mailbox base for Documenso e-mail checks. Must match the host port in docker/documenso.compose.yml (9003). */
export declare const documensoMailApiUrl = "http://127.0.0.1:9003/api/v1/mailbox";
/** Mailpit REST API base for Twenty e-mail checks. Must match the host port of the mailpit service in docker/twenty.compose.yml (8025). */
export declare const twentyMailApiUrl = "http://127.0.0.1:8025/api/v1";
/** Mailpit REST API base for the Cal catcher that `up cal` starts. Must match the host UI port in docker/cal.mail.compose.yml (8026). */
export declare const calMailApiUrl = "http://127.0.0.1:8026/api/v1";
/** Thrown when PRODUCTS_ROOT is unset or blank and the default resolves inside node_modules. */
export declare const PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES = "PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES";
/**
 * Set: path.resolve(raw), as before (relative to the current directory).
 * Unset or blank: path.resolve(cwd, "..", "products"). If any path segment of that result is exactly
 * "node_modules", throw `${PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES}: ...`. Only the default is checked.
 */
export declare function resolveProductsRoot(raw: string | undefined, cwd: string): string;
export interface ProductConfig {
    id: ProductId;
    productRoot: string;
    baseUrl: string;
    dbUrl: string;
}
export interface CalConfig extends ProductConfig {
    id: "cal";
    apiBaseUrl: string;
    webhookSecret?: string;
    apiKey?: string;
}
export interface DocumensoConfig extends ProductConfig {
    id: "documenso";
    apiToken?: string;
    /** Browser / passkey origin. Unset keeps NEXT_PUBLIC_WEBAPP_URL on baseUrl. */
    publicUrl?: string;
}
export interface MedusaConfig extends ProductConfig {
    id: "medusa";
    storefrontUrl: string;
    adminEmail?: string;
    adminPassword?: string;
    publishableApiKey?: string;
    stripeApiKey?: string;
    stripeWebhookSecret?: string;
    stripePublishableKey?: string;
    /** Second backend base URL, validated against the primary. Undefined when MEDUSA_SECOND_BASE_URL is unset. */
    secondBaseUrl?: string;
}
export interface TwentyConfig extends ProductConfig {
    id: "twenty";
    email: string;
    password: string;
    apiKey?: string;
    imageTag: string;
    /** H2: a second workspace member (the seeder's shared password), its key in twenty-b-run.json. Off unless P4_SECOND_IDENTITY=1. */
    secondIdentity: boolean;
}
/** P4 products. productRoot is .harness/<product> (ADR 0006, D1); no fork is read. */
export interface NextcloudConfig extends ProductConfig {
    id: "nextcloud";
    mcpUrl: string;
    /** H2: a second user, its app password in nextcloud-b-run.json. Off unless P4_SECOND_IDENTITY=1. */
    secondIdentity: boolean;
    /** H1: GreenMail and the Mail app accounts for each identity. Off unless P4_MAIL=1. */
    mail: boolean;
}
export interface OutlineConfig extends ProductConfig {
    id: "outline";
    /** Outline's built-in MCP lives on the app origin at /mcp (ADR 0006). */
    mcpUrl: string;
    /** H2: a second user with its own API key, in outline-b-run.json. Off unless P4_SECOND_IDENTITY=1. */
    secondIdentity: boolean;
}
export interface PenpotConfig extends ProductConfig {
    id: "penpot";
    mcpUrl: string;
    /** H2: a second profile, logged in over RPC. The MCP is single-user and takes no credential. Off unless P4_SECOND_IDENTITY=1. */
    secondIdentity: boolean;
    /** H6: P4_PENPOT_PLUGIN=1 runs the MCP in multi-user mode and keeps a browser tab per profile with the plugin running. Off by default. */
    perUserPlugin: boolean;
}
export interface MattermostConfig extends ProductConfig {
    id: "mattermost";
    mcpUrl: string;
    /** H2: a second member account with its own PAT, in mattermost-b-run.json. Off unless P4_SECOND_IDENTITY=1. */
    secondIdentity: boolean;
    /** H7: the second identity posts in town-square. Off unless P4_SECOND_POSTS=1 (which needs secondIdentity). */
    secondPosts: boolean;
}
/** LiteLLM proxy (ADR 0007). No database in B1. The stub alias is config-level mock_response (review answer 0.9). */
export interface LiteLlmConfig extends ProductConfig {
    id: "litellm";
    mode: "stub" | "nightly";
    /** Validated P4_STUB_API_BASE. undefined keeps the p4-stub mock_response. */
    stubApiBase: string | undefined;
}
/** LibreChat chat host. mcpProducts are Part A product ids whose MCP credentials go into its env (review answer 0.1). */
export interface LibreChatConfig extends ProductConfig {
    id: "librechat";
    mcpProducts: string[];
    /** Model aliases LibreChat lists, in order. The first is the default. Never includes p4-nightly in stub mode. */
    models: string[];
    /** H3: the endpoints.agents.toolApproval policy, or null (off, the default). */
    toolApproval: LibreChatToolApproval | null;
    /** H4: OAuth sign-in for the capable products, or null (off, the default). Set only with LIBRECHAT_MCP_OAUTH=1. */
    mcpOauth: LibreChatMcpOauth | null;
    /** H9: true routes each MCP server through the recording proxy (LIBRECHAT_MCP_RECORDING=1). Off by default. */
    mcpRecording: boolean;
}
export interface OpenClawConfig extends ProductConfig {
    id: "openclaw";
    /** OPENCLAW_RESPONSES_API=1: the gateway serves POST /v1/responses (headless agent run). */
    responsesApi: boolean;
    /** OPENCLAW_CHANNEL_MOCK=1 (H1): the config enables the mock Telegram channel. */
    channelMock: boolean;
    /** OPENCLAW_LOOP_DETECTION=1 (H4). */
    loopDetection: boolean;
    /** OPENCLAW_WEB_FETCH_ALLOWED_HOSTS (H4): exact hostnames web_fetch may reach on a private network. Empty is off. */
    webFetchAllowedHosts: string[];
    /** OPENCLAW_WEB_FETCH_PRIVATE_NETWORK=1 (H4): the broad opt-in. */
    webFetchPrivateNetwork: boolean;
    /** OPENCLAW_NIGHTLY_MODEL=1 (H5): primary model p4-nightly. Only valid with P4_LLM_MODE=nightly. */
    nightlyModel: boolean;
}
export type P4Config = NextcloudConfig | OutlineConfig | PenpotConfig | MattermostConfig | LiteLlmConfig | LibreChatConfig | OpenClawConfig;
export interface HarnessConfig {
    productsRoot: string;
    cal: CalConfig;
    documenso: DocumensoConfig;
    medusa: MedusaConfig;
    twenty: TwentyConfig;
}
export declare function loadConfig(): HarnessConfig;
/**
 * Config for one product only. Resolves PRODUCTS_ROOT and that product's root; the other products' roots
 * are not checked, so a missing sibling fork does not fail this call. Env values are still validated in full,
 * as loadConfig does. Does not write the shared cache (it holds the full config).
 */
export declare function loadProductConfig(id: "cal"): CalConfig;
export declare function loadProductConfig(id: "documenso"): DocumensoConfig;
export declare function loadProductConfig(id: "medusa"): MedusaConfig;
export declare function loadProductConfig(id: "twenty"): TwentyConfig;
export declare function loadProductConfig(id: "nextcloud"): NextcloudConfig;
export declare function loadProductConfig(id: "outline"): OutlineConfig;
export declare function loadProductConfig(id: "penpot"): PenpotConfig;
export declare function loadProductConfig(id: "mattermost"): MattermostConfig;
export declare function loadProductConfig(id: "litellm"): LiteLlmConfig;
export declare function loadProductConfig(id: "librechat"): LibreChatConfig;
export declare function loadProductConfig(id: "openclaw"): OpenClawConfig;
export declare function loadProductConfig(id: ProductId): ProductConfig;
export declare function getProductConfig(id: ProductId): ProductConfig;
/** Reset cached config (used by smoke dry-run after env changes). */
export declare function resetConfigCache(): void;
//# sourceMappingURL=config.d.ts.map