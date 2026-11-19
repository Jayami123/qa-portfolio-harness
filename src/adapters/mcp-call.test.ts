import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MCP_TOOL_FAILED, openMcpSession, toolPayload } from "./mcp-call.js";

describe("toolPayload", () => {
  it("returns structuredContent when the server sends it", () => {
    assert.deepEqual(toolPayload({ result: { structuredContent: { results: [1] } } }, "t"), { results: [1] });
  });

  it("parses the JSON text of the first content item otherwise", () => {
    assert.deepEqual(toolPayload({ result: { content: [{ type: "text", text: '{"success":true}' }] } }, "t"), { success: true });
  });

  it("throws on a tool error with the tool name only, never the text", () => {
    assert.throws(
      () => toolPayload({ result: { isError: true, content: [{ text: "message body with a secret" }] } }, "nc_mail_send_message"),
      (error: Error) => {
        assert.match(error.message, new RegExp(`^${MCP_TOOL_FAILED}: nc_mail_send_message`));
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  });

  it("throws on a JSON-RPC error with the code only", () => {
    assert.throws(
      () => toolPayload({ error: { code: -32000, message: "boom with detail" } }, "t"),
      (error: Error) => {
        assert.match(error.message, /code -32000/);
        assert.equal(error.message.includes("detail"), false);
        return true;
      },
    );
  });

  it("throws on a payload that is not JSON, without printing it", () => {
    assert.throws(() => toolPayload({ result: { content: [{ text: "not json here" }] } }, "t"), /not printed/);
  });
});

/** A fetch stand-in that records each request and answers with a JSON body and an optional session id. */
function scriptedFetch(answers: unknown[]): { fetchImpl: typeof fetch; requests: { body: Record<string, unknown>; headers: Record<string, string> }[] } {
  const requests: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers });
    const answer = answers.shift() ?? {};
    const text = answer === "" ? "" : JSON.stringify(answer);
    return new Response(text, { status: 200, headers: { "mcp-session-id": "sess-1" } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("openMcpSession", () => {
  it("runs initialize, the initialized notice, then tools/call, sending the session id and the credential", async () => {
    const { fetchImpl, requests } = scriptedFetch([
      { jsonrpc: "2.0", id: 1, result: {} },
      "",
      { jsonrpc: "2.0", id: 2, result: { structuredContent: { success: true, results: [] } } },
    ]);
    const call = await openMcpSession({ url: "http://127.0.0.1:8765/mcp", authorization: "Basic abc", fetchImpl });
    const payload = await call("nc_mail_list_accounts", {});
    assert.deepEqual(payload, { success: true, results: [] });
    assert.deepEqual(
      requests.map((r) => r.body.method),
      ["initialize", "notifications/initialized", "tools/call"],
    );
    assert.equal(requests[0]?.headers.authorization, "Basic abc");
    assert.equal(requests[2]?.headers["mcp-session-id"], "sess-1");
    assert.deepEqual(requests[2]?.body.params, { name: "nc_mail_list_accounts", arguments: {} });
  });

  it("fails with the HTTP status and the method, not the body or the credential", async () => {
    const failing = (async () => new Response("denied with a body", { status: 401 })) as typeof fetch;
    await assert.rejects(
      openMcpSession({ url: "http://x/mcp", authorization: "Basic very-secret", fetchImpl: failing }),
      (error: Error) => {
        assert.match(error.message, /initialize returned HTTP 401/);
        assert.equal(error.message.includes("very-secret"), false);
        assert.equal(error.message.includes("denied with a body"), false);
        return true;
      },
    );
  });
});
