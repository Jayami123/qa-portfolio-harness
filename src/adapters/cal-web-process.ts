import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";
import {
  type CalWebSignal,
  type CalWebStopDeps,
  calWebPidFile,
  readCalWebPidRecord,
} from "./cal-web-pid.js";
import { captureProcessStartMark } from "./documenso-web-pid.js";
import {
  type ProcFs,
  ProcNetUnavailableError,
  readLinuxListenerPids,
  realProcFs,
} from "./proc-net-listeners.js";

/**
 * The fork's `start` script (apps/web/package.json), split into arguments after `next`. The harness
 * appends `-H <host> -p <port>`; the fork's script stays the source of truth for the rest.
 */
export function readWebStartArgs(webDir: string): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(webDir, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.start?.trim();
  if (script === undefined) {
    throw new Error(`Cal web package.json at ${webDir} has no "start" script.`);
  }
  const tokens = script.split(/\s+/);
  if (tokens[0] !== "next" || tokens.length < 2) {
    throw new Error(`Cal web "start" script must be "next <args>", found "${script}".`);
  }
  return tokens.slice(1);
}

/** The Next.js bin for apps/web, resolved from that package the way yarn's workspace resolves it. */
export function resolveNextBin(webDir: string): string {
  const require = createRequire(path.join(webDir, "package.json"));
  const nextPackage = require.resolve("next/package.json");
  return path.join(path.dirname(nextPackage), "dist", "bin", "next");
}

export interface ListenerDeps {
  readonly procFs: ProcFs;
  readonly execFile: (command: string, args: string[]) => string;
}

const defaultListenerDeps: ListenerDeps = {
  procFs: realProcFs,
  execFile: (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
};

/**
 * Pids listening on the web port. Empty when the lookup finds nothing or fails (the caller fails closed).
 * Linux reads /proc/net/tcp{,6} and /proc/<pid>/fd, because lsof skips a process whose name has an
 * unbalanced parenthesis, such as `next-server (v16.x)`. lsof is the fallback when /proc/net/tcp cannot
 * be read, and the lookup on macOS. Windows parses `netstat -ano`.
 */
export function listenerPids(
  port: number,
  platform: NodeJS.Platform = process.platform,
  deps: ListenerDeps = defaultListenerDeps,
): number[] {
  if (platform === "win32") {
    try {
      const out = deps.execFile("netstat", ["-ano"]);
      const pids = new Set<number>();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${String(port)} `) || !/LISTENING/i.test(line)) {
          continue;
        }
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isSafeInteger(pid) && pid > 0) {
          pids.add(pid);
        }
      }
      return [...pids];
    } catch {
      return [];
    }
  }
  if (platform === "linux") {
    try {
      return readLinuxListenerPids(port, deps.procFs);
    } catch (error) {
      if (!(error instanceof ProcNetUnavailableError)) {
        throw error;
      }
    }
  }
  try {
    const out = deps.execFile("lsof", ["-nP", "-t", `-iTCP:${String(port)}`, "-sTCP:LISTEN"]);
    return out
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Stops the recorded pid's tree: taskkill /T on Windows, the process group on POSIX. */
export function killRootTree(pid: number, signal: CalWebSignal, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  process.kill(-pid, signal);
}

/** The stop dependencies for the real harness: pid file under the harness root, real processes. */
export function calWebStopDeps(harnessRoot: string = HARNESS_ROOT, platform: NodeJS.Platform = process.platform): CalWebStopDeps {
  return {
    platform,
    readRecord: () => readCalWebPidRecord(harnessRoot),
    hasPidFile: () => fs.existsSync(calWebPidFile(harnessRoot)),
    removePidFile: () => {
      fs.rmSync(calWebPidFile(harnessRoot), { force: true });
    },
    isPidRunning,
    captureStartMark: captureProcessStartMark,
    killRootTree: (pid, signal) => {
      killRootTree(pid, signal, platform);
    },
  };
}
