/**
 * Pure helpers for finding leftover Medusa listeners. No process is started or killed here.
 */
/** Pids in a `netstat -ano` table that are LISTENING on `port` (IPv4 or IPv6 local address). */
export declare function parseNetstatListeningPids(output: string, port: number | string): number[];
/** Pids from `lsof -ti` or `pgrep` output: one pid per line. */
export declare function parseLsofPids(output: string): number[];
/** Simple splitter for `ps` output: double quotes group, backslashes stay literal. Not for Windows command lines. */
export declare function parseCommandLine(line: string): string[];
/**
 * Splits a Windows command line the way CommandLineToArgvW does (the CIM `CommandLine` of a process):
 *   - 2n backslashes then `"`: n backslashes, and the quote toggles quoting.
 *   - 2n+1 backslashes then `"`: n backslashes and a literal `"`.
 *   - backslashes not followed by `"` stay literal.
 *   - `""` inside quotes is a literal `"`.
 *   - whitespace outside quotes ends an argument.
 */
export declare function parseWindowsCommandLine(line: string): string[];
export type HarnessLauncherKind = "backend" | "storefront";
/**
 * Decides whether a process was launched through one of the exact entry points the harness spawns:
 *   backend:    node <product>/**\/node_modules/@medusajs/cli/cli.js start   (or a script under apps/backend/.medusa/server)
 *   storefront: node <product>/**\/node_modules/next/dist/bin/next start ...
 * Only the launch script counts. A product path in a later argument (a flag value) never matches.
 *
 * `cwd` is optional (Linux, from /proc/<pid>/cwd). It lets a relative launch script resolve, and then
 * only when the cwd is inside apps/backend or apps/storefront.
 */
export declare function classifyHarnessLauncher(argv: readonly string[], productRoot: string, cwd?: string): HarnessLauncherKind | undefined;
/**
 * Every descendant of `pid`, deepest first (ties keep discovery order). `pid` itself is not included.
 * `childrenOf` is injected so the walk needs no process table.
 */
export declare function collectDescendants(pid: number, childrenOf: (parent: number) => number[]): number[];
//# sourceMappingURL=medusa-listeners.d.ts.map