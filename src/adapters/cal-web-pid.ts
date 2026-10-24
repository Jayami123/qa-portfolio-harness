import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { captureProcessStartMark, parsePositiveSafeInteger } from "./documenso-web-pid.js";

export const CAL_WEB_PID_BASENAME = "cal-web.pid";

/** `pid` is the real root of the web tree (node running yarn), not a shell wrapper. */
export interface CalWebPidRecord {
  readonly pid: number;
  /** OS start marker of `pid`; down() verifies it before signaling a live root. */
  readonly startMark?: string;
}

export class CalWebStopError extends Error {
  readonly preservePidFile = true;
}

export type CalWebSignal = "SIGTERM" | "SIGKILL";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** POSIX process group id; 0 where the platform has none. */
  readonly pgid: number;
  /** OS start marker, comparable as a non-negative integer string. */
  readonly start: string;
}

export interface CalWebSpawnInput {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly yarn: string;
  /** Absolute path to yarn's JS entry. Required on Windows: it lets node run yarn with no shell. */
  readonly yarnScript?: string;
  readonly args: string[];
}

export interface CalWebSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly shell: false;
  /** POSIX: the web leads its own process group, so the recorded pid is the group id. */
  readonly detached: boolean;
}

export function calWebPidFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", CAL_WEB_PID_BASENAME);
}

export function parseCalWebPidFileText(text: string): CalWebPidRecord | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  const legacyPid = parsePositiveSafeInteger(trimmed);
  if (legacyPid !== undefined && trimmed === String(legacyPid)) {
    return { pid: legacyPid };
  }
  try {
    const parsed = JSON.parse(trimmed) as { pid?: unknown; startMark?: unknown };
    if (typeof parsed.pid !== "number" || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) {
      return undefined;
    }
    const startMark = typeof parsed.startMark === "string" && parsed.startMark.trim() !== ""
      ? parsed.startMark.trim()
      : undefined;
    return startMark === undefined ? { pid: parsed.pid } : { pid: parsed.pid, startMark };
  } catch {
    return undefined;
  }
}

export function writeCalWebPid(pid: number, harnessRoot: string = HARNESS_ROOT): void {
  const file = calWebPidFile(harnessRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const startMark = captureProcessStartMark(pid);
  const record: CalWebPidRecord = startMark === undefined ? { pid } : { pid, startMark };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readCalWebPidRecord(harnessRoot: string = HARNESS_ROOT): CalWebPidRecord | undefined {
  const file = calWebPidFile(harnessRoot);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return parseCalWebPidFileText(fs.readFileSync(file, "utf8"));
}

/**
 * The spawn arguments for the Cal web server. Never a shell: on Windows the cmd.exe wrapper
 * was the recorded pid, and it exits while its children keep the port.
 */
export function calWebSpawnSpec(input: CalWebSpawnInput): CalWebSpawnSpec {
  if (input.platform === "win32") {
    if (input.yarnScript === undefined) {
      throw new Error(
        "Cal web cannot start without a shell: yarn's JS entry was not found beside node (corepack). Refusing to start through cmd.exe.",
      );
    }
    return { command: input.execPath, args: [input.yarnScript, ...input.args], shell: false, detached: false };
  }
  return { command: input.yarn, args: input.args, shell: false, detached: true };
}

function startedAtOrAfter(row: ProcessRow, floor: bigint): boolean {
  try {
    return BigInt(row.start) >= floor;
  } catch {
    return false;
  }
}

/**
 * Live processes that belong to a dead recorded root: its descendants by parent pid, and on POSIX
 * the members of its process group. Each one must have started at or after the root's start mark,
 * so a recycled pid cannot pull in an unrelated process. Without a start mark nothing matches.
 */
export function matchCalWebTree(
  rows: readonly ProcessRow[],
  rootPid: number,
  rootStart: string | undefined,
  includeGroup: boolean,
): number[] {
  if (rootStart === undefined) {
    return [];
  }
  let floor: bigint;
  try {
    floor = BigInt(rootStart);
  } catch {
    return [];
  }
  const childrenOf = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid) ?? [];
    siblings.push(row);
    childrenOf.set(row.ppid, siblings);
  }
  const matched = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const child of childrenOf.get(parent) ?? []) {
      if (child.pid !== rootPid && !matched.has(child.pid) && startedAtOrAfter(child, floor)) {
        matched.add(child.pid);
        queue.push(child.pid);
      }
    }
  }
  if (includeGroup) {
    for (const row of rows) {
      if (row.pgid === rootPid && row.pid !== rootPid && startedAtOrAfter(row, floor)) {
        matched.add(row.pid);
      }
    }
  }
  return [...matched];
}

