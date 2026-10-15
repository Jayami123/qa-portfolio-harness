import type { MedusaConfig } from "../config.js";
import { createPgClient } from "../db/pg.js";
import { runCapture } from "../internal/run.js";
import { resolvePnpm } from "../internal/spawn-detached.js";
import type { SeedResult } from "../types.js";
import {
  MEDUSA_DEFAULT_CUSTOMER_EMAIL,
  MEDUSA_GERMAN_WAREHOUSE_NAME,
  MEDUSA_SEED_COLLECTION_TITLE,
  MEDUSA_SEED_PROMO_CODE,
  MEDUSA_STRIPE_PROVIDER_ID,
  MEDUSA_US_REGION_NAME,
  redactPublishableKey,
  shouldEnableStripeOnRegion,
  type MedusaHarnessSwitches,
} from "./medusa-env.js";

const USER_TIMEOUT_MS = 2 * 60_000;

type JsonRecord = Record<string, unknown>;

export async function readPublishableKeyFromDatabase(dbUrl: string): Promise<string | undefined> {
  const pool = createPgClient(dbUrl);
  try {
    const result = await pool.query<{ token: string }>(
      `SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    );
    const token = result.rows[0]?.token;
    return typeof token === "string" && token.trim() !== "" ? token.trim() : undefined;
  } finally {
    await pool.end();
  }
}

async function adminFetch(
  baseUrl: string,
  authorizationHeader: string,
  method: string,
  route: string,
  body?: JsonRecord,
): Promise<Response> {
  const url = `${baseUrl.replace(/\/$/, "")}/admin${route.startsWith("/") ? route : `/${route}`}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: authorizationHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<JsonRecord | undefined> {
  return (await response.json().catch(() => undefined)) as JsonRecord | undefined;
}

function listItems<T extends JsonRecord>(body: JsonRecord | undefined, key: string): T[] {
  const value = body?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function ensureMedusaAdminUser(
  backendDir: string,
  email: string,
  password: string,
  env: Record<string, string>,
): Promise<void> {
  const command = resolvePnpm();
  const args = ["medusa", "user", "-e", email, "-p", password];
  try {
    const result = await runCapture(command, args, {
      cwd: backendDir,
      env,
      timeoutMs: USER_TIMEOUT_MS,
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    if (combined.includes("User created successfully") || /created successfully/i.test(combined)) {
      console.log(`Medusa admin user created for ${email}.`);
      return;
    }
    throw new Error(`Medusa medusa user exited 0 but output was unexpected for ${email}.`);
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? "";
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const combined = `${stdout}\n${stderr}\n${error instanceof Error ? error.message : String(error)}`;
    if (/already exists/i.test(combined)) {
      console.log(`Medusa admin user ${email} already exists; skipping medusa user.`);
      return;
    }
    throw error;
  }
}

export interface MedusaSeedContext {
  readonly cfg: MedusaConfig;
  readonly switches: MedusaHarnessSwitches;
  readonly authorizationHeader: string;
  readonly backendDir: string;
  readonly processEnv: Record<string, string>;
}

async function timedSeedStep(label: string, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await run();
  const ms = Date.now() - started;
  console.log(`Medusa seed step ${label}: ${(ms / 1000).toFixed(3)} s (${ms} ms).`);
}

export async function runMedusaSeed(ctx: MedusaSeedContext): Promise<SeedResult> {
  const email = ctx.cfg.adminEmail;
  const password = ctx.cfg.adminPassword;
  if (!email || !password) {
    throw new Error("Medusa seed() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.");
  }

  const seedStarted = Date.now();
  const notes: string[] = [];
  let publishableKey = "";
  await timedSeedStep("publishable key", async () => {
    publishableKey = await resolvePublishableKey(ctx);
  });
  console.log(`Medusa publishable API key: ${redactPublishableKey(publishableKey)}`);

  await timedSeedStep("German Warehouse", () => ensureGermanWarehouse(ctx, notes));
  await timedSeedStep("Featured collection", () => ensureFeaturedCollection(ctx, notes));
  await timedSeedStep("promo QA10", () => ensurePromoCode(ctx, notes));
  await timedSeedStep("customer", () => ensureCustomer(ctx, notes));
  await timedSeedStep("US region", () => ensureUsRegion(ctx, notes));
  if (shouldEnableStripeOnRegion(ctx.switches, process.env.STRIPE_API_KEY)) {
    await timedSeedStep("Stripe on Europe", () => ensureStripeOnEurope(ctx, notes));
  }
  const seedMs = Date.now() - seedStarted;
  console.log(`Medusa seed total: ${(seedMs / 1000).toFixed(3)} s (${seedMs} ms).`);

  return {
    product: "medusa",
    created: notes.length > 0,
    users: [{ email, role: "admin" }],
    notes: notes.length > 0 ? notes.join(" ") : "Medusa seed already complete; no changes.",
  };
}

async function resolvePublishableKey(ctx: MedusaSeedContext): Promise<string> {
  if (ctx.cfg.publishableApiKey && ctx.cfg.publishableApiKey.trim() !== "") {
    return ctx.cfg.publishableApiKey.trim();
  }
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/api-keys?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/api-keys failed (HTTP ${response.status}).`);
  }
  const keys = listItems<JsonRecord>(body, "api_keys");
  const publishable = keys.find((entry) => entry.type === "publishable" && entry.revoked_at == null);
  const token = publishable?.token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("Medusa publishable API key not found after migrate. Run up() first.");
  }
  return token.trim();
}

async function ensureGermanWarehouse(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const locations = await listStockLocations(ctx);
  const existing = locations.find((row) => row.name === MEDUSA_GERMAN_WAREHOUSE_NAME);
  if (existing?.id !== undefined) {
    console.log(`${MEDUSA_GERMAN_WAREHOUSE_NAME} already present; skipping create.`);
    return;
  }
  const create = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", "/stock-locations", {
    name: MEDUSA_GERMAN_WAREHOUSE_NAME,
    address: {
      address_1: "Alexanderplatz 1",
      city: "Berlin",
      country_code: "de",
    },
  });
  const created = await readJson(create);
  if (!create.ok) {
    throw new Error(`Medusa POST /admin/stock-locations failed (HTTP ${create.status}).`);
  }
  const location = created?.stock_location as JsonRecord | undefined;
  const locationId = location?.id;
  if (typeof locationId !== "string") {
    throw new Error("Medusa German Warehouse create returned no id.");
  }
  notes.push("German Warehouse created.");

  const channelId = await defaultSalesChannelId(ctx);
  const link = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    `/stock-locations/${locationId}/sales-channels`,
    { add: [channelId] },
  );
  if (!link.ok) {
    throw new Error(`Medusa link stock location to sales channel failed (HTTP ${link.status}).`);
  }

  const inventoryItems = await listInventoryItems(ctx);
  for (const item of inventoryItems) {
    const itemId = item.id;
    if (typeof itemId !== "string") {
      continue;
    }
    const level = await adminFetch(
      ctx.cfg.baseUrl,
      ctx.authorizationHeader,
      "POST",
      `/inventory-items/${itemId}/location-levels`,
      { location_id: locationId, stocked_quantity: 1_000_000 },
    );
    if (!level.ok && level.status !== 409) {
      throw new Error(`Medusa inventory level for ${itemId} failed (HTTP ${level.status}).`);
    }
  }
  notes.push("German Warehouse inventory levels linked.");
}

async function ensureFeaturedCollection(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const collections = await listCollections(ctx);
  const existing = collections.find((row) => row.title === MEDUSA_SEED_COLLECTION_TITLE);
  if (existing?.id !== undefined) {
    console.log(`Collection ${MEDUSA_SEED_COLLECTION_TITLE} already present; skipping create.`);
    return;
  }
  const productIds = await seededProductIds(ctx);
  if (productIds.length === 0) {
    throw new Error("Medusa seed expected four published products from migrate.");
  }
  const create = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", "/collections", {
    title: MEDUSA_SEED_COLLECTION_TITLE,
  });
  const body = await readJson(create);
  if (!create.ok) {
    throw new Error(`Medusa POST /admin/collections failed (HTTP ${create.status}).`);
  }
  const collection = body?.collection as JsonRecord | undefined;
  const collectionId = collection?.id;
  if (typeof collectionId !== "string") {
    throw new Error("Medusa collection create returned no id.");
  }
  const attach = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    `/collections/${collectionId}/products`,
    { add: productIds },
  );
  if (!attach.ok) {
    throw new Error(`Medusa attach products to collection failed (HTTP ${attach.status}).`);
  }
  notes.push(`Collection ${MEDUSA_SEED_COLLECTION_TITLE} created with four products.`);
}

async function ensurePromoCode(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const promotions = await listPromotions(ctx);
  const existing = promotions.find((row) => row.code === MEDUSA_SEED_PROMO_CODE);
  if (existing?.id !== undefined) {
    console.log(`Promotion ${MEDUSA_SEED_PROMO_CODE} already present; skipping create.`);
    return;
  }
  const create = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", "/promotions", {
    code: MEDUSA_SEED_PROMO_CODE,
    type: "standard",
    status: "active",
    application_method: {
      type: "percentage",
      target_type: "order",
      value: 10,
      currency_code: "eur",
    },
  });
  if (!create.ok) {
    const body = await readJson(create);
    throw new Error(
      `Medusa POST /admin/promotions failed (HTTP ${create.status}). ${JSON.stringify(body?.message ?? body)}`,
    );
  }
  notes.push(`Promotion ${MEDUSA_SEED_PROMO_CODE} created (10%).`);
}

async function ensureCustomer(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const customerEmail =
    process.env.MEDUSA_SEED_CUSTOMER_EMAIL?.trim() || MEDUSA_DEFAULT_CUSTOMER_EMAIL;
  const customers = await listCustomers(ctx);
  if (customers.some((row) => row.email === customerEmail)) {
    console.log(`Customer ${customerEmail} already present; skipping create.`);
    return;
  }
  const create = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", "/customers", {
    email: customerEmail,
    first_name: "QA",
    last_name: "Customer",
  });
  if (!create.ok) {
    throw new Error(`Medusa POST /admin/customers failed (HTTP ${create.status}).`);
  }
  notes.push(`Customer ${customerEmail} created.`);
}

async function ensureUsRegion(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const regions = await listRegions(ctx);
  const hasUs = regions.some((row) => {
    const countries = row.countries;
    if (!Array.isArray(countries)) {
      return false;
    }
    return countries.some((country) => {
      const iso = (country as JsonRecord).iso_2;
      return iso === "us";
    });
  });
  if (hasUs) {
    console.log("US region already present; skipping create.");
    return;
  }
  const create = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", "/regions", {
    name: MEDUSA_US_REGION_NAME,
    currency_code: "usd",
    countries: ["us"],
  });
  if (!create.ok) {
    const body = await readJson(create);
    throw new Error(
      `Medusa POST /admin/regions failed (HTTP ${create.status}). ${JSON.stringify(body?.message ?? body)}`,
    );
  }
  notes.push(`${MEDUSA_US_REGION_NAME} region created.`);
}

async function ensureStripeOnEurope(ctx: MedusaSeedContext, notes: string[]): Promise<void> {
  const regions = await listRegions(ctx);
  const europe = regions.find((row) => row.currency_code === "eur");
  const regionId = europe?.id;
  if (typeof regionId !== "string") {
    throw new Error("Medusa Europe region not found for Stripe provider enable.");
  }
  const providers = Array.isArray(europe?.payment_providers) ? europe.payment_providers : [];
  const ids = providers
    .map((entry) => (entry as JsonRecord).id)
    .filter((id): id is string => typeof id === "string");
  if (ids.includes(MEDUSA_STRIPE_PROVIDER_ID)) {
    console.log(`${MEDUSA_STRIPE_PROVIDER_ID} already enabled on Europe; skipping.`);
    return;
  }
  const update = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "POST", `/regions/${regionId}`, {
    payment_providers: [...ids, MEDUSA_STRIPE_PROVIDER_ID],
  });
  if (!update.ok) {
    throw new Error(`Medusa enable ${MEDUSA_STRIPE_PROVIDER_ID} on Europe failed (HTTP ${update.status}).`);
  }
  notes.push(`${MEDUSA_STRIPE_PROVIDER_ID} enabled on Europe.`);
}

async function defaultSalesChannelId(ctx: MedusaSeedContext): Promise<string> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/sales-channels?limit=20");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/sales-channels failed (HTTP ${response.status}).`);
  }
  const channels = listItems<JsonRecord>(body, "sales_channels");
  const id = channels[0]?.id;
  if (typeof id !== "string") {
    throw new Error("Medusa default sales channel not found.");
  }
  return id;
}

async function listStockLocations(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/stock-locations?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/stock-locations failed (HTTP ${response.status}).`);
  }
  return listItems(body, "stock_locations");
}

async function listInventoryItems(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/inventory-items?limit=100");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/inventory-items failed (HTTP ${response.status}).`);
  }
  return listItems(body, "inventory_items");
}

async function listCollections(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/collections?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/collections failed (HTTP ${response.status}).`);
  }
  return listItems(body, "collections");
}

async function listPromotions(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/promotions?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/promotions failed (HTTP ${response.status}).`);
  }
  return listItems(body, "promotions");
}

async function listCustomers(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/customers?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/customers failed (HTTP ${response.status}).`);
  }
  return listItems(body, "customers");
}

async function listRegions(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/regions?limit=50");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/regions failed (HTTP ${response.status}).`);
  }
  return listItems(body, "regions");
}

async function seededProductIds(ctx: MedusaSeedContext): Promise<string[]> {
  const response = await adminFetch(ctx.cfg.baseUrl, ctx.authorizationHeader, "GET", "/products?limit=20");
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Medusa GET /admin/products failed (HTTP ${response.status}).`);
  }
  const products = listItems<JsonRecord>(body, "products");
  return products
    .map((product) => product.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, 4);
}
