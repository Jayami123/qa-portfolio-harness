import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { documensoListen, parseDocumensoPublicUrl } from "./adapters/documenso-env.js";
import { assertMedusaSecondBaseUrl } from "./adapters/medusa-env.js";
import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD } from "./adapters/twenty-env.js";
import { HARNESS_ROOT } from "./paths.js";
import { isForkProductId, type ProductId } from "./types.js";

loadDotenv({ path: path.join(HARNESS_ROOT, ".env") });

/** Inbucket REST mailbox base for Documenso e-mail checks. Must match the host port in docker/documenso.compose.yml (9003). */
export const documensoMailApiUrl = "http://127.0.0.1:9003/api/v1/mailbox";

/** Mailpit REST API base for Twenty e-mail checks. Must match the host port of the mailpit service in docker/twenty.compose.yml (8025). */
export const twentyMailApiUrl = "http://127.0.0.1:8025/api/v1";

/** Mailpit REST API base for the Cal catcher that `up cal` starts. Must match the host UI port in docker/cal.mail.compose.yml (8026). */
export const calMailApiUrl = "http://127.0.0.1:8026/api/v1";

const emptyToUndefined = (value: unknown) => (value === "" || value === undefined ? undefined : value);

function medusaSecondBaseUrl(primaryBaseUrl: string, secondBaseUrl: string | undefined): string | undefined {
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
export function resolveProductsRoot(raw: string | undefined, cwd: string): string {
  if (raw !== undefined && raw.trim() !== "") {
    return path.resolve(raw);
  }
  const resolved = path.resolve(cwd, "..", "products");
  if (resolved.split(path.sep).includes("node_modules")) {
    throw new Error(
      `${PRODUCTS_ROOT_DEFAULT_IN_NODE_MODULES}: the default ../products resolves inside node_modules (${resolved}). Set PRODUCTS_ROOT to the folder that holds the product forks.`,
    );
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
  NEXTCLOUD_DB_URL: z.string().trim().min(1).default("postgres://nextcloud@127.0.0.1:5460/nextcloud"),
  OUTLINE_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:3011"),
  OUTLINE_DB_URL: z.string().trim().min(1).default("postgres://outline@127.0.0.1:5461/outline"),
  PENPOT_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:9001"),
  PENPOT_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:4401/mcp"),
  PENPOT_DB_URL: z.string().trim().min(1).default("postgres://penpot@127.0.0.1:5462/penpot"),
  MATTERMOST_BASE_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8065"),
  MATTERMOST_MCP_URL: z.string().trim().pipe(z.url()).default("http://127.0.0.1:8066/mcp"),
  MATTERMOST_DB_URL: z.string().trim().min(1).default("postgres://mattermost@127.0.0.1:5463/mattermost"),
});

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
}

/** P4 products. productRoot is .harness/<product> (ADR 0006, D1); no fork is read. */
export interface NextcloudConfig extends ProductConfig {
  id: "nextcloud";
  mcpUrl: string;
}

export interface OutlineConfig extends ProductConfig {
  id: "outline";
  /** Outline's built-in MCP lives on the app origin at /mcp (ADR 0006). */
  mcpUrl: string;
}

export interface PenpotConfig extends ProductConfig {
  id: "penpot";
  mcpUrl: string;
}

export interface MattermostConfig extends ProductConfig {
  id: "mattermost";
  mcpUrl: string;
}

export type P4Config = NextcloudConfig | OutlineConfig | PenpotConfig | MattermostConfig;

export interface HarnessConfig {
  productsRoot: string;
  cal: CalConfig;
  documenso: DocumensoConfig;
  medusa: MedusaConfig;
  twenty: TwentyConfig;
}

function resolveExistingDir(label: string, dir: string): string {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `${label} does not exist: ${resolved}. Set PRODUCTS_ROOT (or the product-specific *_PRODUCT_DIR) in .env.`,
    );
  }
  return resolved;
}

type ParsedEnv = z.infer<typeof envSchema>;

/*
 * One builder per product. Each resolves only its own root (resolveExistingDir), so a missing sibling
 * fork cannot fail a different product's lookup. loadConfig() calls all four (eager, unchanged);
 * loadProductConfig() calls one.
 */

