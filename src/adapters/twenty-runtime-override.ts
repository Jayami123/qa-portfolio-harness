import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { readTwentyRateLimitEnv, twentyRateLimitComposeYaml } from "./twenty-rate-limits.js";

export const TWENTY_RUNTIME_OVERRIDE_FILE = "twenty.runtime.compose.yml";

export interface RuntimeOverrideFs {
  writeFileSync(file: string, text: string): void;
  rmSync(file: string, opts: { force: true }): void;
  mkdirSync(dir: string, opts: { recursive: true }): void;
}

const defaultRuntimeOverrideFs: RuntimeOverrideFs = fs;

/** The override file the harness owns: path.join(HARNESS_ROOT, ".harness", "twenty.runtime.compose.yml") (HARNESS_ROOT: src/paths.ts:5). */
export function twentyRuntimeOverridePath(): string {
  return path.join(HARNESS_ROOT, ".harness", TWENTY_RUNTIME_OVERRIDE_FILE);
}

/** The override as a compose -f entry, or no entry when the last up() wrote none. */
export function twentyRuntimeOverrideFiles(): string[] {
  const file = twentyRuntimeOverridePath();
  return fs.existsSync(file) ? [file] : [];
}

/** Writes the override only when a rate-limit key is needed, and always removes a stale file first.
 *  Validates every value before touching the disk: a bad value throws with no file system call.
 *  Returns the absolute path written, or undefined. */
export function writeTwentyRuntimeOverride(opts: {
  env: NodeJS.ProcessEnv;
  fs?: RuntimeOverrideFs;
}): string | undefined {
  const values = readTwentyRateLimitEnv(opts.env);
  const yaml = twentyRateLimitComposeYaml(values);
  const fsImpl = opts.fs ?? defaultRuntimeOverrideFs;
  const file = twentyRuntimeOverridePath();

  if (yaml === undefined) {
    fsImpl.rmSync(file, { force: true });
    return undefined;
  }
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, yaml);
  return file;
}
