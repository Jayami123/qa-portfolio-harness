import path from "node:path";

/**
 * Pure helpers for finding leftover Medusa listeners. No process is started or killed here.
 */

/** Pids in a `netstat -ano` table that are LISTENING on `port` (IPv4 or IPv6 local address). */
export function parseNetstatListeningPids(
  output: string,
  port: number | string,
): number[] {
  const pids = new Set<number>();
  const pattern = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/;
  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match && match[1] === String(port)) {
      pids.add(Number(match[2]));
    }
  }
  return [...pids];
}

/** Pids from `lsof -ti` or `pgrep` output: one pid per line. */
export function parseLsofPids(output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const value = Number(line.trim());
    if (Number.isSafeInteger(value) && value > 0) {
      pids.add(value);
    }
  }
  return [...pids];
}

/** Splits a command line into arguments. Double quotes group; backslashes stay literal (Windows paths). */
export function parseCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started) {
    args.push(current);
  }
  return args;
}

export type HarnessLauncherKind = "backend" | "storefront";

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function isUnder(candidate: string, directory: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function isAbsolutePath(normalized: string): boolean {
  return normalized.startsWith("/") || /^[a-z]:\//.test(normalized);
}

// Node flags that consume the next argument; their value is not the launch script.
const NODE_VALUE_FLAGS = new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "--conditions",
  "-C",
]);
// With these there is no script file to own.
const NODE_EVAL_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);

/** The first argument after `node` that is not a node flag, plus the arguments after it. */
function launchScript(
  argv: readonly string[],
): { script: string; args: string[] } | undefined {
  const exe = argv[0];
  if (exe === undefined) {
    return undefined;
  }
  const exeName = normalizePath(exe).split("/").pop() ?? "";
  if (!/^node(\.exe)?$/.test(exeName)) {
    return undefined;
  }
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (NODE_EVAL_FLAGS.has(arg)) {
      return undefined;
    }
    if (NODE_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return { script: arg, args: argv.slice(i + 1) };
  }
  return undefined;
}

/**
 * Decides whether a process was launched through one of the exact entry points the harness spawns:
 *   backend:    node <product>/**\/node_modules/@medusajs/cli/cli.js start   (or a script under apps/backend/.medusa/server)
 *   storefront: node <product>/**\/node_modules/next/dist/bin/next start ...
 * Only the launch script counts. A product path in a later argument (a flag value) never matches.
 *
 * `cwd` is optional (Linux, from /proc/<pid>/cwd). It lets a relative launch script resolve, and then
 * only when the cwd is inside apps/backend or apps/storefront.
 */
export function classifyHarnessLauncher(
  argv: readonly string[],
  productRoot: string,
  cwd?: string,
): HarnessLauncherKind | undefined {
  const root = normalizePath(productRoot);
  if (root === "") {
    return undefined;
  }
  const launch = launchScript(argv);
  if (launch === undefined) {
    return undefined;
  }
  const script = normalizePath(launch.script);
  let resolved: string;
  if (isAbsolutePath(script)) {
    resolved = script;
  } else {
    if (cwd === undefined || cwd.trim() === "") {
      return undefined;
    }
    const workingDir = normalizePath(cwd);
    if (
      !isUnder(workingDir, `${root}/apps/backend`) &&
      !isUnder(workingDir, `${root}/apps/storefront`)
    ) {
      return undefined;
    }
    resolved = path.posix.normalize(`${workingDir}/${script}`);
  }
  if (!isUnder(resolved, root)) {
    return undefined;
  }
  const hasStart = launch.args.includes("start");
  if (hasStart && resolved.endsWith("/node_modules/next/dist/bin/next")) {
    return "storefront";
  }
  if (hasStart && resolved.endsWith("/node_modules/@medusajs/cli/cli.js")) {
    return "backend";
  }
  if (isUnder(resolved, `${root}/apps/backend/.medusa/server`)) {
    return "backend";
  }
  return undefined;
}

/**
 * Every descendant of `pid`, deepest first (ties keep discovery order). `pid` itself is not included.
 * `childrenOf` is injected so the walk needs no process table.
 */
export function collectDescendants(
  pid: number,
  childrenOf: (parent: number) => number[],
): number[] {
  const seen = new Set<number>([pid]);
  const found: Array<{ pid: number; depth: number }> = [];
  let level = [pid];
  for (let depth = 1; level.length > 0; depth += 1) {
    const next: number[] = [];
    for (const parent of level) {
      for (const child of childrenOf(parent)) {
        if (!seen.has(child)) {
          seen.add(child);
          found.push({ pid: child, depth });
          next.push(child);
        }
      }
    }
    level = next;
  }
  return found.sort((a, b) => b.depth - a.depth).map((entry) => entry.pid);
}
