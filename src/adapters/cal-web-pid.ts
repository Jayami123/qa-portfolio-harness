import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { captureProcessStartMark, parsePositiveSafeInteger } from "./documenso-web-pid.js";

export const CAL_WEB_PID_BASENAME = "cal-web.pid";

/**
 * `pid` is the Next.js server itself: node running the fork's `next` bin. No shell and no yarn
 * process sit between the harness and the server, so the recorded pid is the listener.
 */
export interface CalWebPidRecord {
  readonly pid: number;
  /** OS start marker of `pid`; down() verifies it before signaling a live pid. */
  readonly startMark?: string;
}

export class CalWebStopError extends Error {
  readonly preservePidFile = true;
}

export type CalWebSignal = "SIGTERM" | "SIGKILL";

export interface CalWebSpawnInput {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  /** The fork's resolved Next.js bin (`next/dist/bin/next`). */
  readonly nextBin: string;
  /** Arguments after the bin, e.g. `["start", "-H", "127.0.0.1", "-p", "3000"]`. */
  readonly args: readonly string[];
}

export interface CalWebSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly shell: false;
  /** POSIX: the server leads its own process group, so the recorded pid is the group id. */
  readonly detached: boolean;
}

export function calWebPidFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", CAL_WEB_PID_BASENAME);
}

export function describeCalWebRecord(record: CalWebPidRecord | undefined): string {
  if (record === undefined) {
    return "no pid record";
  }
  return `recorded pid ${String(record.pid)}, start mark ${record.startMark ?? "none"}`;
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
 * The spawn for the Cal web server: node runs the fork's Next.js bin directly. Never a shell, and
 * no yarn in between. Detached on every platform: POSIX makes the server a process-group leader, and
 * on Windows a non-detached child died with the `up` process (observed on this machine).
 */
export function calWebSpawnSpec(input: CalWebSpawnInput): CalWebSpawnSpec {
  return {
    command: input.execPath,
    args: [input.nextBin, ...input.args],
    shell: false,
    detached: true,
  };
}

export interface CalWebStopDeps {
  readonly platform: NodeJS.Platform;
  readRecord: () => CalWebPidRecord | undefined;
  hasPidFile: () => boolean;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  captureStartMark: (pid: number) => string | undefined;
  /** Signals the recorded pid and its tree: kill(-pgid) on POSIX, taskkill /T on Windows. */
  killRootTree: (pid: number, signal: CalWebSignal) => void;
}

/**
 * Signals the recorded pid when it is alive and its start mark matches. A dead recorded pid has
 * nothing to signal: the port decides what is left. A corrupt pid file is removed. Never signals a
 * pid whose start mark differs. Leaves the pid file alone; see {@link settleCalWebStop}.
 */
export function stopRecordedCalWeb(deps: CalWebStopDeps, signal: CalWebSignal = "SIGTERM"): CalWebPidRecord | undefined {
  const record = deps.readRecord();
  if (record === undefined) {
    if (deps.hasPidFile()) {
      deps.removePidFile();
    }
    return undefined;
  }
  if (!deps.isPidRunning(record.pid)) {
    return record;
  }
  if (record.startMark === undefined) {
    throw new CalWebStopError(
      `Cal web pid ${String(record.pid)} is alive but its pid file has no start mark (${describeCalWebRecord(record)}); not signaling.`,
    );
  }
  const currentMark = deps.captureStartMark(record.pid);
  if (currentMark !== record.startMark) {
    throw new CalWebStopError(
      `Cal web pid ${String(record.pid)} is alive but its start mark does not match the record ` +
        `(${describeCalWebRecord(record)}, current start mark ${currentMark ?? "unknown"}); not signaling.`,
    );
  }
  try {
    deps.killRootTree(record.pid, signal);
  } catch (error) {
    if (deps.isPidRunning(record.pid)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new CalWebStopError(
        `Failed to stop Cal web (${describeCalWebRecord(record)}): ${detail}`,
        { cause: error },
      );
    }
  }
  return record;
}

/**
 * The listener on the web port must be the recorded pid. Otherwise up does not guess and fails.
 */
export function assertListenerIsRecorded(input: {
  readonly address: string;
  readonly listeners: readonly number[];
  readonly record: CalWebPidRecord | undefined;
}): void {
  const { address, listeners, record } = input;
  if (record !== undefined && listeners.includes(record.pid)) {
    return;
  }
  if (listeners.length === 0) {
    throw new Error(
      `Cal is healthy on ${address}, but no listener pid could be read (${describeCalWebRecord(record)}). ` +
        `Not guessing which process serves it.`,
    );
  }
  throw new Error(
    `Cal is healthy on ${address}, but the listener pid ${listeners.join(", ")} does not match ` +
      `${describeCalWebRecord(record)}. Not guessing which process serves it.`,
  );
}

export interface SettleCalWebStopInput {
  /** The web address, for messages only. */
  readonly address: string;
  readonly portHeld: boolean;
  /** Pids listening on the web port (empty when unknown). */
  readonly listeners: readonly number[];
  /** The record that was stopped (from {@link stopRecordedCalWeb}). */
  readonly record: CalWebPidRecord | undefined;
  readonly removePidFile: () => void;
}

/** Removes the pid file only when the port is free. While the port is held the file stays, so a later down can retry. */
export function settleCalWebStop(input: SettleCalWebStopInput): void {
  if (!input.portHeld) {
    input.removePidFile();
    return;
  }
  const described = describeCalWebRecord(input.record);
  if (input.listeners.length === 0) {
    throw new CalWebStopError(
      `Cal web still listening on ${input.address}; listener pid unknown (${described}). Pid file kept.`,
    );
  }
  if (input.record !== undefined && input.listeners.includes(input.record.pid)) {
    throw new CalWebStopError(
      `Cal web still listening on ${input.address} as the recorded pid ${String(input.record.pid)} ` +
        `(start mark ${input.record.startMark ?? "none"}); the stop did not complete. Pid file kept; run down again.`,
    );
  }
  throw new CalWebStopError(
    `Cal web still listening on ${input.address} as pid ${input.listeners.join(", ")}, which does not match ` +
      `${described}; not killed. Pid file kept.`,
  );
}
