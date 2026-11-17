import type { McpReadiness } from "./types.js";

/** Prefix of every MCP readiness failure. Messages name the product and URL, never a header value or token. */
export const MCP_NOT_READY = "MCP_NOT_READY";

/** Protocol version all five P4-capable servers answered during the 2026-11-17 probe. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

const DEFAULT_INTERVAL_MS = 2000;
const MAX_REASON_CHARS = 160;

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
export function parseJsonRpcBody(text: string): unknown {
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
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error("reply is not valid JSON (content not printed)");
  }
}

/** Throws when a JSON-RPC reply carries an error. The code is kept, the message text is not. */
export function assertJsonRpcResult(reply: unknown, method: string): void {
  const r = reply as { error?: { code?: unknown } };
  if (r && typeof r === "object" && r.error !== undefined) {
    throw new Error(`${method} returned a JSON-RPC error (code ${String(r.error.code)})`);
  }
}

/** Returns the tool names from a tools/list reply, or throws a message that names the problem. */
export function assertToolsList(reply: unknown, minTools: number): string[] {
  assertJsonRpcResult(reply, "tools/list");
  const tools = (reply as { result?: { tools?: unknown } } | undefined)?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("tools/list reply has no result.tools array");
  }
  const names = tools
    .map((tool) => (tool as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");
  if (names.length < minTools) {
    throw new Error(`tools/list returned ${names.length} tools, need at least ${minTools}`);
  }
  return names;
}

interface RpcReply {
  status: number;
  sessionId: string | null;
  body: unknown;
}

async function post(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string> | undefined,
  body: unknown,
  sessionId: string | null,
): Promise<RpcReply> {
  const requestHeaders: Record<string, string> = {
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
async function probeOnce(fetchImpl: typeof fetch, opts: McpProbeOptions): Promise<string[]> {
  const init = await post(
    fetchImpl,
    opts.url,
    opts.headers,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "qa-portfolio-harness", version: "p4" },
      },
    },
    null,
  );
  if (init.status !== 200) {
    throw new Error(`initialize HTTP ${init.status}`);
  }
  assertJsonRpcResult(init.body, "initialize");

  const notified = await post(
    fetchImpl,
    opts.url,
    opts.headers,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    init.sessionId,
  );
  if (notified.status !== 200 && notified.status !== 202) {
    throw new Error(`notifications/initialized HTTP ${notified.status}`);
  }

  const list = await post(
    fetchImpl,
    opts.url,
    opts.headers,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    init.sessionId,
  );
  if (list.status !== 200) {
    throw new Error(`tools/list HTTP ${list.status}`);
  }
  return assertToolsList(list.body, opts.minTools ?? 1);
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.slice(0, MAX_REASON_CHARS);
}

/**
 * Polls the MCP endpoint with real calls until tools/list succeeds, or until timeoutMs is spent.
 * On timeout it throws one line: `MCP_NOT_READY: <product> MCP at <url> not ready after <ms> ms (last: <reason>)`.
 */
export async function waitForMcp(product: string, opts: McpProbeOptions): Promise<McpReadiness> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  const deadline = start + opts.timeoutMs;
  let last = "no attempt made";

  for (;;) {
    try {
      const toolNames = await probeOnce(fetchImpl, opts);
      return { url: opts.url, toolCount: toolNames.length, toolNames, elapsedMs: now() - start };
    } catch (error) {
      last = reasonOf(error);
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(opts.intervalMs ?? DEFAULT_INTERVAL_MS, remaining));
  }
  throw new Error(
    `${MCP_NOT_READY}: ${product} MCP at ${opts.url} not ready after ${opts.timeoutMs} ms (last: ${last})`,
  );
}
