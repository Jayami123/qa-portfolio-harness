import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Run a command, inherit stdio, reject on non-zero exit.
 * Uses a shell on Windows so `.cmd` shims (yarn, npm, docker) resolve.
 */
export function run(command: string, args: string[], options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      shell: platform() === "win32",
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

export function detectPackageManager(productRoot: string): "yarn" | "pnpm" | "npm" {
  if (fs.existsSync(path.join(productRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(productRoot, "yarn.lock"))) return "yarn";
  return "npm";
}
