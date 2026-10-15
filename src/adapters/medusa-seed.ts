import type { MedusaConfig } from "../config.js";
import { createPgClient } from "../db/pg.js";
import { runCapture } from "../internal/run.js";
import { resolvePnpm } from "../internal/spawn-detached.js";
import type { SeedResult } from "../types.js";
import {
  MEDUSA_DEFAULT_CUSTOMER_EMAIL,
  MEDUSA_DEFAULT_CUSTOMER_PASSWORD,
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

export async function readPublishableKeyFromDatabase(
  dbUrl: string,
): Promise<string | undefined> {
  const pool = createPgClient(dbUrl);
  try {
    const result = await pool.query<{ token: string }>(
      `SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    );
    const token = result.rows[0]?.token;
    return typeof token === "string" && token.trim() !== ""
      ? token.trim()
      : undefined;
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
  return (await response.json().catch(() => undefined)) as
    JsonRecord | undefined;
}

function listItems<T extends JsonRecord>(
  body: JsonRecord | undefined,
  key: string,
): T[] {
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
      // The password is an argv entry; keep it out of timeout/exit messages and captured output.
      redact: [password],
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    if (
      combined.includes("User created successfully") ||
      /created successfully/i.test(combined)
    ) {
      console.log(`Medusa admin user created for ${email}.`);
      return;
    }
    throw new Error(
      `Medusa medusa user exited 0 but output was unexpected for ${email}.`,
    );
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? "";
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const combined = `${stdout}\n${stderr}\n${error instanceof Error ? error.message : String(error)}`;
    if (/already exists/i.test(combined)) {
      console.log(
        `Medusa admin user ${email} already exists; skipping medusa user.`,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split(password).join("(redacted)"));
  }
}

export interface MedusaSeedContext {
  readonly cfg: MedusaConfig;
  readonly switches: MedusaHarnessSwitches;
  readonly authorizationHeader: string;
  readonly backendDir: string;
  readonly processEnv: Record<string, string>;
}

async function timedSeedStep(
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  const started = Date.now();
  await run();
  const ms = Date.now() - started;
  console.log(
    `Medusa seed step ${label}: ${(ms / 1000).toFixed(3)} s (${ms} ms).`,
  );
}

export async function runMedusaSeed(
  ctx: MedusaSeedContext,
): Promise<SeedResult> {
  const email = ctx.cfg.adminEmail;
  const password = ctx.cfg.adminPassword;
  if (!email || !password) {
    throw new Error(
      "Medusa seed() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.",
    );
  }

  const seedStarted = Date.now();
  const notes: string[] = [];
  let publishableKey = "";
  await timedSeedStep("publishable key", async () => {
    publishableKey = await resolvePublishableKey(ctx);
  });
  console.log(
    `Medusa publishable API key: ${redactPublishableKey(publishableKey)}`,
  );

  await timedSeedStep("German Warehouse", () =>
    ensureGermanWarehouse(ctx, notes),
  );
  await timedSeedStep("Featured collection", () =>
    ensureFeaturedCollection(ctx, notes),
  );
  await timedSeedStep("promo QA10", () => ensurePromoCode(ctx, notes));
  await timedSeedStep("customer", () =>
    ensureCustomer(ctx, notes, publishableKey),
  );
  await timedSeedStep("US region", () => ensureUsRegion(ctx, notes));
  if (shouldEnableStripeOnRegion(ctx.switches, process.env.STRIPE_API_KEY)) {
    await timedSeedStep("Stripe on Europe", () =>
      ensureStripeOnEurope(ctx, notes),
    );
  }
  const seedMs = Date.now() - seedStarted;
  console.log(
    `Medusa seed total: ${(seedMs / 1000).toFixed(3)} s (${seedMs} ms).`,
  );

  return {
    product: "medusa",
    created: notes.length > 0,
    users: [{ email, role: "admin" }],
    notes:
      notes.length > 0
        ? notes.join(" ")
        : "Medusa seed already complete; no changes.",
  };
}

async function resolvePublishableKey(ctx: MedusaSeedContext): Promise<string> {
  if (ctx.cfg.publishableApiKey && ctx.cfg.publishableApiKey.trim() !== "") {
    return ctx.cfg.publishableApiKey.trim();
  }
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/api-keys?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/api-keys failed (HTTP ${response.status}).`,
    );
  }
  const keys = listItems<JsonRecord>(body, "api_keys");
  const publishable = keys.find(
    (entry) => entry.type === "publishable" && entry.revoked_at == null,
  );
  const token = publishable?.token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(
      "Medusa publishable API key not found after migrate. Run up() first.",
    );
  }
  return token.trim();
}

