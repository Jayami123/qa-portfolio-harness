/**
 * H9: the MCP recording proxy for LibreChat. Off by default. With LIBRECHAT_MCP_RECORDING unset, nothing here changes what
 * the adapter writes: the server URLs, librechat.yaml, the compose file list and the env file are all as in 0.6.8.
 *
 * With LIBRECHAT_MCP_RECORDING=1, each MCP server URL points at the recorder (container alias mcp-recorder, port 9100,
 * path /<server name>/...). The recorder forwards the bytes unchanged and writes a redacted log to its stdout.
 * See src/mcp-recorder/ for the code and docs/plans/2026-11-19-librechat-l3-primitives.md, session 7, for the reasons.
 */
import type { LibreChatMcpServer } from "./librechat-env.js";

export const LIBRECHAT_MCP_RECORDING_INVALID = "LIBRECHAT_MCP_RECORDING_INVALID";

export const MCP_RECORDER_ALIAS = "mcp-recorder";
export const MCP_RECORDER_PORT = 9100;

/** Exactly "1" turns recording on. Unset is off. Any other value throws without echoing it. */
export function parseMcpRecordingFlag(raw: string): boolean {
  if (raw === "") return false;
  if (raw === "1") return true;
  throw new Error(`${LIBRECHAT_MCP_RECORDING_INVALID}: LIBRECHAT_MCP_RECORDING must be exactly "1" or unset (value not printed)`);
}

/** The same servers, with each URL pointed at the recorder: http://mcp-recorder:9100/<name><original path>. */
export function recordedServers(servers: LibreChatMcpServer[]): LibreChatMcpServer[] {
  return servers.map((s) => {
    const upstream = new URL(s.url);
    // H6: the query is kept. The Penpot owner's token rides in ?userToken=, and the recorder must forward it upstream. The
    // recorder's own log redacts that query (src/mcp-recorder/redact.ts). The URL holds the ${...} placeholder, not a value.
    return { ...s, url: `http://${MCP_RECORDER_ALIAS}:${MCP_RECORDER_PORT}/${s.name}${upstream.pathname}${upstream.search}` };
  });
}

/** MCP_RECORDER_ROUTES: name=origin for each server, for example nextcloud=http://nextcloud-mcp:8000. */
export function recorderRoutes(servers: LibreChatMcpServer[]): string {
  return servers.map((s) => `${s.name}=${new URL(s.url).origin}`).join(",");
}
