import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { DOCUMENSO_OIDC_CLIENT_ID, documensoOidcEnabled } from "./documenso-oidc.js";

/**
 * The per-run credential channel for the Documenso OIDC test users (D-HAR-F9). `up` with DOCUMENSO_OIDC=1 writes
 * `<harnessRoot>/.harness/documenso-oidc-run.json` (gitignored, mode 0600). `down` removes it. A test in another process
 * reads it through documensoOidcTestUsers(). Consumers must never upload, print or log this file or its values.
 */
export const DOCUMENSO_OIDC_RUN_STATE_BASENAME = "documenso-oidc-run.json";
export const DOCUMENSO_OIDC_RUN_STATE_MISSING = "DOCUMENSO_OIDC_RUN_STATE_MISSING";
export const DOCUMENSO_OIDC_RUN_STATE_INVALID = "DOCUMENSO_OIDC_RUN_STATE_INVALID";
export const DOCUMENSO_OIDC_NOT_ENABLED = "DOCUMENSO_OIDC_NOT_ENABLED";

export interface DocumensoOidcRunStateUser {
  username: string;
  email: string;
  emailVerified: boolean;
  password: string;
}

export interface DocumensoOidcRunState {
  version: 1;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  users: { verified: DocumensoOidcRunStateUser; unverified: DocumensoOidcRunStateUser };
}

/** The two seeded users a test logs in as. Usernames and passwords only: nothing else is exposed by the reader. */
export interface DocumensoOidcTestUsers {
  verified: { username: string; password: string };
  unverified: { username: string; password: string };
}

export function documensoOidcRunStateFile(harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", DOCUMENSO_OIDC_RUN_STATE_BASENAME);
}

/** Writes the run state with mode 0600 (also when the file already existed), creating `.harness/` if needed. Never logs. */
export function writeDocumensoOidcRunState(file: string, state: DocumensoOidcRunState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Removes the run state. Missing is not an error. Never logs. */
export function removeDocumensoOidcRunState(file: string): void {
  fs.rmSync(file, { force: true });
}

/**
 * Typed reader for the two seeded users. Throws DOCUMENSO_OIDC_NOT_ENABLED when the flag is not set, and
 * DOCUMENSO_OIDC_RUN_STATE_MISSING when the file is not there (both name the cause and never a value). A file that is not
 * the expected shape throws DOCUMENSO_OIDC_RUN_STATE_INVALID, without its content.
 */
export function documensoOidcTestUsers(
  env: NodeJS.ProcessEnv = process.env,
  file: string = documensoOidcRunStateFile(),
): DocumensoOidcTestUsers {
  if (!documensoOidcEnabled(env)) {
    throw new Error(`${DOCUMENSO_OIDC_NOT_ENABLED}: DOCUMENSO_OIDC is not 1, so no OIDC test users are set up.`);
  }
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${DOCUMENSO_OIDC_RUN_STATE_MISSING}: ${file} does not exist. Run up with DOCUMENSO_OIDC=1 first.`);
    }
    throw new Error(`${DOCUMENSO_OIDC_RUN_STATE_INVALID}: ${file} could not be read.`);
  }
  let parsed: Partial<DocumensoOidcRunState> | undefined;
  try {
    parsed = JSON.parse(text) as Partial<DocumensoOidcRunState>;
  } catch {
    throw new Error(`${DOCUMENSO_OIDC_RUN_STATE_INVALID}: ${file} is not JSON (content not printed).`);
  }
  const verified = parsed?.users?.verified;
  const unverified = parsed?.users?.unverified;
  if (
    parsed?.version !== 1 ||
    parsed.clientId !== DOCUMENSO_OIDC_CLIENT_ID ||
    typeof verified?.username !== "string" ||
    typeof verified.password !== "string" ||
    typeof unverified?.username !== "string" ||
    typeof unverified.password !== "string" ||
    verified.password === "" ||
    unverified.password === ""
  ) {
    throw new Error(`${DOCUMENSO_OIDC_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
  }
  return {
    verified: { username: verified.username, password: verified.password },
    unverified: { username: unverified.username, password: unverified.password },
  };
}

