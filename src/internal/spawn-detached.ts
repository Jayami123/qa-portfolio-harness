import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";

export function resolveYarn(): string {
  if (platform() !== "win32") {
    return "yarn";
  }
  const sibling = path.join(path.dirname(process.execPath), "yarn.cmd");
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  return "yarn.cmd";
}

/** Keep the returned process referenced so Windows does not GC/kill it mid-smoke. */
export function spawnLogged(
  command: string,
  args: string[],
  options: { cwd: string; logFile: string; env?: NodeJS.ProcessEnv },
): ReturnType<typeof spawn> {
  fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
  fs.appendFileSync(
    options.logFile,
    `\n--- spawn ${new Date().toISOString()} ${command} ${args.join(" ")} ---\n`,
  );
  const out = fs.openSync(options.logFile, "a");
  const err = fs.openSync(options.logFile, "a");
  return spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: platform() === "win32",
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
}

export function spawnDetached(
  command: string,
  args: string[],
  options: { cwd: string; logFile: string },
): number {
  fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
  fs.appendFileSync(
    options.logFile,
    `\n--- spawn ${new Date().toISOString()} ${command} ${args.join(" ")} ---\n`,
  );

  if (platform() === "win32") {
    const launcher = path.join(path.dirname(options.logFile), "start-web.cmd");
    const yarnDir = path.dirname(command);
    const quotedArgs = args.map((arg) => `"${arg}"`).join(" ");
    const script = [
      "@echo off",
      `set "PATH=${yarnDir};%PATH%"`,
      `cd /d "${options.cwd}"`,
      `echo launch %DATE% %TIME%>> "${options.logFile}"`,
      `call "${command}" ${quotedArgs} >> "${options.logFile}" 2>&1`,
      `echo exit %ERRORLEVEL% %DATE% %TIME%>> "${options.logFile}"`,
    ].join("\r\n");
    fs.writeFileSync(launcher, script, "utf8");
    const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/c", launcher], {
      cwd: options.cwd,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    if (child.pid === undefined) {
      throw new Error(`Failed to spawn ${command} ${args.join(" ")}`);
    }
    return child.pid;
  }

  const out = fs.openSync(options.logFile, "a");
  const err = fs.openSync(options.logFile, "a");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn ${command} ${args.join(" ")}`);
  }
  return child.pid;
}

export function isPidRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  if (platform() === "win32") {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.includes(String(pid)) && !/no tasks/i.test(out);
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
