import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openClawResponsesBody, openClawRunResult, openClawWriteConfigArgs, readyzIsReady } from "./openclaw-seed.js";

const IMAGE = "ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:" + "a".repeat(64);

describe("openclaw-seed (review answer 0.5)", () => {
  it("writes the config as uid 1000 with no network, and never passes the config as an argument", () => {
    const args = openClawWriteConfigArgs(IMAGE, "qa-harness-openclaw-state");
    assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.ok(args.includes("-i"), "stdin is the config");
    assert.ok(args.includes("qa-harness-openclaw-state:/home/node/.openclaw"));
    assert.ok(!args.some((a) => a.includes("chown")), "no chown: the volume is already owned by uid 1000");
    assert.ok(!args.some((a) => a === "root" || a === "0:0" || a === "0"), "never root");
    assert.ok(!args.some((a) => a.includes("gatewayToken") || a.includes("apiKey")), "no secret or config in argv");
  });

  it("reads /readyz only when ready is true", () => {
    assert.equal(readyzIsReady({ ready: true, coreReady: true }), true);
    assert.equal(readyzIsReady({ ready: false }), false);
    assert.equal(readyzIsReady(null), false);
  });

  describe("headless run (POST /v1/responses)", () => {
    const tool = { name: "list_object_metadata_names", description: "List object names", parameters: { type: "object", properties: {} } };

    it("builds a stateless, non-streaming request for the default agent, with client function tools", () => {
      const body = openClawResponsesBody("do the task", [tool], true) as Record<string, any>;
      assert.equal(body.model, "openclaw/default");
      assert.equal(body.input, "do the task");
      assert.equal(body.stream, false);
      assert.equal(body.tool_choice, "required");
      assert.deepEqual(body.tools, [{ type: "function", ...tool }]);
      assert.equal("previous_response_id" in body, false);
    });

    it("uses tool_choice auto when a tool is not required, and sends no tools key when none are offered", () => {
      assert.equal((openClawResponsesBody("t", [tool], false) as Record<string, unknown>).tool_choice, "auto");
      const none = openClawResponsesBody("t", [], true) as Record<string, unknown>;
      assert.equal("tools" in none, false);
      assert.equal("tool_choice" in none, false);
    });

    it("reads the trace: every function_call item in order, with parsed arguments and the call id", () => {
      const result = openClawRunResult(200, {
        id: "resp_1",
        output: [
          { type: "function_call", call_id: "call_a", name: "search_records", arguments: '{"query":"fake-alpha","limit":5}' },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
          { type: "function_call", id: "fc_b", name: "second", arguments: "not json" },
        ],
      });
      assert.equal(result.status, 200);
      assert.equal(result.responseId, "resp_1");
      assert.deepEqual(result.toolCalls, [
        { callId: "call_a", name: "search_records", arguments: { query: "fake-alpha", limit: 5 } },
        { callId: "fc_b", name: "second", arguments: { _unparsed: true } },
      ]);
      assert.equal(result.text, "done");
    });

    it("returns an empty trace, not a pass, when the response has no function_call", () => {
      assert.deepEqual(openClawRunResult(200, { id: "r", output: [] }).toolCalls, []);
      assert.deepEqual(openClawRunResult(200, null).toolCalls, []);
      assert.deepEqual(openClawRunResult(200, { output: "nope" }).toolCalls, []);
    });
  });
});
