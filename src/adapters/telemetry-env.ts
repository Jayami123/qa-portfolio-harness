import fs from "node:fs";
import path from "node:path";

export interface ElPreload {
  preload: string; // absolute path to a readable file
  out: string; // absolute path; created with mkdir -p when missing
}

export type ElRole = "server" | "server-2";

function isReadableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) {
      return false;
    }
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** undefined when HARNESS_EL_PRELOAD is unset, blank or empty (the preload is off).
 *  Throws `HARNESS_EL_PRELOAD must be an absolute path to a readable file (got "<raw>")` for a relative, missing or unreadable
 *  preload, and `HARNESS_EL_OUT must be an absolute path when HARNESS_EL_PRELOAD is set` when the out path is not absolute.
 *  Creates the out directory with mkdir -p when it is missing. */
export function elPreloadFromEnv(env: NodeJS.ProcessEnv): ElPreload | undefined {
  const raw = env.HARNESS_EL_PRELOAD;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  if (!path.isAbsolute(raw) || !isReadableFile(raw)) {
    throw new Error(`HARNESS_EL_PRELOAD must be an absolute path to a readable file (got "${raw}")`);
  }
  if (/\s/.test(raw)) {
    // NODE_OPTIONS is split on whitespace, so a path with a space would reach Node as two arguments.
    throw new Error(`HARNESS_EL_PRELOAD must not contain whitespace (got "${raw}")`);
  }
  const out = env.HARNESS_EL_OUT;
  if (out === undefined || !path.isAbsolute(out)) {
    throw new Error("HARNESS_EL_OUT must be an absolute path when HARNESS_EL_PRELOAD is set");
  }
  fs.mkdirSync(out, { recursive: true });
  return { preload: raw, out };
}

/** Keeps the base flags and appends --require. */
export function appendNodeOptions(base: string | undefined, preload: string): string {
  return [base?.trim(), `--require=${preload}`].filter(Boolean).join(" ");
}

/** The env of one server process: the base env plus the preload keys. Returns base unchanged when there is no preload. */
export function serverProcessEnv(
  base: Record<string, string>,
  role: ElRole,
  el: ElPreload | undefined,
): Record<string, string> {
  if (!el) {
    return base;
  }
  return {
    ...base,
    NODE_OPTIONS: appendNodeOptions(base.NODE_OPTIONS, el.preload),
    HARNESS_EL_OUT: el.out,
    HARNESS_EL_ROLE: role,
  };
}

/** The Documenso app env: the base env, plus the preload keys when HARNESS_EL_PRELOAD is set (role server). */
export function documensoAppEnvWithPreload(
  base: Record<string, string>,
  processEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  return serverProcessEnv(base, "server", elPreloadFromEnv(processEnv));
}
