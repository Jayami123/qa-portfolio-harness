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
  console.log("\n→ waitHealthy");
  await adapter.waitHealthy(process.env.SMOKE_TIMEOUT_MS ? Number(process.env.SMOKE_TIMEOUT_MS) : 60_000);
} catch (error) {
  console.error(`\nwaitHealthy failed: ${error instanceof Error ? error.message : error}`);
  console.error(`
The ${id} app does not look reachable at ${adapter.baseUrl}.

Start it first:
  node scripts/up.mjs ${id}
  # then follow the printed app-process instructions (Cal: yarn dx && yarn dev)

Config-only check (no running app):
  npm run smoke -- ${id} --dry-run
`);
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
