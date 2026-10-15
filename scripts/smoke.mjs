import { loadHarness, parseProductId, redactSecret } from "./lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.SMOKE_DRY_RUN === "1";
const id = parseProductId(args);

const { getAdapter, createPgClient } = await loadHarness();
const adapter = getAdapter(id);

function printConfig() {
  console.log("product     ", adapter.id);
  console.log("productRoot ", adapter.productRoot);
  console.log("baseUrl     ", adapter.baseUrl);
  console.log("dbUrl       ", redactDbUrl(adapter.dbUrl));
}

function smokeReachHints(productId, adapter) {
  const footer = `
Config-only check (no running app):
  npm run smoke -- ${productId} --dry-run
`;
  switch (productId) {
    case "twenty":
      return `
Could not reach ${productId} at ${adapter.baseUrl}.

Typical causes:
  - Docker Desktop is not running (Twenty runs entirely in Docker)
  - First boot can take several minutes (image pull, migrations, seed); wait for GET /healthz HTTP 200
  - Inspect the server: docker logs qa-harness-twenty-server-1
${footer}`;
    case "documenso":
      return `
Could not reach ${productId} at ${adapter.baseUrl}.

Typical causes:
  - Docker Desktop is not running (Postgres / Inbucket)
  - Node 24+ required; first build/start can take a long time on 127.0.0.1:3001
  - Web start skipped: unset DOCUMENSO_SKIP_WEB_START, or start Remix yourself
${footer}`;
    case "medusa":
      return `
Could not reach ${productId} at ${adapter.baseUrl}.

Typical causes:
  - Docker Desktop is not running (harness Postgres on 127.0.0.1:5433; Redis only when MEDUSA_REDIS=1)
  - Set MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in harness .env for seed/authenticate
  - First boot: pnpm install in medusa-dtc-starter; medusa build can take several minutes
${footer}`;
    case "cal":
    default:
      return `
Could not reach ${productId} at ${adapter.baseUrl}.

Typical causes:
  - Docker Desktop is not running (needed for Postgres)
  - First-time Cal install: cd ${adapter.productRoot} && yarn && copy .env.example to .env
  - Web start skipped: unset CAL_SKIP_WEB_START, or start Cal yourself
  - Windows: Cal Turbopack crashes; harness uses next dev --webpack (set CAL_WEB_BUNDLER=turbopack to override)
${footer}`;
  }
}

async function verifyMedusaStorefront(adapter, createPgClient) {
  const backend = (process.env.MEDUSA_BASE_URL || "http://127.0.0.1:9000").replace(/\/$/, "");
  const storefront = (process.env.MEDUSA_STOREFRONT_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const timeoutMs = 30_000;

  const health = await fetch(`${backend}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const healthBody = await health.text();
  if (health.status !== 200 || healthBody.trim() !== "OK") {
    throw new Error(
      `Medusa GET /health expected HTTP 200 body OK; got HTTP ${health.status} body ${healthBody.slice(0, 80)}.`,
    );
  }
  console.log("Medusa GET /health HTTP 200, body OK");

  const pool = createPgClient(adapter.dbUrl);
  let publishableKey;
  try {
    const result = await pool.query(
      `SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    );
    publishableKey = result.rows[0]?.token;
  } finally {
    await pool.end();
  }
  if (!publishableKey || typeof publishableKey !== "string") {
    throw new Error("Medusa storefront checks need a publishable API key in Postgres.");
  }
  const storeHeaders = { "x-publishable-api-key": publishableKey };
  const collectionsRes = await fetch(`${backend}/store/collections?limit=20`, {
    headers: storeHeaders,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const collectionsBody = await collectionsRes.json().catch(() => undefined);
  if (!collectionsRes.ok) {
    throw new Error(`Medusa GET /store/collections expected HTTP 200; got HTTP ${collectionsRes.status}.`);
  }
  const featured = (collectionsBody?.collections ?? []).find((row) => row?.title === "Featured");
  if (!featured?.id) {
    throw new Error("Medusa GET /store/collections HTTP 200 but Featured collection missing (run seed()).");
  }
  const productsRes = await fetch(
    `${backend}/store/products?collection_id=${encodeURIComponent(featured.id)}&limit=20`,
    { headers: storeHeaders, signal: AbortSignal.timeout(timeoutMs) },
  );
  const productsBody = await productsRes.json().catch(() => undefined);
  if (!productsRes.ok) {
    throw new Error(`Medusa GET /store/products?collection_id=… expected HTTP 200; got HTTP ${productsRes.status}.`);
  }
  const productCount = productsBody?.count ?? productsBody?.products?.length ?? 0;
  if (productCount < 4) {
    throw new Error(`Medusa Featured collection expected 4 products; got ${productCount}.`);
  }
  console.log("Medusa GET /store/collections HTTP 200 with Featured (4 products via store API)");

  const homeUrl = `${storefront}/dk`;
  const home = await fetch(homeUrl, { signal: AbortSignal.timeout(timeoutMs) });
  const homeHtml = await home.text();
  if (home.status !== 200) {
    throw new Error(`Medusa storefront GET /dk expected HTTP 200; got HTTP ${home.status} (${homeUrl}).`);
  }
  if (homeHtml.includes("Featured") && homeHtml.includes("Medusa T-Shirt")) {
    console.log("Medusa storefront GET /dk HTTP 200 with Featured rail in HTML");
  } else {
    console.log(
      "Medusa storefront GET /dk HTTP 200 (Featured rail not in HTML; starter listCollections uses force-cache — store API oracle above).",
    );
  }

  const productUrl = `${storefront}/dk/products/t-shirt`;
  const product = await fetch(productUrl, { signal: AbortSignal.timeout(timeoutMs) });
  const productHtml = await product.text();
  if (product.status !== 200) {
    throw new Error(`Medusa storefront GET /dk/products/t-shirt expected HTTP 200; got HTTP ${product.status}.`);
  }
  if (!productHtml.includes("Medusa T-Shirt")) {
    throw new Error("Medusa storefront GET /dk/products/t-shirt HTTP 200 but product title missing from HTML.");
  }
  console.log("Medusa storefront GET /dk/products/t-shirt HTTP 200");
}

function redactDbUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "(unparseable)";
  }
}

