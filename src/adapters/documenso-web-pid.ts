import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";

export const DOCUMENSO_WEB_PID_BASENAME = "documenso-web.pid";

export interface DocumensoWebPidRecord {
  readonly pid: number;
  /** Opaque OS start marker; when set, down() verifies before signaling a live pid. */
  readonly startMark?: string;
}

export class DocumensoWebStopError extends Error {
  readonly preservePidFile = true;
}

export function documensoWebPidFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", DOCUMENSO_WEB_PID_BASENAME);
}

/** Accepts only a non-empty decimal string that is a positive safe integer. */
export function parsePositiveSafeInteger(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function parseDocumensoWebPidFileText(text: string): DocumensoWebPidRecord | undefined {
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

export function captureProcessStartMark(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (platform() === "win32") {
    try {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.Ticks`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return out === "" ? undefined : out;
    } catch {
      return undefined;
    }
  }
  try {
    const stat = fs.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const fields = afterComm.split(" ");
    const starttime = fields[19];
    return starttime === undefined || starttime === "" ? undefined : starttime;
  } catch {
    return undefined;
  }
}

export function writeDocumensoWebPid(pid: number, harnessRoot: string = HARNESS_ROOT): void {
  const file = documensoWebPidFile(harnessRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const startMark = captureProcessStartMark(pid);
  const record: DocumensoWebPidRecord =
    startMark === undefined ? { pid } : { pid, startMark };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readDocumensoWebPidRecord(harnessRoot: string = HARNESS_ROOT): DocumensoWebPidRecord | undefined {
  const file = documensoWebPidFile(harnessRoot);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return parseDocumensoWebPidFileText(fs.readFileSync(file, "utf8"));
}

export function readDocumensoWebPidFromFile(harnessRoot: string = HARNESS_ROOT): number | undefined {
  return readDocumensoWebPidRecord(harnessRoot)?.pid;
}

export function defaultKillProcessTree(pid: number): void {
  if (platform() === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

export interface StopDocumensoWebFromPidFileDeps {
  readRecord: () => DocumensoWebPidRecord | undefined;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  killProcessTree: (pid: number) => void;
  captureStartMark: (pid: number) => string | undefined;
}

/** Parent pid of a process, or undefined when it has no parent or cannot be read (Windows: CIM; POSIX: ps). */
export function parentPidOf(pid: number, platformName: NodeJS.Platform = platform()): number | undefined {
  const options = { encoding: "utf8" as const, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"] };
  try {
    const out =
      platformName === "win32"
        ? execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${String(pid)}').ParentProcessId`], options)
        : execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], options);
    const parent = Number(out.trim());
    return Number.isSafeInteger(parent) && parent > 0 ? parent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The pid to signal so that a port listener dies, or undefined when the listener is not proven to belong to the record.
 * The listener belongs to the record when the recorded pid is on its ancestor chain. A live root is signaled whole
 * (taskkill /T, or the process group). A dead root keeps its children on the chain (Windows does not reparent them),
 * so the child just below the root is signaled and its tree takes the listener with it.
 */
export function ownedKillTarget(input: {
  readonly listener: number;
  readonly recordedRoot: number;
  readonly rootAlive: boolean;
  readonly parentOf: (pid: number) => number | undefined;
}): number | undefined {
  const chain: number[] = [];
  let current: number | undefined = input.listener;
  while (current !== undefined && chain.length < 64 && !chain.includes(current)) {
    chain.push(current);
    current = input.parentOf(current);
  }
  const index = chain.indexOf(input.recordedRoot);
  if (index < 0) {
    return undefined;
  }
  if (input.rootAlive) {
    return input.recordedRoot;
  }
  return index > 0 ? chain[index - 1] : undefined;
}

export type DocumensoRootState = "none" | "dead" | "live";

export interface DocumensoRootStop {
  readonly record: DocumensoWebPidRecord | undefined;
  /** dead: the recorded pid had already exited. live: the recorded tree was signaled (or its kill returned). */
  readonly state: DocumensoRootState;
}

/**
 * Signals the recorded root tree only while the root is alive and its start mark matches. Never removes the pid
 * file: the caller removes it after the port is confirmed free. A corrupt pid file is removed (it names no pid).
 * A dead root is reported as dead, not as stopped: its children may still hold the port.
 */
export function stopDocumensoWebRoot(
  harnessRoot: string = HARNESS_ROOT,
  deps?: Partial<StopDocumensoWebFromPidFileDeps>,
): DocumensoRootStop {
  const readRecord = deps?.readRecord ?? (() => readDocumensoWebPidRecord(harnessRoot));
  const pidRunning = deps?.isPidRunning ?? isPidRunning;
  const killTree = deps?.killProcessTree ?? defaultKillProcessTree;
  const readStartMark = deps?.captureStartMark ?? captureProcessStartMark;

  const record = readRecord();
  if (record === undefined) {
    const file = documensoWebPidFile(harnessRoot);
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
    return { record: undefined, state: "none" };
  }
  if (!pidRunning(record.pid)) {
    return { record, state: "dead" };
  }
  if (record.startMark !== undefined) {
    const currentMark = readStartMark(record.pid);
    if (currentMark !== record.startMark) {
      throw new DocumensoWebStopError(
        `Documenso web pid file points at pid ${String(record.pid)}, but its start mark no longer matches ` +
          `(recorded ${record.startMark}, current ${currentMark ?? "unknown"}). Not signaling.`,
      );
    }
  }
  try {
    killTree(record.pid);
  } catch (error) {
    if (pidRunning(record.pid)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DocumensoWebStopError(
        `Failed to stop Documenso web process tree for pid ${String(record.pid)}: ${detail}`,
        { cause: error },
      );
    }
  }
  return { record, state: "live" };
}

/** Removes the recorded pid file. Called only after the port is confirmed free. */
export function removeDocumensoWebPidFile(harnessRoot: string = HARNESS_ROOT): void {
  fs.rmSync(documensoWebPidFile(harnessRoot), { force: true });
}
