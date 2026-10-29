import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import {
  readTwentyRateLimitEnv,
  TWENTY_RATE_LIMIT_ENV,
  type TwentyRateLimitEnvName,
} from "./twenty-rate-limits.js";
import { elPreloadFromEnv, type ElPreload } from "./telemetry-env.js";

export const TWENTY_RUNTIME_OVERRIDE_FILE = "twenty.runtime.compose.yml";

/** Where the preload and its out directory appear inside the Twenty containers. */
const CONTAINER_PRELOAD = "/harness/el/preload.cjs";
const CONTAINER_OUT = "/harness/el-out";
const OUT_DIR_MODE = 0o777;

export interface RuntimeOverrideFs {
  writeFileSync(file: string, text: string): void;
  rmSync(file: string, opts: { force: true }): void;
  mkdirSync(dir: string, opts: { recursive: true }): void;
  chmodSync(dir: string, mode: number): void;
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

/** The rate-limit environment lines for one service, in allowlist order. readTwentyRateLimitEnv has already checked each value. */
function rateLimitEnvLines(values: Partial<Record<TwentyRateLimitEnvName, string>>): string[] {
  return TWENTY_RATE_LIMIT_ENV.flatMap((name) => {
    const value = values[name];
    return value === undefined ? [] : [`      ${name}: "${value}"`];
  });
}

/** The override YAML for server and worker: the rate-limit keys, and when the preload is on, its environment and mounts.
 *  Returns undefined when there is nothing to write. Host paths are single-quoted, so Windows backslashes are not escapes. */
export function twentyRuntimeOverrideYaml(
  values: Partial<Record<TwentyRateLimitEnvName, string>>,
  preload: ElPreload | undefined,
): string | undefined {
  const limitLines = rateLimitEnvLines(values);
  if (limitLines.length === 0 && preload === undefined) {
    return undefined;
  }
  if (preload && /['\r\n]/.test(`${preload.preload}${preload.out}`)) {
    throw new Error("HARNESS_EL_PRELOAD and HARNESS_EL_OUT must not contain quotes or line breaks");
  }
  const out = ["services:"];
  for (const role of ["server", "worker"]) {
    out.push(`  ${role}:`, "    environment:", ...limitLines);
    if (preload) {
      out.push(
        `      NODE_OPTIONS: "--require=${CONTAINER_PRELOAD}"`,
        `      HARNESS_EL_OUT: "${CONTAINER_OUT}"`,
        `      HARNESS_EL_ROLE: "${role}"`,
        "    volumes:",
        `      - '${preload.preload}:${CONTAINER_PRELOAD}:ro'`,
        `      - '${preload.out}:${CONTAINER_OUT}'`,
      );
    }
  }
  return `${out.join("\n")}\n`;
}

/** Writes the override only when a key is needed, and always removes a stale file first.
 *  Validates every rate-limit value before touching the disk: a bad value throws with no file system call.
 *  With the event-loop preload on, the out directory is made mode 0777 before the override is written (the Twenty containers run as UID 1000).
 *  Returns the absolute path written, or undefined. */
export function writeTwentyRuntimeOverride(opts: {
  env: NodeJS.ProcessEnv;
  fs?: RuntimeOverrideFs;
}): string | undefined {
  const values = readTwentyRateLimitEnv(opts.env);
  const preload = elPreloadFromEnv(opts.env);
  const yaml = twentyRuntimeOverrideYaml(values, preload);
  const fsImpl = opts.fs ?? defaultRuntimeOverrideFs;
  const file = twentyRuntimeOverridePath();

  if (yaml === undefined) {
    fsImpl.rmSync(file, { force: true });
    return undefined;
  }
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  if (preload) {
    fsImpl.chmodSync(preload.out, OUT_DIR_MODE);
  }
  fsImpl.writeFileSync(file, yaml);
  return file;
}
