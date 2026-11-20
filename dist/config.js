import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { documensoListen, parseDocumensoPublicUrl } from "./adapters/documenso-env.js";
import { assertMedusaSecondBaseUrl } from "./adapters/medusa-env.js";
import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD } from "./adapters/twenty-env.js";
import { HARNESS_ROOT } from "./paths.js";
import { parseP4LlmMode, parseStubApiBase } from "./adapters/litellm-env.js";
import { parseOpenClawChannelMockFlag, parseOpenClawLoopDetectionFlag, parseOpenClawNightlyModelFlag, parseOpenClawResponsesFlag, parseOpenClawWebFetchHosts, parseOpenClawWebFetchPrivateNetworkFlag, resolveOpenClawNightlyModel, } from "./adapters/openclaw-env.js";
import { resolveLibreChatModels } from "./adapters/librechat-env.js";
import { parseSecondIdentityFlag } from "./adapters/p4-second-identity.js";
import { parseMailFlag } from "./adapters/greenmail-env.js";
import { mattermostPostsOption } from "./adapters/mattermost-posts.js";
import { penpotPluginOption } from "./adapters/penpot-plugin.js";
import { LIBRECHAT_TOOL_APPROVAL_INVALID, parseAllowAlwaysFlag, parseToolApprovalFlag, parseToolApprovalMode, parseToolApprovalRules, } from "./adapters/librechat-approval.js";
import { resolveLibreChatMcpOauth } from "./adapters/librechat-oauth.js";
import { parseMcpRecordingFlag } from "./adapters/librechat-recording.js";
import { isForkProductId } from "./types.js";
loadDotenv({ path: path.join(HARNESS_ROOT, ".env") });
/** Inbucket REST mailbox base for Documenso e-mail checks. Must match the host port in docker/documenso.compose.yml (9003). */
export const documensoMailApiUrl = "http://127.0.0.1:9003/api/v1/mailbox";
/** Mailpit REST API base for Twenty e-mail checks. Must match the host port of the mailpit service in docker/twenty.compose.yml (8025). */
export const twentyMailApiUrl = "http://127.0.0.1:8025/api/v1";
/** Mailpit REST API base for the Cal catcher that `up cal` starts. Must match the host UI port in docker/cal.mail.compose.yml (8026). */
export const calMailApiUrl = "http://127.0.0.1:8026/api/v1";
const emptyToUndefined = (value) => (value === "" || value === undefined ? undefined : value);
function medusaSecondBaseUrl(primaryBaseUrl, secondBaseUrl) {
    if (secondBaseUrl === undefined) {
        return undefined;
    }
    const clean = secondBaseUrl.replace(/\/$/, "");
    assertMedusaSecondBaseUrl(primaryBaseUrl, clean);
    return clean;
}
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
/** Thrown when PRODUCTS_ROOT is unset or blank and the default resolves inside node_modules. */
export const PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES = "PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES";
/**
 * Set: path.resolve(raw), as before (relative to the current directory).
 * Unset or blank: path.resolve(cwd, "..", "products"). If any path segment of that result is exactly
 * "node_modules", throw `${PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES}: ...`. Only the default is checked.
 */
