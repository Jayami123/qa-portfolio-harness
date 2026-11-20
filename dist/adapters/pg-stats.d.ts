export type PgStatsProduct = "medusa" | "documenso" | "twenty" | "cal";
/** True only when HARNESS_PG_STATS is exactly "1". Anything else (true, yes, blank, empty) is off. */
export declare function pgStatsEnabled(env: NodeJS.ProcessEnv): boolean;
/** Names of the opt-in overlay files for a product, relative to the harness docker folder, or [] when the flag is off.
 *  Pass each name through harnessComposeFile, as every other harness compose file is. */
export declare function pgStatsComposeFiles(opts: {
    env: NodeJS.ProcessEnv;
    product: PgStatsProduct;
}): string[];
/** The same overlay files as absolute compose paths, for adapters whose compose lists are absolute. */
export declare function pgStatsComposeFilePaths(opts: {
    env: NodeJS.ProcessEnv;
    product: PgStatsProduct;
}): string[];
export interface PgStatsExec {
    project: string;
    files: string[];
    service: string;
    user: string;
    db: string;
    cwd: string;
}
export type PgStatsRun = (cmd: string, args: string[], cwd: string) => Promise<{
    stdout: string;
    stderr: string;
}>;
/** Runs once after the product is healthy: psql with ON_ERROR_STOP=1 creates the extension in the product's database.
 *  Throws `HARNESS_PG_STATS: CREATE EXTENSION pg_stat_statements failed: <first 400 chars of psql stderr>`. No retry. */
export declare function createPgStatsExtension(opts: PgStatsExec, run: PgStatsRun): Promise<void>;
/** The adapters' runner: docker through runCapture, so psql's stderr reaches the thrown message. */
export declare function enablePgStatsExtension(opts: PgStatsExec): Promise<void>;
//# sourceMappingURL=pg-stats.d.ts.map