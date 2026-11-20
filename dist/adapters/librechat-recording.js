export const LIBRECHAT_MCP_RECORDING_INVALID = "LIBRECHAT_MCP_RECORDING_INVALID";
export const MCP_RECORDER_ALIAS = "mcp-recorder";
export const MCP_RECORDER_PORT = 9100;
/** Exactly "1" turns recording on. Unset is off. Any other value throws without echoing it. */
export function parseMcpRecordingFlag(raw) {
    if (raw === "")
        return false;
    if (raw === "1")
        return true;
    throw new Error(`${LIBRECHAT_MCP_RECORDING_INVALID}: LIBRECHAT_MCP_RECORDING must be exactly "1" or unset (value not printed)`);
}
/** The same servers, with each URL pointed at the recorder: http://mcp-recorder:9100/<name><original path>. */
export function recordedServers(servers) {
    return servers.map((s) => ({
        ...s,
        url: `http://${MCP_RECORDER_ALIAS}:${MCP_RECORDER_PORT}/${s.name}${new URL(s.url).pathname}`,
    }));
}
/** MCP_RECORDER_ROUTES: name=origin for each server, for example nextcloud=http://nextcloud-mcp:8000. */
export function recorderRoutes(servers) {
    return servers.map((s) => `${s.name}=${new URL(s.url).origin}`).join(",");
}
//# sourceMappingURL=librechat-recording.js.map