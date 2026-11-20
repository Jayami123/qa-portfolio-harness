export declare const PENPOT_PLUGIN_INVALID = "PENPOT_PLUGIN_INVALID";
export declare const PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY = "PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY";
/** P4_PENPOT_PLUGIN: "" is off, exactly "1" is on, anything else throws without echoing the value. */
export declare function penpotPluginOption(pluginRaw: string, identityRaw: string): boolean;
/** The file each profile creates and opens in its tab. The probe expects the MCP to report exactly these names. */
export declare const PENPOT_PLUGIN_FILE: Record<"owner" | "second", string>;
/** Run in the plugin context: the open file's name is the per-user answer. The plugin manifest has no user:read. */
export declare const PENPOT_PLUGIN_CODE = "return penpot.currentFile.name;";
/** Written by the tab host in the Penpot state folder, one file per profile, mode 0600. */
export declare const PENPOT_PLUGIN_READY = "penpot-plugin-tabs.ready";
export declare const PENPOT_PLUGIN_STATE_INVALID = "PENPOT_PLUGIN_STATE_INVALID";
export declare function pluginStateFileName(role: "owner" | "second"): string;
export interface PenpotPluginState {
    role: "owner" | "second";
    fileName: string;
    mcpToken: string;
}
/** Reads one tab's state file. Throws a fixed message and never echoes the file's contents. */
export declare function parsePluginState(text: string, role: "owner" | "second"): PenpotPluginState;
/** The MCP endpoint with the tab's user token, as the plugin itself names it in ?userToken=. */
export declare function withUserToken(mcpUrl: string, token: string): string;
/**
 * The execute_code reply carries the value the code returned. The plugin wraps it as {"result": ..., "log": ...}; a bare
 * JSON string or plain text is read as the value too.
 */
export declare function fileNameFromToolText(text: string): string;
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
export declare function perUserPluginOk(probe: Omit<PerUserPluginProbe, "ok" | "product">): boolean;
//# sourceMappingURL=penpot-plugin.d.ts.map