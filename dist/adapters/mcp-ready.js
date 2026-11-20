/** Prefix of every MCP readiness failure. Messages name the product and URL, never a header value or token. */
export const MCP_NOT_READY = "MCP_NOT_READY";
/** Protocol version all five P4-capable servers answered during the 2026-11-17 probe. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_INTERVAL_MS = 2000;
const MAX_REASON_CHARS = 160;
/**
 * Parses a JSON-RPC reply that is plain JSON, an SSE body ("event: message\ndata: {...}"), or empty (a 202 to a
 * notification). It throws a fixed message on bad input and never echoes the reply text.
 */
export function parseJsonRpcBody(text) {
    const trimmed = text.trim();
    if (trimmed === "") {
        return {};
    }
    let payload = trimmed;
    if (!trimmed.startsWith("{")) {
        const dataLine = trimmed.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (dataLine === undefined) {
            throw new Error("reply has neither a JSON body nor an SSE data line");
        }
        payload = dataLine.slice("data:".length).trim();
    }
    try {
        return JSON.parse(payload);
    }
    catch {
        throw new Error("reply is not valid JSON (content not printed)");
    }
}
/** Throws when a JSON-RPC reply carries an error. The code is kept, the message text is not. */
export function assertJsonRpcResult(reply, method) {
    const r = reply;
    if (r && typeof r === "object" && r.error !== undefined) {
        throw new Error(`${method} returned a JSON-RPC error (code ${String(r.error.code)})`);
    }
}
/** Returns the tool names from a tools/list reply, or throws a message that names the problem. */
export function assertToolsList(reply, minTools) {
    assertJsonRpcResult(reply, "tools/list");
    const tools = reply?.result?.tools;
    if (!Array.isArray(tools)) {
        throw new Error("tools/list reply has no result.tools array");
    }
    const names = tools
        .map((tool) => tool?.name)
        .filter((name) => typeof name === "string" && name !== "");
    if (names.length < minTools) {
        throw new Error(`tools/list returned ${names.length} tools, need at least ${minTools}`);
    }
    return names;
}
async function post(fetchImpl, url, headers, body, sessionId) {
    const requestHeaders = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
    };
    if (sessionId !== null) {
        requestHeaders["mcp-session-id"] = sessionId;
    }
    const response = await fetchImpl(url, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
    const text = await response.text();
    return {
        status: response.status,
        sessionId: response.headers.get("mcp-session-id"),
        body: text.trim() === "" ? {} : parseJsonRpcBody(text),
    };
}
/** One full handshake. Throws with a short reason on any failure. */
async function probeOnce(fetchImpl, opts) {
    const init = await post(fetchImpl, opts.url, opts.headers, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "qa-portfolio-harness", version: "p4" },
        },
    }, null);
    if (init.status !== 200) {
        throw new Error(`initialize HTTP ${init.status}`);
    }
    assertJsonRpcResult(init.body, "initialize");
    const notified = await post(fetchImpl, opts.url, opts.headers, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId);
    if (notified.status !== 200 && notified.status !== 202) {
        throw new Error(`notifications/initialized HTTP ${notified.status}`);
    }
    const list = await post(fetchImpl, opts.url, opts.headers, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.sessionId);
    if (list.status !== 200) {
        throw new Error(`tools/list HTTP ${list.status}`);
    }
    return assertToolsList(list.body, opts.minTools ?? 1);
}
function reasonOf(error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return message.slice(0, MAX_REASON_CHARS);
}
/**
 * Polls the MCP endpoint with real calls until tools/list succeeds, or until timeoutMs is spent.
 * On timeout it throws one line: `MCP_NOT_READY: <product> MCP at <url> not ready after <ms> ms (last: <reason>)`.
 */
/** Per-product convenience: one Authorization value, one budget. The header value is never logged. */
export function mcpReadinessFor(product, opts) {
    return waitForMcp(product, {
        url: opts.url,
        headers: opts.authorization === undefined ? undefined : { authorization: opts.authorization },
        timeoutMs: opts.timeoutMs,
        minTools: opts.minTools,
    });
}
export async function waitForMcp(product, opts) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = opts.now ?? Date.now;
    const start = now();
    const deadline = start + opts.timeoutMs;
    let last = "no attempt made";
    for (;;) {
        try {
            const toolNames = await probeOnce(fetchImpl, opts);
            return { url: opts.url, toolCount: toolNames.length, toolNames, elapsedMs: now() - start };
        }
        catch (error) {
            last = reasonOf(error);
        }
        const remaining = deadline - now();
        if (remaining <= 0) {
            break;
        }
        await sleep(Math.min(opts.intervalMs ?? DEFAULT_INTERVAL_MS, remaining));
    }
    throw new Error(`${MCP_NOT_READY}: ${product} MCP at ${opts.url} not ready after ${opts.timeoutMs} ms (last: ${last})`);
}
/** Thrown when a tool call returns an error. The tool's text is not included: it can hold data from the file. */
export const MCP_TOOL_ERROR = "MCP_TOOL_ERROR";
/**
 * Calls one MCP tool over a fresh handshake and returns the first text block of its result. Headers (for example a
 * per-user token in the URL is not a header, but an Authorization value would be) are never logged or put in an error.
 */
export async function callMcpTool(opts) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const init = await post(fetchImpl, opts.url, opts.headers, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "qa-portfolio-harness", version: "p4" } },
    }, null);
    if (init.status !== 200) {
        throw new Error(`initialize HTTP ${init.status}`);
    }
    assertJsonRpcResult(init.body, "initialize");
    const notified = await post(fetchImpl, opts.url, opts.headers, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId);
    if (notified.status !== 200 && notified.status !== 202) {
        throw new Error(`notifications/initialized HTTP ${notified.status}`);
    }
    const call = await post(fetchImpl, opts.url, opts.headers, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: opts.name, arguments: opts.args } }, init.sessionId);
    if (call.status !== 200) {
        throw new Error(`tools/call HTTP ${call.status}`);
    }
    assertJsonRpcResult(call.body, "tools/call");
    return firstTextBlock(call.body);
}
/** The first text block of a tools/call result. A result flagged isError throws MCP_TOOL_ERROR without its text. */
export function firstTextBlock(reply) {
    const result = reply?.result;
    if (result?.isError === true) {
        throw new Error(`${MCP_TOOL_ERROR}: the tool returned an error (text not printed)`);
    }
    const block = (result?.content ?? []).find((item) => item.type === "text" && typeof item.text === "string");
    if (!block || typeof block.text !== "string") {
        throw new Error(`${MCP_TOOL_ERROR}: the tool result had no text block (body not printed)`);
    }
    return block.text;
}
//# sourceMappingURL=mcp-ready.js.map