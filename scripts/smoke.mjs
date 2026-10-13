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
  - Docker Desktop is not running (validation Postgres / Redis / MinIO)
  - Medusa store process may not be started by the harness; confirm your starter on port 9000
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
