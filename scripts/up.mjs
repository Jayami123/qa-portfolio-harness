import { loadHarness, parseProductId } from "./lib.mjs";

const id = parseProductId(process.argv.slice(2));
const { getAdapter } = await loadHarness();
const adapter = getAdapter(id);
await adapter.up();
