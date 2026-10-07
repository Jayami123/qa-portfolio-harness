import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface RunCaptureResult {
  stdout: string;
  stderr: string;
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

/** Same as `run`, but capture stdout/stderr (for parsing seed keys). */
export function runCapture(command: string, args: string[], options: RunOptions): Promise<RunCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: platform() === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
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
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
      ) as Error & { stdout: string; stderr: string };
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

export function detectPackageManager(productRoot: string): "yarn" | "pnpm" | "npm" {
  if (fs.existsSync(path.join(productRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(productRoot, "yarn.lock"))) return "yarn";
  return "npm";
}
