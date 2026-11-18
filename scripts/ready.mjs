// Readiness probe for the P4 products (ADR 0006). For each product: waits for app health, then, where the adapter has
// an MCP endpoint, waits for a real initialize + tools/list. Prints one line per product. Exits 1 if any product is not
// ready. It never prints a credential: error messages come from the adapters and name the product and URL only.
//
//   node scripts/ready.mjs nextcloud outline penpot mattermost twenty
import { loadHarness, PRODUCT_IDS } from "./lib.mjs";

const products = process.argv.slice(2);
if (products.length === 0) {
  console.error(`Usage: node scripts/ready.mjs <${PRODUCT_IDS.join("|")}>...`);
  process.exit(2);
}

const { getAdapter } = await loadHarness();
let failed = false;

for (const id of products) {
  const started = Date.now();
  try {
    const adapter = getAdapter(id);
    await adapter.waitHealthy();
    if (typeof adapter.waitMcp === "function") {
      const mcp = await adapter.waitMcp();
      console.log(`ready ${id} health=ok mcp=ok tools=${mcp.toolCount} in ${Date.now() - started} ms`);
    } else {
      console.log(`ready ${id} health=ok mcp=n/a in ${Date.now() - started} ms`);
    }
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`not ready ${id}: ${message.slice(0, 400)}`);
  }
}

process.exit(failed ? 1 : 0);
