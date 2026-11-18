import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";

/**
 * Per-run MCP credential channel for the P4 products (ADR 0006, D7). `up()` writes
 * `<harnessRoot>/.harness/<product>-run.json` with mode 0600; `down()` removes it. Only `readP4McpCredentials` reads
 * the credential. Nothing prints, logs or uploads this file or its values. The `.harness/` folder is gitignored.
 */
export const P4_RUN_STATE_MISSING = "P4_RUN_STATE_MISSING";
export const P4_RUN_STATE_INVALID = "P4_RUN_STATE_INVALID";

export interface P4RunState {
  version: 1;
  product: string;
  /** The MCP endpoint, for example http://127.0.0.1:8765/mcp. */
  mcpUrl: string;
  /**
   * The full Authorization header value the MCP client sends, for example `Bearer <key>` or
   * `Basic <base64(user:app-password)>`. The scheme depends on the product (see ADR 0006). `null` means the MCP
   * takes no credential: Penpot runs in single-user mode on loopback, and its plugin sends no token (spike, 2026-11-17).
   */
  mcpAuthorization: string | null;
  /** Fake owner identity. No password is stored here. */
  owner: { username: string; email: string };
}

/** For products that always take a credential (Nextcloud, Outline, Mattermost): throws when the state has none. */
export function requireMcpAuthorization(creds: { mcpAuthorization: string | null }, product: string): string {
  if (creds.mcpAuthorization === null) {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${product} run state has no MCP credential (content not printed).`);
  }
  return creds.mcpAuthorization;
}

export function p4RunStateFile(product: string, harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", `${product}-run.json`);
}

/** Writes the state with mode 0600, also when the file already existed. Never logs. */
export function writeP4RunState(file: string, state: P4RunState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Removes the state. A missing file is not an error. Never logs. */
export function removeP4RunState(file: string): void {
  fs.rmSync(file, { force: true });
}

/**
 * Reads the MCP URL and Authorization value for one product. Throws P4_RUN_STATE_MISSING when the file is absent, and
 * P4_RUN_STATE_INVALID when it is not the expected shape. Neither message contains any value from the file.
 */
export function readP4McpCredentials(
  product: string,
  file: string = p4RunStateFile(product),
): { mcpUrl: string; mcpAuthorization: string | null } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${P4_RUN_STATE_MISSING}: ${file} does not exist. Run up for ${product} first.`);
    }
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} could not be read.`);
  }
  let parsed: Partial<P4RunState> | undefined;
  try {
    parsed = JSON.parse(text) as Partial<P4RunState>;
  } catch {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} is not JSON (content not printed).`);
  }
  if (
    parsed?.version !== 1 ||
    parsed.product !== product ||
    typeof parsed.mcpUrl !== "string" ||
    !/^https?:\/\//.test(parsed.mcpUrl) ||
    !(parsed.mcpAuthorization === null || (typeof parsed.mcpAuthorization === "string" && parsed.mcpAuthorization.trim() !== ""))
  ) {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
  }
  return { mcpUrl: parsed.mcpUrl, mcpAuthorization: parsed.mcpAuthorization };
}
