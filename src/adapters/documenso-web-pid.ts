import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";

export const DOCUMENSO_WEB_PID_BASENAME = "documenso-web.pid";

export function documensoWebPidFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", DOCUMENSO_WEB_PID_BASENAME);
}

export function writeDocumensoWebPid(pid: number, harnessRoot: string = HARNESS_ROOT): void {
  const file = documensoWebPidFile(harnessRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${String(pid)}\n`, "utf8");
}

export function readDocumensoWebPidFromFile(harnessRoot: string = HARNESS_ROOT): number | undefined {
  const file = documensoWebPidFile(harnessRoot);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const text = fs.readFileSync(file, "utf8").trim();
  if (text === "") {
    return undefined;
  }
  const pid = Number.parseInt(text, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return pid;
}

export function defaultKillProcessTree(pid: number): void {
  if (platform() === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited or stale pid.
    }
  }
}

export interface StopDocumensoWebFromPidFileDeps {
  readPid: () => number | undefined;
  removePidFile: () => void;
  isPidRunning: (pid: number) => boolean;
  killProcessTree: (pid: number) => void;
}

/**
 * Stops only the harness-recorded Documenso web pid (and its tree). Never throws for a missing,
 * empty, or stale pid file. Removes the pid file when present.
 */
export function stopDocumensoWebFromPidFile(
  harnessRoot: string = HARNESS_ROOT,
  deps?: Partial<StopDocumensoWebFromPidFileDeps>,
): void {
  const pidFile = documensoWebPidFile(harnessRoot);
  const readPid = deps?.readPid ?? (() => readDocumensoWebPidFromFile(harnessRoot));
  const removePidFile =
    deps?.removePidFile ??
    (() => {
      try {
        fs.rmSync(pidFile, { force: true });
      } catch {
        // Best effort; down() must not fail on cleanup.
      }
    });
  const pidRunning = deps?.isPidRunning ?? isPidRunning;
  const killTree = deps?.killProcessTree ?? defaultKillProcessTree;

  const pid = readPid();
  if (pid === undefined) {
    if (fs.existsSync(pidFile)) {
      removePidFile();
    }
    return;
  }

  if (pidRunning(pid)) {
    try {
      killTree(pid);
    } catch {
      // Stale or race; still drop the pid file.
    }
  }
  removePidFile();
}
