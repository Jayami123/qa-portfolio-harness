/**
 * H6: a Penpot browser tab that keeps the MCP plugin running, so the Penpot MCP acts per user. `P4_PENPOT_PLUGIN=1`
 * (exact value; off by default) runs the MCP in multi-user mode and opens one browser tab per profile (H2's two profiles).
 * It needs `P4_SECOND_IDENTITY=1`: with one profile there is nothing to tell apart. Pure builders and parsers here.
 */
import { parseSecondIdentityFlag } from "./p4-second-identity.js";
export const PENPOT_PLUGIN_INVALID = "PENPOT_PLUGIN_INVALID";
export const PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY = "PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY";
/** P4_PENPOT_PLUGIN: "" is off, exactly "1" is on, anything else throws without echoing the value. */
export function penpotPluginOption(pluginRaw, identityRaw) {
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
export const PENPOT_PLUGIN_FILE = { owner: "h6-owner-file", second: "h6-second-file" };
/** Run in the plugin context: the open file's name is the per-user answer. The plugin manifest has no user:read. */
export const PENPOT_PLUGIN_CODE = "return penpot.currentFile.name;";
/** Written by the tab host in the Penpot state folder, one file per profile, mode 0600. */
export const PENPOT_PLUGIN_READY = "penpot-plugin-tabs.ready";
export const PENPOT_PLUGIN_STATE_INVALID = "PENPOT_PLUGIN_STATE_INVALID";
export function pluginStateFileName(role) {
    return `penpot-plugin-${role}.json`;
}
/** Reads one tab's state file. Throws a fixed message and never echoes the file's contents. */
export function parsePluginState(text, role) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`${PENPOT_PLUGIN_STATE_INVALID}: the ${role} tab state is not JSON (content not printed)`);
    }
    if (parsed.version !== 1 || parsed.role !== role || typeof parsed.fileName !== "string" || typeof parsed.mcpToken !== "string" || parsed.mcpToken === "") {
        throw new Error(`${PENPOT_PLUGIN_STATE_INVALID}: the ${role} tab state has the wrong shape (content not printed)`);
    }
    return { role, fileName: parsed.fileName, mcpToken: parsed.mcpToken };
}
/** The MCP endpoint with the tab's user token, as the plugin itself names it in ?userToken=. */
export function withUserToken(mcpUrl, token) {
    const url = new URL(mcpUrl);
    url.searchParams.set("userToken", token);
    return url.toString();
}
/**
 * The execute_code reply carries the value the code returned. The plugin wraps it as {"result": ..., "log": ...}; a bare
 * JSON string or plain text is read as the value too.
 */
export function fileNameFromToolText(text) {
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "string")
            return parsed;
        if (parsed !== null && typeof parsed === "object" && typeof parsed.result === "string") {
            return parsed.result;
        }
    }
    catch {
        // not JSON: the text is the value
    }
    return text.trim();
}
/** Passes only when the two users' answers differ and each equals its own profile's file name. */
export function perUserPluginOk(probe) {
    return probe.distinct && probe.ownerMatches && probe.secondMatches && probe.ownerTools > 0 && probe.secondTools > 0;
}
//# sourceMappingURL=penpot-plugin.js.map