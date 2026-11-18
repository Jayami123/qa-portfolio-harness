import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stubCompletionRequest } from "./litellm-seed.js";
import {
  assertEmptyToolsList,
  assertLiteLlmModels,
  assertNoNightlyCall,
  stubRouteFromHeaders,
  toolsFromMcpReply,
} from "./litellm-seed.js";

const headers = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });

describe("litellm-seed (readiness parsing, no model call)", () => {
  it("accepts exactly the two aliases in any order", () => {
    assert.deepEqual(assertLiteLlmModels({ data: [{ id: "p4-nightly" }, { id: "p4-stub" }] }), ["p4-nightly", "p4-stub"]);
  });

  it("throws when an alias is missing or an extra one is present, without echoing the body", () => {
    assert.throws(() => assertLiteLlmModels({ data: [{ id: "p4-stub" }] }), /LITELLM_ALIASES_WRONG/);
    assert.throws(
      () => assertLiteLlmModels({ data: [{ id: "p4-stub" }, { id: "p4-nightly" }, { id: "gpt-x" }] }),
      /LITELLM_ALIASES_WRONG/,
    );
    assert.throws(
      () => assertLiteLlmModels({ data: [{ id: "secret-sk-123" }] }),
      (err: Error) => !err.message.includes("secret-sk-123"),
    );
    assert.throws(() => assertLiteLlmModels({}), /LITELLM_MODELS_MISSING/);
  });

  it("reads the stub route from headers and refuses any other group", () => {
    assert.deepEqual(
      stubRouteFromHeaders(
        headers({ "x-litellm-model-group": "p4-stub", "x-litellm-model-name": "openai/stub-upstream-model" }),
      ),
      { alias: "p4-stub", upstream: "openai/stub-upstream-model" },
    );
    assert.throws(
      () => stubRouteFromHeaders(headers({ "x-litellm-model-group": "p4-nightly", "x-litellm-model-name": "gemini/x" })),
      /LITELLM_ROUTE_WRONG/,
    );
    assert.throws(() => stubRouteFromHeaders(headers({ "x-litellm-model-group": "p4-stub" })), /LITELLM_ROUTE_WRONG/);
  });

  it("builds only p4-stub completions and refuses a request that names the Gemma alias", () => {
    const req = stubCompletionRequest("http://127.0.0.1:4000/v1", "sk-x");
    assert.equal(req.url, "http://127.0.0.1:4000/v1/chat/completions");
    assert.doesNotThrow(() => assertNoNightlyCall(req.init));
    assert.throws(
      () => assertNoNightlyCall({ body: JSON.stringify({ model: "p4-nightly" }) }),
      /LITELLM_NIGHTLY_CALL_REFUSED/,
    );
  });

  it("reads tools from a JSON reply and from an SSE data line", () => {
    assert.deepEqual(toolsFromMcpReply('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}'), []);
    assert.deepEqual(toolsFromMcpReply('event: message\ndata: {"result":{"tools":[]}}\n'), []);
    assert.equal(toolsFromMcpReply('data: {"result":{"tools":[{"name":"x"}]}}').length, 1);
  });

  it("asserts an empty tools list and names the count when it is not empty", () => {
    assert.doesNotThrow(() => assertEmptyToolsList('event: message\ndata: {"result":{"tools":[]}}'));
    assert.throws(() => assertEmptyToolsList('data: {"result":{"tools":[{"name":"x"}]}}'), /LITELLM_MCP_NOT_EMPTY: .*1 tools/);
  });

  it("does not echo a malformed MCP reply", () => {
    assert.throws(
      () => toolsFromMcpReply("not json secret-token-123"),
      (err: Error) => !err.message.includes("secret-token-123"),
    );
  });
});
