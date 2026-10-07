import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { HARNESS_ROOT } from "./paths.js";
import type { ProductId } from "./types.js";

loadDotenv({ path: path.join(HARNESS_ROOT, ".env") });

const emptyToUndefined = (value: unknown) => (value === "" || value === undefined ? undefined : value);

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const envSchema = z.object({
  PRODUCTS_ROOT: optionalString,
  CAL_PRODUCT_DIR: optionalString,
  DOCUMENSO_PRODUCT_DIR: optionalString,
  MEDUSA_PRODUCT_DIR: optionalString,
  TWENTY_PRODUCT_DIR: optionalString,

  CAL_BASE_URL: z.string().trim().url().default("http://localhost:3000"),
  CAL_API_BASE_URL: z.string().trim().url().default("http://localhost:5555"),
  CAL_DB_URL: z.string().trim().min(1).default("postgresql://postgres:@localhost:5450/calendso"),
  CAL_WEBHOOK_SECRET: optionalString,
  CAL_API_KEY: optionalString,

  DOCUMENSO_BASE_URL: z.string().trim().url().default("http://localhost:3001"),
  DOCUMENSO_DB_URL: z
    .string()
    .trim()
    .min(1)
    .default("postgres://documenso:password@127.0.0.1:54320/documenso"),
  DOCUMENSO_API_TOKEN: optionalString,

  MEDUSA_BASE_URL: z.string().trim().url().default("http://localhost:9000"),
  MEDUSA_DB_URL: z
    .string()
    .trim()
    .min(1)
    .default("postgres://medusa:medusa@localhost:5433/medusa_validation"),
  MEDUSA_ADMIN_EMAIL: optionalString,
  MEDUSA_ADMIN_PASSWORD: optionalString,
  MEDUSA_PUBLISHABLE_API_KEY: optionalString,

  TWENTY_BASE_URL: z.string().trim().url().default("http://localhost:3002"),
  TWENTY_DB_URL: z
    .string()
    .trim()
    .min(1)
    .default("postgres://postgres:postgres@localhost:5434/default"),
  TWENTY_EMAIL: optionalString,
  TWENTY_PASSWORD: optionalString,
  TWENTY_API_KEY: optionalString,
  TWENTY_IMAGE_TAG: z.string().trim().min(1).default("2.44.0"),
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
}

export interface MedusaConfig extends ProductConfig {
  id: "medusa";
  adminEmail?: string;
  adminPassword?: string;
  publishableApiKey?: string;
}

export interface TwentyConfig extends ProductConfig {
  id: "twenty";
  email?: string;
  password?: string;
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

let cached: HarnessConfig | undefined;

export function loadConfig(): HarnessConfig {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.parse(process.env);
  const productsRoot = path.resolve(parsed.PRODUCTS_ROOT ?? path.join(HARNESS_ROOT, "..", "products"));

  cached = {
    productsRoot,
    cal: {
      id: "cal",
      productRoot: resolveExistingDir(
        "Cal product root",
        parsed.CAL_PRODUCT_DIR ?? path.join(productsRoot, "cal"),
      ),
      baseUrl: parsed.CAL_BASE_URL.replace(/\/$/, ""),
      apiBaseUrl: parsed.CAL_API_BASE_URL.replace(/\/$/, ""),
      dbUrl: parsed.CAL_DB_URL,
      webhookSecret: parsed.CAL_WEBHOOK_SECRET,
      apiKey: parsed.CAL_API_KEY,
    },
    documenso: {
      id: "documenso",
      productRoot: resolveExistingDir(
        "Documenso product root",
        parsed.DOCUMENSO_PRODUCT_DIR ?? path.join(productsRoot, "documenso"),
      ),
      baseUrl: parsed.DOCUMENSO_BASE_URL.replace(/\/$/, ""),
      dbUrl: parsed.DOCUMENSO_DB_URL,
      apiToken: parsed.DOCUMENSO_API_TOKEN,
    },
    medusa: {
      id: "medusa",
      productRoot: resolveExistingDir(
        "Medusa product root",
        parsed.MEDUSA_PRODUCT_DIR ?? path.join(productsRoot, "medusa"),
      ),
      baseUrl: parsed.MEDUSA_BASE_URL.replace(/\/$/, ""),
      dbUrl: parsed.MEDUSA_DB_URL,
      adminEmail: parsed.MEDUSA_ADMIN_EMAIL,
      adminPassword: parsed.MEDUSA_ADMIN_PASSWORD,
      publishableApiKey: parsed.MEDUSA_PUBLISHABLE_API_KEY,
    },
    twenty: {
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
    },
  };

  return cached;
}

export function getProductConfig(id: ProductId): ProductConfig {
  const config = loadConfig();
  return config[id];
}

/** Reset cached config (used by smoke dry-run after env changes). */
export function resetConfigCache(): void {
  cached = undefined;
}