async function createGermanWarehouse(ctx: MedusaSeedContext): Promise<string> {
  const create = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    "/stock-locations",
    {
      name: MEDUSA_GERMAN_WAREHOUSE_NAME,
      address: {
        address_1: "Alexanderplatz 1",
        city: "Berlin",
        country_code: "de",
      },
    },
  );
  const created = await readJson(create);
  if (!create.ok) {
    throw new Error(
      `Medusa POST /admin/stock-locations failed (HTTP ${create.status}).`,
    );
  }
  const location = created?.stock_location as JsonRecord | undefined;
  const locationId = location?.id;
  if (typeof locationId !== "string") {
    throw new Error("Medusa German Warehouse create returned no id.");
  }
  return locationId;
}

export async function ensureGermanWarehouse(
  ctx: MedusaSeedContext,
  notes: string[],
): Promise<void> {
  const locations = await listStockLocations(ctx);
  const existing = locations.find(
    (row) => row.name === MEDUSA_GERMAN_WAREHOUSE_NAME,
  );
  let locationId: string;
  if (typeof existing?.id === "string") {
    locationId = existing.id;
    console.log(
      `${MEDUSA_GERMAN_WAREHOUSE_NAME} already present; checking its links.`,
    );
  } else {
    locationId = await createGermanWarehouse(ctx);
    notes.push("German Warehouse created.");
  }
  await ensureWarehouseSalesChannelLink(ctx, locationId, notes);
  await ensureWarehouseInventoryLevels(ctx, locationId, notes);
}

async function ensureWarehouseSalesChannelLink(
  ctx: MedusaSeedContext,
  locationId: string,
  notes: string[],
): Promise<void> {
  const channelId = await defaultSalesChannelId(ctx);
  const current = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    `/stock-locations/${locationId}?fields=*sales_channels`,
  );
  const currentBody = await readJson(current);
  if (!current.ok) {
    throw new Error(
      `Medusa GET /admin/stock-locations/${locationId} failed (HTTP ${current.status}).`,
    );
  }
  const location = currentBody?.stock_location as JsonRecord | undefined;
  const linkedChannels = Array.isArray(location?.sales_channels)
    ? (location.sales_channels as JsonRecord[])
    : [];
  if (linkedChannels.some((channel) => channel.id === channelId)) {
    console.log(
      `${MEDUSA_GERMAN_WAREHOUSE_NAME} already linked to the default sales channel; skipping.`,
    );
    return;
  }
  const link = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    `/stock-locations/${locationId}/sales-channels`,
    { add: [channelId] },
  );
  if (!link.ok && link.status !== 409) {
    throw new Error(
      `Medusa link stock location to sales channel failed (HTTP ${link.status}).`,
    );
  }
  notes.push("German Warehouse sales channel linked.");
}

async function ensureWarehouseInventoryLevels(
  ctx: MedusaSeedContext,
  locationId: string,
  notes: string[],
): Promise<void> {
  const inventoryItems = await listInventoryItems(ctx);
  let linked = 0;
  for (const item of inventoryItems) {
    const itemId = item.id;
    if (typeof itemId !== "string") {
      continue;
    }
    const levels = Array.isArray(item.location_levels)
      ? (item.location_levels as JsonRecord[])
      : [];
    if (levels.some((level) => level.location_id === locationId)) {
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
      throw new Error(
        `Medusa inventory level for ${itemId} failed (HTTP ${level.status}).`,
      );
    }
    if (level.ok) {
      linked += 1;
    }
  }
  if (linked === 0) {
    console.log(
      `${MEDUSA_GERMAN_WAREHOUSE_NAME} inventory levels already linked; skipping.`,
    );
    return;
  }
  notes.push("German Warehouse inventory levels linked.");
}

