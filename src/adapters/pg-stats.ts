import { harnessComposeFile } from "../internal/compose.js";
import { runCapture } from "../internal/run.js";

export type PgStatsProduct = "medusa" | "documenso" | "twenty" | "cal";

/** True only when HARNESS_PG_STATS is exactly "1". Anything else (true, yes, blank, empty) is off. */
export function pgStatsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.HARNESS_PG_STATS === "1";
}

/** Names of the opt-in overlay files for a product, relative to the harness docker folder, or [] when the flag is off.
 *  Pass each name through harnessComposeFile, as every other harness compose file is. */
export function pgStatsComposeFiles(opts: {
  env: NodeJS.ProcessEnv;
  product: PgStatsProduct;
}): string[] {
  if (!pgStatsEnabled(opts.env)) {
    return [];
  }
  return [`${opts.product}.pg-stats.compose.yml`];
}

/** The same overlay files as absolute compose paths, for adapters whose compose lists are absolute. */
export function pgStatsComposeFilePaths(opts: {
  env: NodeJS.ProcessEnv;
  product: PgStatsProduct;
}): string[] {
  return pgStatsComposeFiles(opts).map((name) => harnessComposeFile(name));
}

export interface PgStatsExec {
  project: string; // compose project name, e.g. qa-harness-medusa
  files: string[]; // absolute compose -f list the product already uses, plus the overlay
  service: string; // Postgres service name in those files (fork value for cal and twenty)
  user: string; // superuser role of that service
  db: string; // database created by that service
  cwd: string;
}

export type PgStatsRun = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

const EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS pg_stat_statements";
const ERROR_EXCERPT_CHARS = 400;

/** Runs once after the product is healthy: psql with ON_ERROR_STOP=1 creates the extension in the product's database.
 *  Throws `HARNESS_PG_STATS: CREATE EXTENSION pg_stat_statements failed: <first 400 chars of psql stderr>`. No retry. */
export async function createPgStatsExtension(opts: PgStatsExec, run: PgStatsRun): Promise<void> {
  const args = [
    "compose",
    "-p",
    opts.project,
    ...opts.files.flatMap((file) => ["-f", file]),
    "exec",
    "-T",
    opts.service,
    "psql",
    "-U",
    opts.user,
    "-d",
    opts.db,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    EXTENSION_SQL,
  ];
  try {
    await run("docker", args, opts.cwd);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `HARNESS_PG_STATS: CREATE EXTENSION pg_stat_statements failed: ${detail.slice(0, ERROR_EXCERPT_CHARS)}`,
    );
  }
}

/** The adapters' runner: docker through runCapture, so psql's stderr reaches the thrown message. */
export function enablePgStatsExtension(opts: PgStatsExec): Promise<void> {
  return createPgStatsExtension(opts, (cmd, args, cwd) => runCapture(cmd, args, { cwd }));
}
