/**
 * H6: a Penpot browser tab that keeps the MCP plugin running, so the Penpot MCP acts per user. `P4_PENPOT_PLUGIN=1`
 * (exact value; off by default) runs the MCP in multi-user mode and opens one browser tab per profile (H2's two profiles).
 * It needs `P4_SECOND_IDENTITY=1`: with one profile there is nothing to tell apart. Pure builders and parsers here.
 */
import { parseSecondIdentityFlag } from "./p4-second-identity.js";

export const PENPOT_PLUGIN_INVALID = "PENPOT_PLUGIN_INVALID";
export const PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY = "PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY";

/** P4_PENPOT_PLUGIN: "" is off, exactly "1" is on, anything else throws without echoing the value. */
export function penpotPluginOption(pluginRaw: string, identityRaw: string): boolean {
  if (pluginRaw === "") {
    return false;
  }
  if (pluginRaw !== "1") {
    throw new Error(`${PENPOT_PLUGIN_INVALID}: P4_PENPOT_PLUGIN must be exactly "1" or unset (value not printed)`);
  }
  if (!parseSecondIdentityFlag(identityRaw)) {
    throw new Error(`${PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY}: P4_PENPOT_PLUGIN=1 needs P4_SECOND_IDENTITY=1`);
  }
  return true;
}

/** The file each profile creates and opens in its tab. The probe expects the MCP to report exactly these names. */
export const PENPOT_PLUGIN_FILE: Record<"owner" | "second", string> = { owner: "h6-owner-file", second: "h6-second-file" };
/** Run in the plugin context: the open file's name is the per-user answer. The plugin manifest has no user:read. */
export const PENPOT_PLUGIN_CODE = "return penpot.currentFile.name;";
/** Written by the tab host in the Penpot state folder, one file per profile, mode 0600. */
export const PENPOT_PLUGIN_READY = "penpot-plugin-tabs.ready";
export const PENPOT_PLUGIN_STATE_INVALID = "PENPOT_PLUGIN_STATE_INVALID";

export function pluginStateFileName(role: "owner" | "second"): string {
  return `penpot-plugin-${role}.json`;
}

export interface PenpotPluginState {
  role: "owner" | "second";
  fileName: string;
  mcpToken: string;
}

/** Reads one tab's state file. Throws a fixed message and never echoes the file's contents. */
export function parsePluginState(text: string, role: "owner" | "second"): PenpotPluginState {
  let parsed: { version?: unknown; role?: unknown; fileName?: unknown; mcpToken?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`${PENPOT_PLUGIN_STATE_INVALID}: the ${role} tab state is not JSON (content not printed)`);
  }
  if (parsed.version !== 1 || parsed.role !== role || typeof parsed.fileName !== "string" || typeof parsed.mcpToken !== "string" || parsed.mcpToken === "") {
    throw new Error(`${PENPOT_PLUGIN_STATE_INVALID}: the ${role} tab state has the wrong shape (content not printed)`);
  }
  return { role, fileName: parsed.fileName, mcpToken: parsed.mcpToken };
}

export const PENPOT_OWNER_TOKEN_MISSING = "LIBRECHAT_PENPOT_TOKEN_MISSING";

/**
 * H6: the owner's token for LibreChat. The tab host writes the state file and then the ready marker, so both must exist
 * before LibreChat starts. Fails closed with a harness: message. Neither the file nor the token is ever echoed.
 */
export function ownerTokenForLibreChat(ready: boolean, hostRunning: boolean, stateText: string | undefined): string {
  if (!ready) {
    throw new Error(`harness: ${PENPOT_OWNER_TOKEN_MISSING}: the Penpot tabs are not ready (no ${PENPOT_PLUGIN_READY}). Run npm run up -- penpot with P4_PENPOT_PLUGIN=1 first.`);
  }
  if (!hostRunning) {
    throw new Error(`harness: ${PENPOT_OWNER_TOKEN_MISSING}: the Penpot tab host is not running, so any token on disk is stale. Run npm run up -- penpot with P4_PENPOT_PLUGIN=1 again.`);
  }
  if (stateText === undefined) {
    throw new Error(`harness: ${PENPOT_OWNER_TOKEN_MISSING}: the owner's Penpot tab state is missing. Run npm run up -- penpot with P4_PENPOT_PLUGIN=1 first.`);
  }
  try {
    return parsePluginState(stateText, "owner").mcpToken;
  } catch {
    throw new Error(`harness: ${PENPOT_OWNER_TOKEN_MISSING}: the owner's Penpot tab state is unreadable (content not printed). Run npm run up -- penpot again.`);
  }
}

/** The MCP endpoint with the tab's user token, as the plugin itself names it in ?userToken=. */
export function withUserToken(mcpUrl: string, token: string): string {
  const url = new URL(mcpUrl);
  url.searchParams.set("userToken", token);
  return url.toString();
}

/**
 * The execute_code reply carries the value the code returned. The plugin wraps it as {"result": ..., "log": ...}; a bare
 * JSON string or plain text is read as the value too.
 */
export function fileNameFromToolText(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (parsed !== null && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
      return (parsed as { result: string }).result;
    }
  } catch {
    // not JSON: the text is the value
  }
  return text.trim();
}

export interface PerUserPluginProbe {
  product: string;
  ownerFile: string;
  secondFile: string;
  distinct: boolean;
  ownerMatches: boolean;
  secondMatches: boolean;
  ownerTools: number;
  secondTools: number;
  /** perUserPluginOk of the other fields. */
  ok: boolean;
}

/** Passes only when the two users' answers differ and each equals its own profile's file name. */
export function perUserPluginOk(probe: Omit<PerUserPluginProbe, "ok" | "product">): boolean {
  return probe.distinct && probe.ownerMatches && probe.secondMatches && probe.ownerTools > 0 && probe.secondTools > 0;
}