export function resolveProductsRoot(raw, cwd) {
    if (raw !== undefined && raw.trim() !== "") {
        return path.resolve(raw);
    }
    const resolved = path.resolve(cwd, "..", "products");
    if (resolved.split(path.sep).includes("node_modules")) {
        throw new Error(`${PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES}: the default ../products resolves inside node_modules (${resolved}). Set PRODUCTS_ROOT to the folder that holds the product forks.`);
    }
    return resolved;
}
const envSchema = z.object({
    PRODUCTS_ROOT: optionalString,
    CAL_PRODUCT_DIR: optionalString,
    DOCUMENSO_PRODUCT_DIR: optionalString,
    MEDUSA_PRODUCT_DIR: optionalString,
    TWENTY_PRODUCT_DIR: optionalString,
    CAL_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3000"),
    CAL_API_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:5555"),
    CAL_DB_URL: z.string().trim().min(1).default("postgresql://postgres:@127.0.0.1:5450/calendso"),
    CAL_WEBHOOK_SECRET: optionalString,
    CAL_API_KEY: optionalString,
    DOCUMENSO_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3001"),
    DOCUMENSO_DB_URL: z
        .string()
        .trim()
        .min(1)
        .default("postgres://documenso:password@127.0.0.1:5451/documenso"),
    DOCUMENSO_PUBLIC_URL: optionalString,
    DOCUMENSO_API_TOKEN: optionalString,
    MEDUSA_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:9000"),
    /** Optional second Medusa backend on the same database. Unset means none. */
    MEDUSA_SECOND_BASE_URL: z.preprocess(emptyToUndefined, z.string().trim().pipe(z.url()).optional()),
    MEDUSA_DB_URL: z
        .string()
        .trim()
        .min(1)
        .default("postgres://medusa:medusa@127.0.0.1:5433/medusa"),
    MEDUSA_STOREFRONT_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8000"),
    MEDUSA_ADMIN_EMAIL: optionalString,
    MEDUSA_ADMIN_PASSWORD: optionalString,
    MEDUSA_PUBLISHABLE_API_KEY: optionalString,
    MEDUSA_SEED_CUSTOMER_EMAIL: optionalString,
    MEDUSA_SEED_CUSTOMER_PASSWORD: optionalString,
    STRIPE_API_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    NEXT_PUBLIC_STRIPE_KEY: optionalString,
    TWENTY_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3002"),
    TWENTY_DB_URL: z
        .string()
        .trim()
        .min(1)
        .default("postgres://postgres:postgres@127.0.0.1:5434/default"),
    TWENTY_EMAIL: z.preprocess(emptyToUndefined, z.string().trim().pipe(z.email()).optional()).default(TWENTY_DEFAULT_ADMIN_EMAIL),
    TWENTY_PASSWORD: z
        .preprocess(emptyToUndefined, z.string().trim().min(1).optional())
        .default(TWENTY_DEV_SEED_PASSWORD),
    TWENTY_API_KEY: optionalString,
    TWENTY_IMAGE_TAG: z.string().trim().min(1).default("v2.44.0"),
    /** Exactly "1" starts the Twenty MCP credential and readiness step (P4). Anything else is off. */
    TWENTY_MCP: optionalString,
    /** Readiness budget for the P4 products in ms. Unset uses the default in each adapter. */
    P4_WAIT_MS: optionalString,
    // P4 products (image-only). Database passwords are NOT in these defaults: each compose run generates its own
    // and writes it to .harness/<product>-run.json (CLAUDE.md: no passwords in committed files).
    NEXTCLOUD_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8080"),
    NEXTCLOUD_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8765/mcp"),
    /** H2: P4_SECOND_IDENTITY=1 creates a second user per server (off by default). */
    P4_SECOND_IDENTITY: z.string().trim().default(""),
    /** H7: P4_SECOND_POSTS=1 makes the second identity seed posts in Mattermost. Needs P4_SECOND_IDENTITY=1. Off by default. */
    P4_SECOND_POSTS: z.string().trim().default(""),
    /** H6: P4_PENPOT_PLUGIN=1 runs the Penpot MCP per user, with a browser tab per profile. Needs P4_SECOND_IDENTITY=1. */
    P4_PENPOT_PLUGIN: z.string().trim().default(""),
    /** H1: P4_MAIL=1 starts GreenMail and configures the Nextcloud Mail app against it. Off by default. */
    P4_MAIL: z.string().trim().default(""),
    NEXTCLOUD_DB_URL: z.string().trim().min(1).default("postgres://nextcloud@127.0.0.1:5460/nextcloud"),
    OUTLINE_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3011"),
    OUTLINE_DB_URL: z.string().trim().min(1).default("postgres://outline@127.0.0.1:5461/outline"),
    PENPOT_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:9001"),
    PENPOT_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:4401/mcp"),
    PENPOT_DB_URL: z.string().trim().min(1).default("postgres://penpot@127.0.0.1:5462/penpot"),
    MATTERMOST_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8065"),
    MATTERMOST_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8066/mcp"),
    MATTERMOST_DB_URL: z.string().trim().min(1).default("postgres://mattermost@127.0.0.1:5463/mattermost"),
    // Agent hosts (ADR 0007). Host ports are loopback. In-container networking uses the qa-harness-p4 aliases (review answer 0.1).
    // Stub mode is the default and p4-stub uses mock_response (review answer 0.9). Gemma is not called in B1.
    LITELLM_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:4000"),
    P4_LLM_MODE: z.string().trim().default("stub"),
    // Optional. When set, p4-stub routes to this OpenAI-compatible stub instead of mock_response. Blank means unset.
    P4_STUB_API_BASE: z.string().trim().default(""),
    // Optional. Comma-separated LiteLLM aliases LibreChat lists. Blank means the default (p4-stub, plus p4-nightly in nightly mode).
    LIBRECHAT_MODELS: z.string().trim().default(""),
    LIBRECHAT_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3080"),
    LIBRECHAT_DB_URL: z.string().trim().min(1).default("mongodb://127.0.0.1:27017/LibreChat"),
    LIBRECHAT_MCP_PRODUCTS: z.string().trim().default("nextcloud,outline,twenty,penpot,mattermost"),
    /** H3: LibreChat tool-approval policy (endpoints.agents.toolApproval). Off unless LIBRECHAT_TOOL_APPROVAL=1. */
    LIBRECHAT_TOOL_APPROVAL: z.string().trim().default(""),
    LIBRECHAT_TOOL_APPROVAL_MODE: z.string().trim().default(""),
    LIBRECHAT_TOOL_APPROVAL_ALLOW: z.string().trim().default(""),
    LIBRECHAT_TOOL_APPROVAL_DENY: z.string().trim().default(""),
    LIBRECHAT_TOOL_APPROVAL_ASK: z.string().trim().default(""),
    /** Offer "Always allow" (toolApproval.allowAlways). Exactly 1 turns it on; needs LIBRECHAT_TOOL_APPROVAL=1. */
    LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: z.string().trim().default(""),
    /** H4: OAuth sign-in for OAuth-capable MCP servers. Exactly 1 turns it on; unset is off (librechat-oauth.ts). */
    LIBRECHAT_MCP_OAUTH: z.string().trim().default(""),
    /** H9: MCP recording proxy between LibreChat and each MCP server. Off unless LIBRECHAT_MCP_RECORDING=1. */
    LIBRECHAT_MCP_RECORDING: z.string().trim().default(""),
    OPENCLAW_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:18789"),
    // Opt-in, exact value "1": enables the gateway's POST /v1/responses endpoint so runTask() works. Unset changes nothing.
    OPENCLAW_RESPONSES_API: z.string().trim().default(""),
    // Opt-in L4 primitives (v0.6.4), all off by default. Flags are exactly "1"; the host list is comma-separated exact hostnames.
    OPENCLAW_CHANNEL_MOCK: z.string().trim().default(""),
    OPENCLAW_LOOP_DETECTION: z.string().trim().default(""),
    OPENCLAW_WEB_FETCH_ALLOWED_HOSTS: z.string().trim().default(""),
    OPENCLAW_WEB_FETCH_PRIVATE_NETWORK: z.string().trim().default(""),
    OPENCLAW_NIGHTLY_MODEL: z.string().trim().default(""),
});
function resolveExistingDir(label, dir) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
        throw new Error(`${label} does not exist: ${resolved}. Set PRODUCTS_ROOT (or the product-specific *_PRODUCT_DIR) in .env.`);
    }
    return resolved;
}
/*
 * One builder per product. Each resolves only its own root (resolveExistingDir), so a missing sibling
 * fork cannot fail a different product's lookup. loadConfig() calls all four (eager, unchanged);
 * loadProductConfig() calls one.
 */
