import fs from "node:fs";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";
import {
  captureProcessStartMark,
  defaultKillProcessTree,
  parsePositiveSafeInteger,
} from "./documenso-web-pid.js";

export const CAL_WEB_PID_BASENAME = "cal-web.pid";

export interface CalWebPidRecord {
  readonly pid: number;
  /** Opaque OS start marker; when set, down() verifies before signaling a live pid. */
  readonly startMark?: string;
}

export class CalWebStopError extends Error {
  readonly preservePidFile = true;
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
  const record: CalWebPidRecord =
    startMark === undefined ? { pid } : { pid, startMark };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readCalWebPidRecord(harnessRoot: string = HARNESS_ROOT): CalWebPidRecord | undefined {
  const file = calWebPidFile(harnessRoot);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return parseCalWebPidFileText(fs.readFileSync(file, "utf8"));
}

export function readCalWebPidFromFile(harnessRoot: string = HARNESS_ROOT): number | undefined {
  return readCalWebPidRecord(harnessRoot)?.pid;
}

export interface StopCalWebFromPidFileDeps {
  readRecord: () => CalWebPidRecord | undefined;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  killProcessTree: (pid: number) => void;
  captureStartMark: (pid: number) => string | undefined;
}

/**
 * Stops only the harness-recorded Cal web pid (and its tree). Missing or empty pid files are
 * a no-op. Corrupt pid files are removed. Throws {@link CalWebStopError} when kill fails while
 * the pid may still be live, or when a live pid no longer matches the recorded start mark.
 */
export function stopCalWebFromPidFile(
  harnessRoot: string = HARNESS_ROOT,
  deps?: Partial<StopCalWebFromPidFileDeps>,
): void {
  const pidFile = calWebPidFile(harnessRoot);
  const readRecord = deps?.readRecord ?? (() => readCalWebPidRecord(harnessRoot));
  const removePidFile =
    deps?.removePidFile ??
    (() => {
      fs.rmSync(pidFile, { force: true });
    });
  const pidRunning = deps?.isPidRunning ?? isPidRunning;
  const killTree = deps?.killProcessTree ?? defaultKillProcessTree;
  const readStartMark = deps?.captureStartMark ?? captureProcessStartMark;

  const record = readRecord();
  if (record === undefined) {
    if (fs.existsSync(pidFile)) {
      removePidFile();
    }
    return;
  }

  const running = pidRunning(record.pid);
  if (running && record.startMark !== undefined) {
    const currentMark = readStartMark(record.pid);
    if (currentMark !== record.startMark) {
      throw new CalWebStopError(
        `Cal web pid file points at pid ${String(record.pid)}, but its start mark no longer matches ` +
          `(recorded ${record.startMark}, current ${currentMark ?? "unknown"}). Not signaling.`,
      );
    }
  }

  try {
    killTree(record.pid);
  } catch (error) {
    if (!pidRunning(record.pid)) {
      removePidFile();
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new CalWebStopError(
      `Failed to stop Cal web process tree for pid ${String(record.pid)}: ${detail}`,
      { cause: error },
    );
  }

  removePidFile();
}