export interface CalWebStopDeps {
  readonly platform: NodeJS.Platform;
  readRecord: () => CalWebPidRecord | undefined;
  hasPidFile: () => boolean;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  captureStartMark: (pid: number) => string | undefined;
  listProcesses: () => ProcessRow[];
  /** Signals a live root and its tree (POSIX group, or taskkill /T on Windows). */
  killRootTree: (pid: number, signal: CalWebSignal) => void;
  /** Signals one matched descendant. */
  killProcess: (pid: number, signal: CalWebSignal) => void;
}

/**
 * Signals the harness-recorded web tree and returns the pids it targeted. Refuses to signal a
 * live root whose start mark differs. Leaves the pid file alone; see {@link settleCalWebStop}.
 */
export function stopCalWebTree(deps: CalWebStopDeps, signal: CalWebSignal = "SIGTERM"): Set<number> {
  const tree = new Set<number>();
  const record = deps.readRecord();
  if (record === undefined) {
    if (deps.hasPidFile()) {
      deps.removePidFile();
    }
    return tree;
  }

  if (deps.isPidRunning(record.pid)) {
    if (record.startMark === undefined) {
      throw new CalWebStopError(
        `Cal web pid ${String(record.pid)} is alive but its pid file has no start mark; not signaling.`,
      );
    }
    const currentMark = deps.captureStartMark(record.pid);
    if (currentMark !== record.startMark) {
      throw new CalWebStopError(
        `Cal web pid file points at pid ${String(record.pid)}, but its start mark no longer matches ` +
          `(recorded ${record.startMark}, current ${currentMark ?? "unknown"}). Not signaling.`,
      );
    }
    try {
      deps.killRootTree(record.pid, signal);
    } catch (error) {
      if (deps.isPidRunning(record.pid)) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CalWebStopError(
          `Failed to stop Cal web process tree for pid ${String(record.pid)}: ${detail}`,
          { cause: error },
        );
      }
    }
    tree.add(record.pid);
    return tree;
  }

  // The recorded root is gone. Its children may not be: match them by parent pid and start mark.
  const targets = matchCalWebTree(deps.listProcesses(), record.pid, record.startMark, deps.platform !== "win32");
  for (const pid of targets) {
    try {
      deps.killProcess(pid, signal);
    } catch (error) {
      if (deps.isPidRunning(pid)) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CalWebStopError(`Failed to stop Cal web child pid ${String(pid)}: ${detail}`, { cause: error });
      }
    }
    tree.add(pid);
  }
  return tree;
}

export interface SettleCalWebStopInput {
  /** The web address, for messages only. */
  readonly address: string;
  readonly portHeld: boolean;
  /** Pids listening on the web port (empty when unknown). */
  readonly listeners: readonly number[];
  /** Pids the stop targeted (from {@link stopCalWebTree}). */
  readonly tree: ReadonlySet<number>;
  readonly removePidFile: () => void;
}

/** Removes the pid file only when the port is free. While it is held the file stays, so a later down can retry. */
export function settleCalWebStop(input: SettleCalWebStopInput): void {
  if (!input.portHeld) {
    input.removePidFile();
    return;
  }
  if (input.listeners.length === 0) {
    throw new CalWebStopError(
      `Cal web still listening on ${input.address}; the listener pid is unknown and was not signaled. Pid file kept.`,
    );
  }
  const matching = input.listeners.filter((pid) => input.tree.has(pid));
  const foreign = input.listeners.filter((pid) => !input.tree.has(pid));
  if (foreign.length > 0) {
    throw new CalWebStopError(
      `Cal web still listening on ${input.address} (pid ${foreign.join(", ")}), which does not match the harness ` +
        `record; not killed. Pid file kept.`,
    );
  }
  throw new CalWebStopError(
    `Cal web still listening on ${input.address} (pid ${matching.join(", ")}), a process the harness recorded; ` +
      `the stop did not complete. Pid file kept; run down again.`,
  );
}
