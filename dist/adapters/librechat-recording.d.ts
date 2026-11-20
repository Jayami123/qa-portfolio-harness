/**
 * H9: the MCP recording proxy for LibreChat. Off by default. With LIBRECHAT_MCP_RECORDING unset, nothing here changes what
 * the adapter writes: the server URLs, librechat.yaml, the compose file list and the env file are all as in 0.6.8.
 *
 * With LIBRECHAT_MCP_RECORDING=1, each MCP server URL points at the recorder (container alias mcp-recorder, port 9100,
 * path /<server name>/...). The recorder forwards the bytes unchanged and writes a redacted log to its stdout.
 * See src/mcp-recorder/ for the code and docs/plans/2026-11-19-librechat-l3-primitives.md, session 7, for the reasons.
 */
import type { LibreChatMcpServer } from "./librechat-env.js";
export declare const LIBRECHAT_MCP_RECORDING_INVALID = "LIBRECHAT_MCP_RECORDING_INVALID";
export declare const MCP_RECORDER_ALIAS = "mcp-recorder";
export declare const MCP_RECORDER_PORT = 9100;
/** Exactly "1" turns recording on. Unset is off. Any other value throws without echoing it. */
export declare function parseMcpRecordingFlag(raw: string): boolean;
/** The same servers, with each URL pointed at the recorder: http://mcp-recorder:9100/<name><original path>. */
export declare function recordedServers(servers: LibreChatMcpServer[]): LibreChatMcpServer[];
/** MCP_RECORDER_ROUTES: name=origin for each server, for example nextcloud=http://nextcloud-mcp:8000. */
export declare function recorderRoutes(servers: LibreChatMcpServer[]): string;
//# sourceMappingURL=librechat-recording.d.ts.map