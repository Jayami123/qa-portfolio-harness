import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";

export const MEDUSA_BACKEND_PID_BASENAME = "medusa-backend.pid";

export interface MedusaBackendPidRecord {
  readonly pid: number;
  /** Opaque OS start marker. When set, down() checks it before signaling a live pid. */
  readonly startMark?: string;
}

export class MedusaBackendStopError extends Error {
  readonly preservePidFile = true;
}

export function medusaBackendPidFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", MEDUSA_BACKEND_PID_BASENAME);
}

/** A non-empty decimal string that is a positive safe integer. */
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

export function parseMedusaBackendPidFileText(text: string): MedusaBackendPidRecord | undefined {
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
    const startMark =
      typeof parsed.startMark === "string" && parsed.startMark.trim() !== ""
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
        ["-NoProfile", "-Command", `(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.Ticks`],
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

export function writeMedusaBackendPid(pid: number, harnessRoot: string = HARNESS_ROOT): void {
  const file = medusaBackendPidFile(harnessRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const startMark = captureProcessStartMark(pid);
  const record: MedusaBackendPidRecord = startMark === undefined ? { pid } : { pid, startMark };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readMedusaBackendPidRecord(
  harnessRoot: string = HARNESS_ROOT,
): MedusaBackendPidRecord | undefined {
  const file = medusaBackendPidFile(harnessRoot);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return parseMedusaBackendPidFileText(fs.readFileSync(file, "utf8"));
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

export interface StopMedusaBackendFromPidFileDeps {
  readRecord: () => MedusaBackendPidRecord | undefined;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  killProcessTree: (pid: number) => void;
  captureStartMark: (pid: number) => string | undefined;
}

/**
 * Stops only the harness-recorded Medusa backend pid and its tree.
 * A missing pid file is a no-op. A corrupt pid file is removed.
 * Throws {@link MedusaBackendStopError} when kill fails and the pid is still live,
 * or when a live pid no longer matches the recorded start mark.
 */
export function stopMedusaBackendFromPidFile(
  harnessRoot: string = HARNESS_ROOT,
  deps?: Partial<StopMedusaBackendFromPidFileDeps>,
): void {
  const pidFile = medusaBackendPidFile(harnessRoot);
  const readRecord = deps?.readRecord ?? (() => readMedusaBackendPidRecord(harnessRoot));
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
      throw new MedusaBackendStopError(
        `Medusa backend pid file points at pid ${String(record.pid)}, but its start mark no longer matches ` +
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
    throw new MedusaBackendStopError(
      `Failed to stop Medusa backend process tree for pid ${String(record.pid)}: ${detail}`,
      { cause: error },
    );
  }

  removePidFile();
}