function buildCalConfig(parsed, productsRoot) {
    return {
        id: "cal",
        productRoot: resolveExistingDir("Cal product root", parsed.CAL_PRODUCT_DIR ?? path.join(productsRoot, "cal")),
        baseUrl: parsed.CAL_BASE_URL.replace(/\/$/, ""),
        apiBaseUrl: parsed.CAL_API_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.CAL_DB_URL,
        webhookSecret: parsed.CAL_WEBHOOK_SECRET,
        apiKey: parsed.CAL_API_KEY,
    };
}
function buildDocumensoConfig(parsed, productsRoot) {
    return {
        id: "documenso",
        productRoot: resolveExistingDir("Documenso product root", parsed.DOCUMENSO_PRODUCT_DIR ?? path.join(productsRoot, "documenso")),
        baseUrl: parsed.DOCUMENSO_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.DOCUMENSO_DB_URL,
        publicUrl: parsed.DOCUMENSO_PUBLIC_URL
            ? parseDocumensoPublicUrl(parsed.DOCUMENSO_PUBLIC_URL, documensoListen(parsed.DOCUMENSO_BASE_URL.replace(/\/$/, "")).port)
            : undefined,
        apiToken: parsed.DOCUMENSO_API_TOKEN,
    };
}
function buildMedusaConfig(parsed, productsRoot) {
    return {
        id: "medusa",
        productRoot: resolveExistingDir("Medusa product root", parsed.MEDUSA_PRODUCT_DIR ?? path.join(productsRoot, "medusa-dtc-starter")),
        baseUrl: parsed.MEDUSA_BASE_URL.replace(/\/$/, ""),
        secondBaseUrl: medusaSecondBaseUrl(parsed.MEDUSA_BASE_URL.replace(/\/$/, ""), parsed.MEDUSA_SECOND_BASE_URL),
        storefrontUrl: parsed.MEDUSA_STOREFRONT_URL.replace(/\/$/, ""),
        dbUrl: parsed.MEDUSA_DB_URL,
        adminEmail: parsed.MEDUSA_ADMIN_EMAIL,
        adminPassword: parsed.MEDUSA_ADMIN_PASSWORD,
        publishableApiKey: parsed.MEDUSA_PUBLISHABLE_API_KEY,
        stripeApiKey: parsed.STRIPE_API_KEY,
        stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
        stripePublishableKey: parsed.NEXT_PUBLIC_STRIPE_KEY,
    };
}
function buildTwentyConfig(parsed, productsRoot) {
    return {
        id: "twenty",
        productRoot: resolveExistingDir("Twenty product root", parsed.TWENTY_PRODUCT_DIR ?? path.join(productsRoot, "twenty-CRM")),
        baseUrl: parsed.TWENTY_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.TWENTY_DB_URL,
        email: parsed.TWENTY_EMAIL,
        password: parsed.TWENTY_PASSWORD,
        apiKey: parsed.TWENTY_API_KEY,
        imageTag: parsed.TWENTY_IMAGE_TAG,
        secondIdentity: parseSecondIdentityFlag(parsed.P4_SECOND_IDENTITY),
    };
}
/** D1: every P4 product keeps its state under the harness folder. Nothing here requires that folder to exist. */
function p4ProductRoot(id) {
    return path.join(HARNESS_ROOT, ".harness", id);
}
function buildNextcloudConfig(parsed) {
    return {
        id: "nextcloud",
        productRoot: p4ProductRoot("nextcloud"),
        baseUrl: parsed.NEXTCLOUD_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.NEXTCLOUD_DB_URL,
        mcpUrl: parsed.NEXTCLOUD_MCP_URL.replace(/\/$/, ""),
        secondIdentity: parseSecondIdentityFlag(parsed.P4_SECOND_IDENTITY),
        mail: parseMailFlag(parsed.P4_MAIL),
    };
}
function buildOutlineConfig(parsed) {
    const baseUrl = parsed.OUTLINE_BASE_URL.replace(/\/$/, "");
    return {
        id: "outline",
        productRoot: p4ProductRoot("outline"),
        baseUrl,
        dbUrl: parsed.OUTLINE_DB_URL,
        mcpUrl: `${baseUrl}/mcp`,
        secondIdentity: parseSecondIdentityFlag(parsed.P4_SECOND_IDENTITY),
    };
}
function buildPenpotConfig(parsed) {
    return {
        id: "penpot",
        productRoot: p4ProductRoot("penpot"),
        baseUrl: parsed.PENPOT_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.PENPOT_DB_URL,
        mcpUrl: parsed.PENPOT_MCP_URL.replace(/\/$/, ""),
        secondIdentity: parseSecondIdentityFlag(parsed.P4_SECOND_IDENTITY),
        perUserPlugin: penpotPluginOption(parsed.P4_PENPOT_PLUGIN, parsed.P4_SECOND_IDENTITY),
    };
}
function buildMattermostConfig(parsed) {
    return {
        id: "mattermost",
        productRoot: p4ProductRoot("mattermost"),
        baseUrl: parsed.MATTERMOST_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.MATTERMOST_DB_URL,
        mcpUrl: parsed.MATTERMOST_MCP_URL.replace(/\/$/, ""),
        secondIdentity: parseSecondIdentityFlag(parsed.P4_SECOND_IDENTITY),
        secondPosts: mattermostPostsOption(parsed.P4_SECOND_POSTS, parsed.P4_SECOND_IDENTITY),
    };
}
function buildLiteLlmConfig(parsed) {
    return {
        id: "litellm",
        productRoot: p4ProductRoot("litellm"),
        baseUrl: parsed.LITELLM_BASE_URL.replace(/\/$/, ""),
        dbUrl: "none://litellm", // sentinel: LiteLLM has no database in B1 (VERIFIED: it served requests with no DATABASE_URL)
        mode: parseP4LlmMode(parsed.P4_LLM_MODE),
        stubApiBase: parseStubApiBase(parsed.P4_STUB_API_BASE),
    };
}
function buildLibreChatConfig(parsed) {
    return {
        id: "librechat",
        productRoot: p4ProductRoot("librechat"),
        baseUrl: parsed.LIBRECHAT_BASE_URL.replace(/\/$/, ""),
        dbUrl: parsed.LIBRECHAT_DB_URL,
        mcpProducts: parsed.LIBRECHAT_MCP_PRODUCTS.split(",")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        models: resolveLibreChatModels(parsed.LIBRECHAT_MODELS, parseP4LlmMode(parsed.P4_LLM_MODE)),
        toolApproval: buildLibreChatToolApproval(parsed),
        mcpOauth: resolveLibreChatMcpOauth({
            flag: parsed.LIBRECHAT_MCP_OAUTH,
            mcpProducts: parsed.LIBRECHAT_MCP_PRODUCTS.split(",").map((s) => s.trim()).filter((s) => s !== ""),
            twentyBrowserBaseUrl: parsed.TWENTY_BASE_URL,
        }),
        mcpRecording: parseMcpRecordingFlag(parsed.LIBRECHAT_MCP_RECORDING),
    };
}
/**
 * H3. Off unless LIBRECHAT_TOOL_APPROVAL=1; rules without the flag are refused rather than ignored. allowAlways (exactly
 * LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1, default off) is refused without the flag and under mode dontAsk, where LibreChat
 * ignores remembered choices (packages/api/src/agents/hitl/allow.ts, isToolAllowAlwaysEnabled, v0.8.9).
 */
