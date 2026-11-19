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