function buildCalConfig(parsed: ParsedEnv, productsRoot: string): CalConfig {
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

function buildDocumensoConfig(parsed: ParsedEnv, productsRoot: string): DocumensoConfig {
  return {
    id: "documenso",
    productRoot: resolveExistingDir(
      "Documenso product root",
      parsed.DOCUMENSO_PRODUCT_DIR ?? path.join(productsRoot, "documenso"),
    ),
    baseUrl: parsed.DOCUMENSO_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.DOCUMENSO_DB_URL,
    publicUrl: parsed.DOCUMENSO_PUBLIC_URL
      ? parseDocumensoPublicUrl(
          parsed.DOCUMENSO_PUBLIC_URL,
          documensoListen(parsed.DOCUMENSO_BASE_URL.replace(/\/$/, "")).port,
        )
      : undefined,
    apiToken: parsed.DOCUMENSO_API_TOKEN,
  };
}

function buildMedusaConfig(parsed: ParsedEnv, productsRoot: string): MedusaConfig {
  return {
    id: "medusa",
    productRoot: resolveExistingDir(
      "Medusa product root",
      parsed.MEDUSA_PRODUCT_DIR ?? path.join(productsRoot, "medusa-dtc-starter"),
    ),
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

function buildTwentyConfig(parsed: ParsedEnv, productsRoot: string): TwentyConfig {
  return {
    id: "twenty",
    productRoot: resolveExistingDir(
      "Twenty product root",
      parsed.TWENTY_PRODUCT_DIR ?? path.join(productsRoot, "twenty-CRM"),
    ),
    baseUrl: parsed.TWENTY_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.TWENTY_DB_URL,
    email: parsed.TWENTY_EMAIL,
    password: parsed.TWENTY_PASSWORD,
    apiKey: parsed.TWENTY_API_KEY,
    imageTag: parsed.TWENTY_IMAGE_TAG,
  };
}

/** D1: every P4 product keeps its state under the harness folder. Nothing here requires that folder to exist. */
function p4ProductRoot(id: "nextcloud" | "outline" | "penpot" | "mattermost"): string {
  return path.join(HARNESS_ROOT, ".harness", id);
}

function buildNextcloudConfig(parsed: ParsedEnv): NextcloudConfig {
  return {
    id: "nextcloud",
    productRoot: p4ProductRoot("nextcloud"),
    baseUrl: parsed.NEXTCLOUD_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.NEXTCLOUD_DB_URL,
    mcpUrl: parsed.NEXTCLOUD_MCP_URL.replace(/\/$/, ""),
  };
}

function buildOutlineConfig(parsed: ParsedEnv): OutlineConfig {
  const baseUrl = parsed.OUTLINE_BASE_URL.replace(/\/$/, "");
  return {
    id: "outline",
    productRoot: p4ProductRoot("outline"),
    baseUrl,
    dbUrl: parsed.OUTLINE_DB_URL,
    mcpUrl: `${baseUrl}/mcp`,
  };
}

function buildPenpotConfig(parsed: ParsedEnv): PenpotConfig {
  return {
    id: "penpot",
    productRoot: p4ProductRoot("penpot"),
    baseUrl: parsed.PENPOT_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.PENPOT_DB_URL,
    mcpUrl: parsed.PENPOT_MCP_URL.replace(/\/$/, ""),
  };
}

function buildMattermostConfig(parsed: ParsedEnv): MattermostConfig {
  return {
    id: "mattermost",
    productRoot: p4ProductRoot("mattermost"),
    baseUrl: parsed.MATTERMOST_BASE_URL.replace(/\/$/, ""),
    dbUrl: parsed.MATTERMOST_DB_URL,
    mcpUrl: parsed.MATTERMOST_MCP_URL.replace(/\/$/, ""),
  };
}

let cached: HarnessConfig | undefined;

export function loadConfig(): HarnessConfig {
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

/**
 * Config for one product only. Resolves PRODUCTS_ROOT and that product's root; the other products' roots
 * are not checked, so a missing sibling fork does not fail this call. Env values are still validated in full,
 * as loadConfig does. Does not write the shared cache (it holds the full config).
 */
export function loadProductConfig(id: "cal"): CalConfig;
export function loadProductConfig(id: "documenso"): DocumensoConfig;
export function loadProductConfig(id: "medusa"): MedusaConfig;
export function loadProductConfig(id: "twenty"): TwentyConfig;
export function loadProductConfig(id: "nextcloud"): NextcloudConfig;
export function loadProductConfig(id: "outline"): OutlineConfig;
export function loadProductConfig(id: "penpot"): PenpotConfig;
export function loadProductConfig(id: "mattermost"): MattermostConfig;
export function loadProductConfig(id: ProductId): ProductConfig;
export function loadProductConfig(id: ProductId): ProductConfig {
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
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown product id: ${String(exhaustive)}`);
    }
  }
}

export function getProductConfig(id: ProductId): ProductConfig {
  return loadProductConfig(id);
}

/** Reset cached config (used by smoke dry-run after env changes). */
export function resetConfigCache(): void {
  cached = undefined;
}
