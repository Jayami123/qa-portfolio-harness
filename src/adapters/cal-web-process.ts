import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isPidRunning } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";
import {
  type CalWebSignal,
  type CalWebStopDeps,
  type ProcessRow,
  calWebPidFile,
  readCalWebPidRecord,
} from "./cal-web-pid.js";
import { captureProcessStartMark } from "./documenso-web-pid.js";

/** yarn's JS entry as installed beside node by corepack. Windows only; POSIX runs `yarn` directly. */
export function resolveYarnScript(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "win32") {
    return undefined;
  }
  const candidate = path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "yarn.js");
  return fs.existsSync(candidate) ? candidate : undefined;
}

function listProcessesPosix(): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      // Fields after the parenthesised command: state, ppid, pgrp, ..., starttime (index 19).
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      rows.push({
        pid: Number(entry),
        ppid: Number(fields[1]),
        pgid: Number(fields[2]),
        start: fields[19] ?? "",
      });
    } catch {
      // The process exited while it was being read.
    }
  }
  return rows;
}

function listProcessesWindows(): ProcessRow[] {
  const script =
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int64]$_.ProcessId; " +
    "ppid = [int64]$_.ParentProcessId; start = [string]$_.CreationDate.Ticks } } | ConvertTo-Json -Compress";
  const out = execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (out === "") {
    return [];
  }
  const parsed: unknown = JSON.parse(out);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => {
    const row = item as { pid: number; ppid: number; start: string };
    return { pid: row.pid, ppid: row.ppid, pgid: 0, start: row.start };
  });
}

/** Every process on the machine, with parent id, POSIX group id and start marker. */
export function listProcesses(platform: NodeJS.Platform = process.platform): ProcessRow[] {
  return platform === "win32" ? listProcessesWindows() : listProcessesPosix();
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

function signalPosixGroup(pid: number, signal: CalWebSignal): void {
  process.kill(-pid, signal);
}

/** Stops the root's whole tree: its POSIX process group, or taskkill /T on Windows. */
export function killRootTree(pid: number, signal: CalWebSignal, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  signalPosixGroup(pid, signal);
}

/** Stops one matched descendant. POSIX signals the process itself; Windows uses taskkill without /T. */
export function killProcess(pid: number, signal: CalWebSignal, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
    return;
  }
  process.kill(pid, signal);
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
    listProcesses: () => listProcesses(platform),
    killRootTree: (pid, signal) => {
      killRootTree(pid, signal, platform);
    },
    killProcess: (pid, signal) => {
      killProcess(pid, signal, platform);
    },
  };
}
