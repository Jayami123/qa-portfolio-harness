// Builds the RAM probe report from the samples that scripts/p4-ram-probe.sh wrote, and prints it as JSON on stdout.
// Reads evidence/ram-samples.tsv (epoch-seconds, container, MemUsage), evidence/ram-host.tsv (host, used MB) and
// evidence/.disk (free GiB). Only containers named qa-harness-* count. The budget is the committed RAM_BUDGET_MIB;
// P4_RAM_BUDGET_MIB overrides it for an explicit experiment only.
//
//   node scripts/p4-ram-summary.mjs <product>... --ready-ms <n> --readiness ok|failed [--failed-product <id>]
//                                  --bind ok|failed [--bind-offending "<ports>"]
//
// The report always includes `readiness`, `bindCheck` and `overallPass`. overallPass is true only when readiness passed,
// the binds are loopback-only, and the RAM fits the budget. Flag values are read as values, never as product names.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HARNESS_ROOT } from "./lib.mjs";

const FLAGS = new Set(["--ready-ms", "--readiness", "--failed-product", "--bind", "--bind-offending"]);
const flags = {};
const products = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (FLAGS.has(arg)) {
    flags[arg] = argv[i + 1] ?? "";
    i += 1;
  } else if (arg.startsWith("--")) {
    console.error(`unknown flag: ${arg}`);
    process.exit(2);
  } else {
    products.push(arg);
  }
}
const readyMs = flags["--ready-ms"] === undefined ? undefined : Number(flags["--ready-ms"]);
const readiness = flags["--readiness"] === "ok" ? "ok" : "failed";
const failedProduct = flags["--failed-product"] ?? "";
const bindStatus = flags["--bind"] === "ok" ? "ok" : "failed";
const bindOffending = (flags["--bind-offending"] ?? "").split(/\s+/).filter(Boolean);

const evidence = path.join(HARNESS_ROOT, "evidence");
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : []);

const { summarize, parseMemUsageMiB, RAM_BUDGET_MIB } = await import(
  pathToFileURL(path.join(HARNESS_ROOT, "dist", "adapters", "p4-ram.js")).href
);

const samples = readLines(path.join(evidence, "ram-samples.tsv"))
  .map((line) => line.split("\t"))
  .filter(([, name]) => typeof name === "string" && name.startsWith("qa-harness-"))
  .map(([t, container, mem]) => ({ t: Number(t), container, mib: parseMemUsageMiB(mem ?? "") }));

const hostLines = readLines(path.join(evidence, "ram-host.tsv"));
const hostPeak = hostLines
  .map((line) => Number(line.split("\t")[1]))
  .filter((n) => Number.isFinite(n))
  .reduce((max, n) => Math.max(max, n), 0);

const diskBefore = fs.existsSync(path.join(evidence, ".disk_before"))
  ? Number(fs.readFileSync(path.join(evidence, ".disk_before"), "utf8").trim())
  : undefined;
const diskAfter = fs.existsSync(path.join(evidence, ".disk"))
  ? Number(fs.readFileSync(path.join(evidence, ".disk"), "utf8").trim())
  : undefined;

const budgetOverride = process.env.P4_RAM_BUDGET_MIB ? Number(process.env.P4_RAM_BUDGET_MIB) : undefined;
const report = summarize(samples, {
  products,
  budgetMiB: budgetOverride ?? RAM_BUDGET_MIB,
  hostUsedPeakMiB: hostLines.length > 0 ? hostPeak : undefined,
  diskFreeGiB: Number.isFinite(diskAfter) ? diskAfter : undefined,
  readyMs: Number.isFinite(readyMs) ? readyMs : undefined,
});

const out = {
  ...report,
  diskFreeBeforeGiB: Number.isFinite(diskBefore) ? diskBefore : null,
  diskFreeAfterGiB: Number.isFinite(diskAfter) ? diskAfter : null,
  readiness: {
    status: readiness,
    failedProduct: readiness === "ok" ? null : failedProduct || "unknown",
  },
  bindCheck: {
    status: bindStatus,
    offendingPorts: bindOffending,
  },
  overallPass: readiness === "ok" && bindStatus === "ok" && report.fit === true,
};

console.log(JSON.stringify(out, null, 2));