if (dryRun) {
  console.log("smoke dry-run (no HTTP / seed / auth / postgres)");
  printConfig();
  console.log(`
To run a live smoke against ${id}:
  1. Copy .env.example → .env
  2. node scripts/up.mjs ${id}
  3. Start the app process if the adapter printed extra steps
  4. npm run smoke -- ${id}
`);
  process.exit(0);
}

printConfig();

const medusaDeferStorefront = id === "medusa";
if (medusaDeferStorefront) {
  process.env.MEDUSA_SKIP_STOREFRONT = "1";
}

try {
  console.log("\n→ up");
  await adapter.up();
  console.log("→ waitHealthy");
  await adapter.waitHealthy(process.env.SMOKE_TIMEOUT_MS ? Number(process.env.SMOKE_TIMEOUT_MS) : 180_000);
} catch (error) {
  console.error(`\nwaitHealthy failed: ${error instanceof Error ? error.message : error}`);
  console.error(smokeReachHints(id, adapter));
  process.exit(1);
}

try {
  console.log("→ seed");
  const seeded = await adapter.seed();
  console.log("seed users:", seeded.users.map((u) => u.email).join(", ") || "(none)");
  if (seeded.notes) console.log("seed notes:", seeded.notes);

  console.log("→ authenticate");
  const session = await adapter.authenticate();
  console.log("session", {
    product: session.product,
    baseUrl: session.baseUrl,
    authorizationHeader: redactSecret(session.authorizationHeader),
    storageStatePath: session.storageStatePath,
  });

  console.log("→ proveAuth (Bearer against an authenticated route, not public /health)");
  await adapter.proveAuth(session);

  if (medusaDeferStorefront) {
    delete process.env.MEDUSA_SKIP_STOREFRONT;
    console.log("→ medusa storefront (after seed, before HTTP checks)");
    if (typeof adapter.startStorefrontAfterSeed !== "function") {
      throw new Error("Medusa adapter is missing startStorefrontAfterSeed().");
    }
    await adapter.startStorefrontAfterSeed();
    console.log("→ medusa storefront checks");
    await verifyMedusaStorefront(adapter, createPgClient);
  }

  console.log("→ postgres SELECT 1");
  const pool = createPgClient(adapter.dbUrl);
  try {
    const result = await pool.query("SELECT 1 AS ok");
    console.log("pg", result.rows[0]);
  } finally {
    await pool.end();
  }

  console.log("\nsmoke ok");
  process.exit(0);
} catch (error) {
  console.error(`\nsmoke failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