function buildLibreChatToolApproval(parsed) {
    const servers = parsed.LIBRECHAT_MCP_PRODUCTS.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const on = parseToolApprovalFlag(parsed.LIBRECHAT_TOOL_APPROVAL);
    const allowAlways = parseAllowAlwaysFlag(parsed.LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS);
    const rules = [parsed.LIBRECHAT_TOOL_APPROVAL_ALLOW, parsed.LIBRECHAT_TOOL_APPROVAL_DENY, parsed.LIBRECHAT_TOOL_APPROVAL_ASK, parsed.LIBRECHAT_TOOL_APPROVAL_MODE];
    if (!on) {
        if (rules.some((r) => r.trim() !== "") || allowAlways) {
            throw new Error("LIBRECHAT_TOOL_APPROVAL_NEEDS_FLAG: the approval rules and LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS need LIBRECHAT_TOOL_APPROVAL=1");
        }
        return null;
    }
    const mode = parseToolApprovalMode(parsed.LIBRECHAT_TOOL_APPROVAL_MODE);
    if (allowAlways && mode === "dontAsk") {
        throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1 needs mode default or bypass; dontAsk ignores remembered choices`);
    }
    return {
        mode,
        allow: parseToolApprovalRules(parsed.LIBRECHAT_TOOL_APPROVAL_ALLOW, servers),
        deny: parseToolApprovalRules(parsed.LIBRECHAT_TOOL_APPROVAL_DENY, servers),
        ask: parseToolApprovalRules(parsed.LIBRECHAT_TOOL_APPROVAL_ASK, servers),
        allowAlways,
    };
}
function buildOpenClawConfig(parsed) {
    return {
        id: "openclaw",
        productRoot: p4ProductRoot("openclaw"),
        baseUrl: parsed.OPENCLAW_BASE_URL.replace(/\/$/, ""),
        dbUrl: "none://openclaw", // sentinel: OpenClaw has no database in B1
        responsesApi: parseOpenClawResponsesFlag(parsed.OPENCLAW_RESPONSES_API),
        channelMock: parseOpenClawChannelMockFlag(parsed.OPENCLAW_CHANNEL_MOCK),
        loopDetection: parseOpenClawLoopDetectionFlag(parsed.OPENCLAW_LOOP_DETECTION),
        webFetchAllowedHosts: parseOpenClawWebFetchHosts(parsed.OPENCLAW_WEB_FETCH_ALLOWED_HOSTS),
        webFetchPrivateNetwork: parseOpenClawWebFetchPrivateNetworkFlag(parsed.OPENCLAW_WEB_FETCH_PRIVATE_NETWORK),
        nightlyModel: resolveOpenClawNightlyModel(parseOpenClawNightlyModelFlag(parsed.OPENCLAW_NIGHTLY_MODEL), parseP4LlmMode(parsed.P4_LLM_MODE)),
    };
}
let cached;
export function loadConfig() {
    if (cached) {
        return cached;
    }
    const parsed = envSchema.parse(process.env);
    const productsRoot = resolveProductsRoot(parsed.PRODUCTS_ROOT, process.cwd());
    cached = {
        productsRoot,
        cal: buildCalConfig(parsed, productsRoot),
        documenso: buildDocumensoConfig(parsed, productsRoot),
        medusa: buildMedusaConfig(parsed, productsRoot),
        twenty: buildTwentyConfig(parsed, productsRoot),
    };
    return cached;
}
export function loadProductConfig(id) {
    // Only the four fork products are cached (loadConfig holds them). P4 products never touch the cache.
    if (cached && isForkProductId(id)) {
        return cached[id];
    }
    const parsed = envSchema.parse(process.env);
    const productsRoot = resolveProductsRoot(parsed.PRODUCTS_ROOT, process.cwd());
    switch (id) {
        case "cal":
            return buildCalConfig(parsed, productsRoot);
        case "documenso":
            return buildDocumensoConfig(parsed, productsRoot);
        case "medusa":
            return buildMedusaConfig(parsed, productsRoot);
        case "twenty":
            return buildTwentyConfig(parsed, productsRoot);
        case "nextcloud":
            return buildNextcloudConfig(parsed);
        case "outline":
            return buildOutlineConfig(parsed);
        case "penpot":
            return buildPenpotConfig(parsed);
        case "mattermost":
            return buildMattermostConfig(parsed);
        case "litellm":
            return buildLiteLlmConfig(parsed);
        case "librechat":
            return buildLibreChatConfig(parsed);
        case "openclaw":
            return buildOpenClawConfig(parsed);
        default: {
            const exhaustive = id;
            throw new Error(`Unknown product id: ${String(exhaustive)}`);
        }
    }
}
export function getProductConfig(id) {
    return loadProductConfig(id);
}
/** Reset cached config (used by smoke dry-run after env changes). */
export function resetConfigCache() {
    cached = undefined;
}
//# sourceMappingURL=config.js.map