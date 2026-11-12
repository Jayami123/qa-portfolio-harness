import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { documensoListen, parseDocumensoPublicUrl } from "./adapters/documenso-env.js";
import { assertMedusaSecondBaseUrl } from "./adapters/medusa-env.js";
import { TWENTY_DEFAULT_ADMIN_EMAIL, TWENTY_DEV_SEED_PASSWORD } from "./adapters/twenty-env.js";
import { HARNESS_ROOT } from "./paths.js";
import type { ProductId } from "./types.js";

loadDotenv({ path: path.join(HARNESS_ROOT, ".env") });

/** Inbucket REST mailbox base for Documenso e-mail checks. Must match the host port in docker/documenso.compose.yml (9003). */
export const documensoMailApiUrl = "http://127.0.0.1:9003/api/v1/mailbox";

/** Mailpit REST API base for Twenty e-mail checks. Must match the host port of the mailpit service in docker/twenty.compose.yml (8025). */
export const twentyMailApiUrl = "http://127.0.0.1:8025/api/v1";

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
export function loadProductConfig(id: ProductId): ProductConfig;
export function loadProductConfig(id: ProductId): ProductConfig {
  if (cached) {
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
