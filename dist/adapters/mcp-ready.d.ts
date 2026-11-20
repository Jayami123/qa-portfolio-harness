import type { McpReadiness } from "./types.js";
/** Prefix of every MCP readiness failure. Messages name the product and URL, never a header value or token. */
export declare const MCP_NOT_READY = "MCP_NOT_READY";
/** Protocol version all five P4-capable servers answered during the 2026-11-17 probe. */
export declare const MCP_PROTOCOL_VERSION = "2025-06-18";
export interface McpProbeOptions {
    /** The MCP endpoint, for example http://127.0.0.1:8765/mcp. */
    url: string;
    /** Extra request headers such as Authorization. Never logged, never put in an error message. */
    headers?: Record<string, string>;
    /** Total budget in ms. The probe stops and throws once it is spent. */
    timeoutMs: number;
    intervalMs?: number;
    /** Fewest tools the list must contain. Default 1. */
    minTools?: number;
    /** Injected in tests. Defaults to the global fetch. */
    fetchImpl?: typeof fetch;
    /** Injected in tests. Defaults to a real timer. */
    sleep?: (ms: number) => Promise<void>;
    /** Injected in tests. Defaults to Date.now. */
    now?: () => number;
}
/**
 * Parses a JSON-RPC reply that is plain JSON, an SSE body ("event: message\ndata: {...}"), or empty (a 202 to a
 * notification). It throws a fixed message on bad input and never echoes the reply text.
 */
export declare function parseJsonRpcBody(text: string): unknown;
/** Throws when a JSON-RPC reply carries an error. The code is kept, the message text is not. */
export declare function assertJsonRpcResult(reply: unknown, method: string): void;
/** Returns the tool names from a tools/list reply, or throws a message that names the problem. */
export declare function assertToolsList(reply: unknown, minTools: number): string[];
/**
 * Polls the MCP endpoint with real calls until tools/list succeeds, or until timeoutMs is spent.
 * On timeout it throws one line: `MCP_NOT_READY: <product> MCP at <url> not ready after <ms> ms (last: <reason>)`.
 */
/** Per-product convenience: one Authorization value, one budget. The header value is never logged. */
export declare function mcpReadinessFor(product: string, opts: {
    url: string;
    authorization?: string;
    timeoutMs: number;
    minTools?: number;
}): Promise<McpReadiness>;
export declare function waitForMcp(product: string, opts: McpProbeOptions): Promise<McpReadiness>;
/** Thrown when a tool call returns an error. The tool's text is not included: it can hold data from the file. */
export declare const MCP_TOOL_ERROR = "MCP_TOOL_ERROR";
/**
 * Calls one MCP tool over a fresh handshake and returns the first text block of its result. Headers (for example a
 * per-user token in the URL is not a header, but an Authorization value would be) are never logged or put in an error.
 */
export declare function callMcpTool(opts: {
    url: string;
    headers?: Record<string, string>;
    name: string;
    args: Record<string, unknown>;
    fetchImpl?: typeof fetch;
}): Promise<string>;
/** The first text block of a tools/call result. A result flagged isError throws MCP_TOOL_ERROR without its text. */
export declare function firstTextBlock(reply: unknown): string;
//# sourceMappingURL=mcp-ready.d.ts.map