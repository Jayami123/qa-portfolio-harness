import { assertJsonRpcResult, MCP_PROTOCOL_VERSION, parseJsonRpcBody } from "./mcp-ready.js";
/** Prefix of every failed tool call. The message names the tool and the step, never a reply body or a credential. */
export const MCP_TOOL_FAILED = "MCP_TOOL_FAILED";
/**
 * The payload of a tools/call reply: structuredContent when the server sends it, else the JSON text of the first content
 * item. A tool error (isError) throws with the tool name only: the text of an error can hold a message body.
 */
export function toolPayload(reply, tool) {
    assertJsonRpcResult(reply, `tools/call ${tool}`);
    const result = reply.result;
    if (!result)
        throw new Error(`${MCP_TOOL_FAILED}: ${tool} reply has no result`);
    if (result.isError === true)
        throw new Error(`${MCP_TOOL_FAILED}: ${tool} returned a tool error (text not printed)`);
    if (result.structuredContent !== undefined)
        return result.structuredContent;
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    if (typeof first?.text !== "string")
        throw new Error(`${MCP_TOOL_FAILED}: ${tool} reply has no payload`);
    try {
        return JSON.parse(first.text);
    }
    catch {
        throw new Error(`${MCP_TOOL_FAILED}: ${tool} payload is not JSON (content not printed)`);
    }
}
/**
 * One streamable-HTTP MCP session: initialize, notifications/initialized, then any number of tools/call. The
 * Authorization header is sent on every request and never logged or put in an error.
 */
export async function openMcpSession(opts) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    let sessionId = null;
    let nextId = 1;
    const post = async (body) => {
        const headers = {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: opts.authorization,
        };
        if (sessionId !== null)
            headers["mcp-session-id"] = sessionId;
        const response = await fetchImpl(opts.url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        sessionId = response.headers.get("mcp-session-id") ?? sessionId;
        if (response.status >= 400)
            throw new Error(`${MCP_TOOL_FAILED}: ${String(body.method)} returned HTTP ${response.status}`);
        const text = await response.text();
        return text.trim() === "" ? {} : parseJsonRpcBody(text);
    };
    await post({
        jsonrpc: "2.0",
        id: nextId++,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "qa-portfolio-harness", version: "0" } },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return async (tool, args) => toolPayload(await post({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: tool, arguments: args } }), tool);
}
//# sourceMappingURL=mcp-call.js.map