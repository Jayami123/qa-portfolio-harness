import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertJsonRpcResult,
  assertToolsList,
  MCP_NOT_READY,
  parseJsonRpcBody,
  waitForMcp,
} from "./mcp-ready.js";

/** A fake clock: sleep advances time, so no test waits in real time. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const INIT_OK = { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "x" } } };
const LIST_OK = { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "list_documents" }, { name: "fetch" }] } };

describe("parseJsonRpcBody", () => {
  it("reads plain JSON and an SSE data line to the same value", () => {
    const body = { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a" }] } };
    assert.deepEqual(parseJsonRpcBody(JSON.stringify(body)), body);
    assert.deepEqual(parseJsonRpcBody(`event: message\ndata: ${JSON.stringify(body)}\n\n`), body);
  });

  it("returns an empty object for an empty body (a 202 to a notification)", () => {
    assert.deepEqual(parseJsonRpcBody("   "), {});
  });

  it("throws a fixed message and never echoes the reply text", () => {
    const secret = "tok_SHOULD_NOT_APPEAR";
    assert.throws(() => parseJsonRpcBody(`{"broken": "${secret}`), (e: Error) => !e.message.includes(secret));
    assert.throws(() => parseJsonRpcBody(`plain ${secret}`), (e: Error) => !e.message.includes(secret));
  });
});

describe("assertJsonRpcResult and assertToolsList", () => {
  it("rejects a JSON-RPC error and keeps only the code", () => {
    assert.throws(
      () => assertJsonRpcResult({ error: { code: -32600, message: "secret detail" } }, "initialize"),
      (e: Error) => e.message.includes("-32600") && !e.message.includes("secret detail"),
    );
  });

  it("rejects an empty list, a missing array and a below-minimum list", () => {
    assert.throws(() => assertToolsList({ result: { tools: [] } }, 1), /returned 0 tools/);
    assert.throws(() => assertToolsList({ result: {} }, 1), /no result.tools array/);
    assert.throws(() => assertToolsList({ result: { tools: [{ name: "a" }] } }, 4), /need at least 4/);
  });

  it("returns the names and skips entries without a name", () => {
    assert.deepEqual(assertToolsList({ result: { tools: [{ name: "a" }, { name: "" }, {}, { name: "b" }] } }, 1), [
      "a",
      "b",
    ]);
  });
});

describe("waitForMcp", () => {
  it("retries until the handshake succeeds and forwards the session id", async () => {
    const clock = fakeClock();
    const seen: { method: string; session: string | null; auth: string | null }[] = [];
    const replies = [
      () => json(401, { error: "unauthorized" }),
      () => json(200, INIT_OK, { "mcp-session-id": "sess-1" }),
      () => new Response("", { status: 202 }),
      () => json(200, LIST_OK),
    ];
    let call = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = JSON.parse(String(init.body)) as { method: string };
      seen.push({ method: body.method, session: headers["mcp-session-id"] ?? null, auth: headers.authorization ?? null });
      const reply = replies[call];
      call += 1;
      if (reply === undefined) {
        throw new Error("unexpected extra request");
      }
      return reply();
    }) as typeof fetch;

    const result = await waitForMcp("nextcloud", {
      url: "http://127.0.0.1:8765/mcp",
      headers: { authorization: "Basic dGVzdDp0ZXN0" },
      timeoutMs: 60_000,
      intervalMs: 1000,
      fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
    });

    assert.equal(result.toolCount, 2);
    assert.deepEqual(result.toolNames, ["list_documents", "fetch"]);
    const last = seen.at(-1);
    assert.ok(last, "at least one request was sent");
    assert.equal(last.method, "tools/list");
    assert.equal(last.session, "sess-1");
    assert.equal(last.auth, "Basic dGVzdDp0ZXN0");
  });

  it("throws MCP_NOT_READY with the product, URL and last reason, and never the header value", async () => {
    const clock = fakeClock();
    const secret = "Bearer tok_SHOULD_NOT_APPEAR";
    const fetchImpl = (async () => json(401, { error: "no" })) as typeof fetch;
    await assert.rejects(
      () =>
        waitForMcp("outline", {
          url: "http://127.0.0.1:3010/mcp",
          headers: { authorization: secret },
          timeoutMs: 5000,
          intervalMs: 2000,
          fetchImpl,
          sleep: clock.sleep,
          now: clock.now,
        }),
      (e: Error) =>
        e.message.startsWith(MCP_NOT_READY) &&
        e.message.includes("outline") &&
        e.message.includes("http://127.0.0.1:3010/mcp") &&
        e.message.includes("initialize HTTP 401") &&
        !e.message.includes("tok_SHOULD_NOT_APPEAR"),
    );
  });

  it("fails when the list is shorter than minTools, even though the handshake works", async () => {
    const clock = fakeClock();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method: string };
      if (body.method === "initialize") return json(200, INIT_OK);
      if (body.method === "tools/list") return json(200, LIST_OK);
      return new Response("", { status: 202 });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        waitForMcp("penpot", {
          url: "http://127.0.0.1:4401/mcp",
          timeoutMs: 1000,
          minTools: 4,
          intervalMs: 500,
          fetchImpl,
          sleep: clock.sleep,
          now: clock.now,
        }),
      (e: Error) => e.message.includes(MCP_NOT_READY) && e.message.includes("need at least 4"),
    );
  });
});
