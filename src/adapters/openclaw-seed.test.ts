import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSkillName,
  assertWorkspaceRelativePath,
  OPENCLAW_APPROVALS_GET_COMMAND,
  OPENCLAW_APPROVALS_PENDING_COMMAND,
  openClawCronCreateCommand,
  openClawMemoryPath,
  openClawResponsesBody,
  openClawRunResult,
  openClawSeedFileArgs,
  openClawSkillPath,
  openClawWriteConfigArgs,
  parseOpenClawApprovals,
  parseOpenClawPendingApprovals,
  readyzIsReady,
} from "./openclaw-seed.js";

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

describe("H2 seed primitive (docs/concepts/agent-workspace.md, tools/skills.md, concepts/memory.md at 2026.10.33)", () => {
  it("writes one file as uid 1000 with no network; content on stdin, path as a positional parameter, never in the script text", () => {
    const args = openClawSeedFileArgs(IMAGE, "qa-harness-openclaw-state", "p4/m1.txt");
    assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.ok(args.includes("-i"));
    assert.equal(args[args.indexOf("-v") + 1], "qa-harness-openclaw-state:/home/node/.openclaw");
    const script = args[args.indexOf("-c") + 1] ?? "";
    assert.match(script, /^set -e; f="\/home\/node\/\.openclaw\/workspace\/\$1"/);
    assert.equal(script.includes("p4/m1.txt"), false, "the path is not interpolated into the script");
    assert.deepEqual(args.slice(-2), ["seed", "p4/m1.txt"]);
  });

  it("rejects absolute paths, parent segments, hidden segments, backslashes, NUL and empty segments without echoing them", () => {
    for (const bad of ["", "/etc/passwd", "../x", "a/../x", "a//b", ".hidden", "a/.ssh/k", "a\\b", "a\0b", "a/./b", "x".repeat(201)]) {
      assert.throws(() => assertWorkspaceRelativePath(bad), (err: Error) => {
        assert.match(err.message, /OPENCLAW_SEED_PATH_INVALID/);
        assert.equal(bad !== "" && err.message.includes(bad), false);
        return true;
      });
      assert.throws(() => openClawSeedFileArgs(IMAGE, "v", bad), /OPENCLAW_SEED_PATH_INVALID/);
    }
    assert.equal(assertWorkspaceRelativePath("notes/a-1_b.txt"), "notes/a-1_b.txt");
  });

  it("maps memory and skill names to their workspace paths and refuses anything else", () => {
    assert.equal(openClawMemoryPath("MEMORY.md"), "MEMORY.md");
    assert.equal(openClawMemoryPath("2026-11-18.md"), "memory/2026-11-18.md");
    assert.equal(openClawMemoryPath("2026-11-18-slug.md"), "memory/2026-11-18-slug.md");
    for (const bad of ["a/b.md", "../MEMORY.md", "x.txt", ".md", "memory.md/../x.md"]) {
      assert.throws(() => openClawMemoryPath(bad), /OPENCLAW_SEED_NAME_INVALID/);
    }
    assert.equal(openClawSkillPath("research"), "skills/research/SKILL.md");
    assert.equal(assertSkillName("p4-skill-1"), "p4-skill-1");
    for (const bad of ["", "A", "a/b", "..", "a b", "-a"]) {
      assert.throws(() => assertSkillName(bad), /OPENCLAW_SEED_NAME_INVALID/);
    }
  });

  it("builds the cron create command with every value as its own argv entry", () => {
    const cmd = openClawCronCreateCommand({ name: "Morning brief", schedule: "0 7 * * *", message: "Summarize; rm -rf / $(x)" });
    assert.deepEqual(cmd, ["openclaw", "automations", "create", "0 7 * * *", "Summarize; rm -rf / $(x)", "--name", "Morning brief", "--session", "isolated"]);
    assert.throws(() => openClawCronCreateCommand({ name: "ok", schedule: "0 7 * *", message: "m" }), /OPENCLAW_SEED_CRON_INVALID/);
    assert.throws(() => openClawCronCreateCommand({ name: "ok", schedule: "0 7 * * *; x", message: "m" }), /OPENCLAW_SEED_CRON_INVALID/);
    assert.throws(() => openClawCronCreateCommand({ name: "ok", schedule: "0 7 * * *", message: "--flag" }), /OPENCLAW_SEED_CRON_INVALID/);
    assert.throws(() => openClawCronCreateCommand({ name: "bad;name", schedule: "0 7 * * *", message: "m" }), /OPENCLAW_SEED_NAME_INVALID/);
  });
});

describe("H3 approvals read primitive (docs/cli/approvals.md at 2026.10.33)", () => {
  it("uses the documented read-only commands", () => {
    assert.deepEqual(OPENCLAW_APPROVALS_GET_COMMAND, ["openclaw", "approvals", "get", "--json"]);
    assert.deepEqual(OPENCLAW_APPROVALS_PENDING_COMMAND, ["openclaw", "approvals", "pending", "--json"]);
  });

  it("drops the socket object and its token from the approvals document", () => {
    const text = JSON.stringify({
      version: 1,
      socket: { path: "/x.sock", token: "SECRET-TOKEN" },
      defaults: { security: "deny", ask: "on-miss", askFallback: "deny" },
      agents: { main: { allowlist: [{ pattern: "/bin/ls" }], socket: { token: "SECRET-TOKEN" } } },
    });
    const parsed = parseOpenClawApprovals(text);
    assert.equal(JSON.stringify(parsed).includes("SECRET-TOKEN"), false);
    assert.equal("socket" in parsed, false);
    assert.deepEqual(parsed.defaults, { security: "deny", ask: "on-miss", askFallback: "deny" });
    assert.deepEqual((parsed.agents as any).main.allowlist, [{ pattern: "/bin/ls" }]);
  });

  it("reads pending approvals from a bare array or an { approvals } object", () => {
    assert.deepEqual(parseOpenClawPendingApprovals('[{"id":"a1","kind":"exec"}]'), [{ id: "a1", kind: "exec" }]);
    assert.deepEqual(parseOpenClawPendingApprovals('{"approvals":[{"id":"a2"}]}'), [{ id: "a2" }]);
    assert.deepEqual(parseOpenClawPendingApprovals("[]"), []);
  });

  it("throws on non-JSON or the wrong shape and prints none of the output", () => {
    for (const bad of ["not json TOKEN-123", "[1,2]", '{"approvals":"x"}', "null"]) {
      assert.throws(() => parseOpenClawPendingApprovals(bad), (err: Error) => {
        assert.match(err.message, /OPENCLAW_APPROVALS_UNPARSEABLE/);
        assert.doesNotMatch(err.message, /TOKEN-123/);
        return true;
      });
    }
    assert.throws(() => parseOpenClawApprovals("[]"), /OPENCLAW_APPROVALS_UNPARSEABLE/);
    assert.throws(() => parseOpenClawApprovals("oops SECRET"), (err: Error) => !/SECRET/.test(err.message));
  });
});
