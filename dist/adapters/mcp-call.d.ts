/** Prefix of every failed tool call. The message names the tool and the step, never a reply body or a credential. */
export declare const MCP_TOOL_FAILED = "MCP_TOOL_FAILED";
/**
 * The payload of a tools/call reply: structuredContent when the server sends it, else the JSON text of the first content
 * item. A tool error (isError) throws with the tool name only: the text of an error can hold a message body.
 */
export declare function toolPayload(reply: unknown, tool: string): unknown;
export interface McpSessionOptions {
    url: string;
    authorization: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}
/**
 * One streamable-HTTP MCP session: initialize, notifications/initialized, then any number of tools/call. The
 * Authorization header is sent on every request and never logged or put in an error.
 */
export declare function openMcpSession(opts: McpSessionOptions): Promise<(tool: string, args: Record<string, unknown>) => Promise<unknown>>;
//# sourceMappingURL=mcp-call.d.ts.map