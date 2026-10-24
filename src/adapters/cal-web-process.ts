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

/** Pids listening on the web port. Empty when the lookup tool is missing or finds nothing. */
export function listenerPids(port: number, platform: NodeJS.Platform = process.platform): number[] {
  try {
    if (platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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
    }
    const out = execFileSync("lsof", ["-nP", "-t", `-iTCP:${String(port)}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
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
