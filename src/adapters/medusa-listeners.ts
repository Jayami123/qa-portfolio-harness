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

/** Pids from `lsof -ti` output: one pid per line. */
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

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * True when the command line contains the product root as a whole path segment.
 * `medusa-dtc-starter-old` does not match `medusa-dtc-starter`. Empty input never matches.
 */
export function commandLineMatchesProductRoot(
  commandLine: string | undefined,
  productRoot: string,
): boolean {
  if (
    commandLine === undefined ||
    commandLine.trim() === "" ||
    productRoot.trim() === ""
  ) {
    return false;
  }
  const haystack = normalizePath(commandLine);
  const needle = normalizePath(productRoot);
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) {
      return false;
    }
    const next = haystack.charAt(index + needle.length);
    if (next === "" || next === "/" || next === " " || next === '"') {
      return true;
    }
    from = index + 1;
  }
}
