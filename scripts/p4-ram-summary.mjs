// Builds the RAM probe report from the samples that scripts/p4-ram-probe.sh wrote, and prints it as JSON on stdout.
// Reads evidence/ram-samples.tsv (epoch-seconds, container, MemUsage), evidence/ram-host.tsv (host, used MB) and
// evidence/.disk (free GiB). Only containers named qa-harness-* count. The budget is the committed RAM_BUDGET_MIB;
// P4_RAM_BUDGET_MIB overrides it for an explicit experiment only.
//
//   node scripts/p4-ram-summary.mjs <product>... --ready-ms <n>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HARNESS_ROOT } from "./lib.mjs";

const args = process.argv.slice(2);
const readyIndex = args.indexOf("--ready-ms");
const readyMs = readyIndex === -1 ? undefined : Number(args[readyIndex + 1]);
const products = args.filter((a, i) => !a.startsWith("--") && (readyIndex === -1 || (i !== readyIndex && i !== readyIndex + 1)));

const evidence = path.join(HARNESS_ROOT, "evidence");
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : []);

const { summarize, parseMemUsageMiB, RAM_BUDGET_MIB } = await import(pathToFileURL(path.join(HARNESS_ROOT, "dist", "adapters", "p4-ram.js")).href);

const samples = readLines(path.join(evidence, "ram-samples.tsv"))
  .map((line) => line.split("\t"))
  .filter(([, name]) => typeof name === "string" && name.startsWith("qa-harness-"))
  .map(([t, container, mem]) => ({ t: Number(t), container, mib: parseMemUsageMiB(mem ?? "") }));

const hostPeak = readLines(path.join(evidence, "ram-host.tsv"))
  .map((line) => Number(line.split("\t")[1]))
  .filter((n) => Number.isFinite(n))
  .reduce((max, n) => Math.max(max, n), 0);
const hostSamples = readLines(path.join(evidence, "ram-host.tsv")).length;

const diskRaw = fs.existsSync(path.join(evidence, ".disk")) ? fs.readFileSync(path.join(evidence, ".disk"), "utf8").trim() : "";
const diskFreeGiB = diskRaw === "" ? undefined : Number(diskRaw);

const budgetOverride = process.env.P4_RAM_BUDGET_MIB ? Number(process.env.P4_RAM_BUDGET_MIB) : undefined;
const report = summarize(samples, {
  products,
  budgetMiB: budgetOverride ?? RAM_BUDGET_MIB,
  hostUsedPeakMiB: hostSamples > 0 ? hostPeak : undefined,
  diskFreeGiB: Number.isFinite(diskFreeGiB) ? diskFreeGiB : undefined,
  readyMs: Number.isFinite(readyMs) ? readyMs : undefined,
});

console.log(JSON.stringify(report, null, 2));