async function collectionProductIds(
  ctx: MedusaSeedContext,
  collectionId: string,
): Promise<Set<string>> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    `/products?collection_id=${collectionId}&limit=50&fields=id`,
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/products?collection_id failed (HTTP ${response.status}).`,
    );
  }
  return new Set(
    listItems<JsonRecord>(body, "products")
      .map((product) => product.id)
      .filter((id): id is string => typeof id === "string"),
  );
}

export async function ensureFeaturedCollection(
  ctx: MedusaSeedContext,
  notes: string[],
): Promise<void> {
  const collections = await listCollections(ctx);
  const existing = collections.find(
    (row) => row.title === MEDUSA_SEED_COLLECTION_TITLE,
  );
  const productIds = await seededProductIds(ctx);
  if (productIds.length === 0) {
    throw new Error(
      "Medusa seed expected four published products from migrate.",
    );
  }
  let collectionId: string;
  let linked = new Set<string>();
  const created = typeof existing?.id !== "string";
  if (typeof existing?.id === "string") {
    collectionId = existing.id;
    linked = await collectionProductIds(ctx, collectionId);
  } else {
    const create = await adminFetch(
      ctx.cfg.baseUrl,
      ctx.authorizationHeader,
      "POST",
      "/collections",
      {
        title: MEDUSA_SEED_COLLECTION_TITLE,
      },
    );
    const body = await readJson(create);
    if (!create.ok) {
      throw new Error(
        `Medusa POST /admin/collections failed (HTTP ${create.status}).`,
      );
    }
    const collection = body?.collection as JsonRecord | undefined;
    const newId = collection?.id;
    if (typeof newId !== "string") {
      throw new Error("Medusa collection create returned no id.");
    }
    collectionId = newId;
  }
  const missing = productIds.filter((id) => !linked.has(id));
  if (missing.length === 0) {
    console.log(
      `Collection ${MEDUSA_SEED_COLLECTION_TITLE} already has the seeded products; skipping.`,
    );
    return;
  }
  const attach = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    `/collections/${collectionId}/products`,
    { add: missing },
  );
  if (!attach.ok) {
    throw new Error(
      `Medusa attach products to collection failed (HTTP ${attach.status}).`,
    );
  }
  notes.push(
    created
      ? `Collection ${MEDUSA_SEED_COLLECTION_TITLE} created with four products.`
      : `Collection ${MEDUSA_SEED_COLLECTION_TITLE} linked ${missing.length} missing product(s).`,
  );
}

async function ensurePromoCode(
  ctx: MedusaSeedContext,
  notes: string[],
): Promise<void> {
  const promotions = await listPromotions(ctx);
  const existing = promotions.find(
    (row) => row.code === MEDUSA_SEED_PROMO_CODE,
  );
  if (existing?.id !== undefined) {
    console.log(
      `Promotion ${MEDUSA_SEED_PROMO_CODE} already present; skipping create.`,
    );
    return;
  }
  const create = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    "/promotions",
    {
      code: MEDUSA_SEED_PROMO_CODE,
      type: "standard",
      status: "active",
      application_method: {
        type: "percentage",
        target_type: "order",
        value: 10,
        currency_code: "eur",
      },
    },
  );
  if (!create.ok) {
    const body = await readJson(create);
    throw new Error(
      `Medusa POST /admin/promotions failed (HTTP ${create.status}). ${JSON.stringify(body?.message ?? body)}`,
    );
  }
  notes.push(`Promotion ${MEDUSA_SEED_PROMO_CODE} created (10%).`);
}

/**
 * Creates the storefront customer through the store auth flow, so the password can log in.
 * Returns the register token, or undefined when the auth identity already exists.
 * Never logs the password or the token.
 */
async function registerStoreCustomer(
  ctx: MedusaSeedContext,
  email: string,
  password: string,
): Promise<string | undefined> {
  const url = `${ctx.cfg.baseUrl.replace(/\/$/, "")}/auth/customer/emailpass/register`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(response);
  if (response.ok) {
    const token = body?.token;
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error(
        `Medusa POST /auth/customer/emailpass/register returned no token (HTTP ${response.status}).`,
      );
    }
    return token;
  }
  if (/already exists/i.test(JSON.stringify(body ?? {}))) {
    return undefined;
  }
  throw new Error(
    `Medusa POST /auth/customer/emailpass/register failed (HTTP ${response.status}).`,
  );
}

/** Logs in an existing customer identity. Never logs the password or the token. */
async function loginStoreCustomer(
  ctx: MedusaSeedContext,
  email: string,
  password: string,
): Promise<string> {
  const url = `${ctx.cfg.baseUrl.replace(/\/$/, "")}/auth/customer/emailpass`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(response);
  const token = body?.token;
  if (!response.ok || typeof token !== "string" || token.trim() === "") {
    throw new Error(
      `Medusa POST /auth/customer/emailpass failed (HTTP ${response.status}). ` +
        "The existing customer identity may use a different password than MEDUSA_SEED_CUSTOMER_PASSWORD.",
    );
  }
  return token;
}

/** `actor_id` from the JWT payload. Empty when the identity has no customer profile yet. */
export function customerActorId(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { actor_id?: unknown };
    return typeof parsed.actor_id === "string" && parsed.actor_id !== ""
      ? parsed.actor_id
      : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureCustomer(
  ctx: MedusaSeedContext,
  notes: string[],
  publishableKey: string,
): Promise<void> {
  const customerEmail =
    process.env.MEDUSA_SEED_CUSTOMER_EMAIL?.trim() ||
    MEDUSA_DEFAULT_CUSTOMER_EMAIL;
  const customerPassword =
    process.env.MEDUSA_SEED_CUSTOMER_PASSWORD?.trim() ||
    MEDUSA_DEFAULT_CUSTOMER_PASSWORD;
  const customers = await listCustomers(ctx);
  if (customers.some((row) => row.email === customerEmail)) {
    console.log(`Customer ${customerEmail} already present; skipping create.`);
    return;
  }
  let token = await registerStoreCustomer(ctx, customerEmail, customerPassword);
  if (token === undefined) {
    token = await loginStoreCustomer(ctx, customerEmail, customerPassword);
    if (customerActorId(token) !== undefined) {
      console.log(
        `Customer ${customerEmail} already registered with a profile; skipping create.`,
      );
      return;
    }
    console.log(
      `Customer ${customerEmail} identity exists without a profile; creating the profile.`,
    );
  }
  const url = `${ctx.cfg.baseUrl.replace(/\/$/, "")}/store/customers`;
  const create = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-publishable-api-key": publishableKey,
    },
    body: JSON.stringify({
      email: customerEmail,
      first_name: "QA",
      last_name: "Customer",
    }),
  });
  if (!create.ok) {
    throw new Error(
      `Medusa POST /store/customers failed (HTTP ${create.status}).`,
    );
  }
  notes.push(`Customer ${customerEmail} created.`);
}

async function ensureUsRegion(
  ctx: MedusaSeedContext,
  notes: string[],
): Promise<void> {
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
  const create = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    "/regions",
    {
      name: MEDUSA_US_REGION_NAME,
      currency_code: "usd",
      countries: ["us"],
    },
  );
  if (!create.ok) {
    const body = await readJson(create);
    throw new Error(
      `Medusa POST /admin/regions failed (HTTP ${create.status}). ${JSON.stringify(body?.message ?? body)}`,
    );
  }
  notes.push(`${MEDUSA_US_REGION_NAME} region created.`);
}

async function ensureStripeOnEurope(
  ctx: MedusaSeedContext,
  notes: string[],
): Promise<void> {
  const regions = await listRegions(ctx);
  const europe = regions.find((row) => row.currency_code === "eur");
  const regionId = europe?.id;
  if (typeof regionId !== "string") {
    throw new Error(
      "Medusa Europe region not found for Stripe provider enable.",
    );
  }
  const providers = Array.isArray(europe?.payment_providers)
    ? europe.payment_providers
    : [];
  const ids = providers
    .map((entry) => (entry as JsonRecord).id)
    .filter((id): id is string => typeof id === "string");
  if (ids.includes(MEDUSA_STRIPE_PROVIDER_ID)) {
    console.log(
      `${MEDUSA_STRIPE_PROVIDER_ID} already enabled on Europe; skipping.`,
    );
    return;
  }
  const update = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "POST",
    `/regions/${regionId}`,
    {
      payment_providers: [...ids, MEDUSA_STRIPE_PROVIDER_ID],
    },
  );
  if (!update.ok) {
    throw new Error(
      `Medusa enable ${MEDUSA_STRIPE_PROVIDER_ID} on Europe failed (HTTP ${update.status}).`,
    );
  }
  notes.push(`${MEDUSA_STRIPE_PROVIDER_ID} enabled on Europe.`);
}

async function defaultSalesChannelId(ctx: MedusaSeedContext): Promise<string> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/sales-channels?limit=20",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/sales-channels failed (HTTP ${response.status}).`,
    );
  }
  const channels = listItems<JsonRecord>(body, "sales_channels");
  const id = channels[0]?.id;
  if (typeof id !== "string") {
    throw new Error("Medusa default sales channel not found.");
  }
  return id;
}

async function listStockLocations(
  ctx: MedusaSeedContext,
): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/stock-locations?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/stock-locations failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "stock_locations");
}

async function listInventoryItems(
  ctx: MedusaSeedContext,
): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/inventory-items?limit=100&fields=id,*location_levels",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/inventory-items failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "inventory_items");
}

async function listCollections(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/collections?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/collections failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "collections");
}

async function listPromotions(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/promotions?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/promotions failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "promotions");
}

async function listCustomers(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/customers?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/customers failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "customers");
}

async function listRegions(ctx: MedusaSeedContext): Promise<JsonRecord[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/regions?limit=50",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/regions failed (HTTP ${response.status}).`,
    );
  }
  return listItems(body, "regions");
}

async function seededProductIds(ctx: MedusaSeedContext): Promise<string[]> {
  const response = await adminFetch(
    ctx.cfg.baseUrl,
    ctx.authorizationHeader,
    "GET",
    "/products?limit=20",
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Medusa GET /admin/products failed (HTTP ${response.status}).`,
    );
  }
  const products = listItems<JsonRecord>(body, "products");
  return products
    .map((product) => product.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, 4);
}
