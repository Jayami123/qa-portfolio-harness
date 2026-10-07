import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT_IDS = ["cal", "documenso", "medusa", "twenty"];

export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadHarness() {
  const dist = path.join(HARNESS_ROOT, "dist", "index.js");
  if (!existsSync(dist)) {
    console.error("dist/ is missing. Run `npm run build` first.");
    process.exit(1);
  }
  return import(pathToFileUrl(dist));
}

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath).replaceAll("\\", "/");
  return resolved.startsWith("/") ? `file://${resolved}` : `file:///${resolved}`;
}

export function parseProductId(argv) {
  const id = argv.find((arg) => PRODUCT_IDS.includes(arg));
  if (!id) {
    console.error(`Usage: node scripts/${path.basename(process.argv[1])} <${PRODUCT_IDS.join("|")}> [--dry-run]`);
    process.exit(1);
  }
  return id;
}

export function redactSecret(value, keepStart = 8, keepEnd = 4) {
  if (!value) return "(empty)";
  if (value.length <= keepStart + keepEnd) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, keepStart)}…${value.slice(-keepEnd)}`;
}
