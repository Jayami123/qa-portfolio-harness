import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { HARNESS_ROOT } from "../paths.js";
import {
  fileNameFromToolText,
  PENPOT_PLUGIN_CODE,
  PENPOT_PLUGIN_FILE,
  PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY,
  PENPOT_PLUGIN_INVALID,
  PENPOT_PLUGIN_STATE_INVALID,
  parsePluginState,
  penpotPluginOption,
  perUserPluginOk,
  pluginStateFileName,
  withUserToken,
} from "./penpot-plugin.js";
import { penpotComposeFiles } from "./penpot-env.js";
import { callMcpTool, firstTextBlock, MCP_TOOL_ERROR } from "./mcp-ready.js";

const TOKEN = "tok-" + "z".repeat(40);

describe("H6 flag: off by default, exact \"1\" only, and it needs the second identity", () => {
  it("is off when unset", () => {
    assert.equal(penpotPluginOption("", ""), false);
  });
  it("is on for exactly 1 together with the second identity", () => {
    assert.equal(penpotPluginOption("1", "1"), true);
  });
  it("needs P4_SECOND_IDENTITY=1", () => {
    assert.throws(() => penpotPluginOption("1", ""), (err: Error) => err.message.startsWith(PENPOT_PLUGIN_NEEDS_SECOND_IDENTITY));
  });
  it("rejects every other value without echoing it", () => {
    for (const bad of ["zz-value-0", "true", "yes", " 1"]) {
      assert.throws(
        () => penpotPluginOption(bad, "1"),
        (err: Error) => err.message.startsWith(PENPOT_PLUGIN_INVALID) && !err.message.includes("zz-"),
        `value ${JSON.stringify(bad)}`,
      );
    }
  });
});

describe("H6 compose files: the multi-user override is added only when on", () => {
  it("is the base file alone when off", () => {
    assert.deepEqual(penpotComposeFiles(false).map((f) => path.basename(f)), ["penpot.compose.yml"]);
    assert.deepEqual(penpotComposeFiles().map((f) => path.basename(f)), ["penpot.compose.yml"]);
  });
  it("adds the multi-user override after the base file when on", () => {
    assert.deepEqual(penpotComposeFiles(true).map((f) => path.basename(f)), ["penpot.compose.yml", "penpot.multiuser.compose.yml"]);
  });
  it("the override runs the MCP with --multi-user and sets enable-mcp, leaving the base file untouched", () => {
    const override = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "penpot.multiuser.compose.yml"), "utf8");
    assert.ok(override.includes('"--multi-user"'));
    assert.ok(override.includes("enable-mcp"));
    const base = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "penpot.compose.yml"), "utf8");
    assert.ok(!base.includes("enable-mcp"));
    assert.ok(!base.includes('"--multi-user"'));
  });
});

describe("H6 tab state: one file per profile, shape checked, token never echoed", () => {
  it("names the file by role", () => {
    assert.equal(pluginStateFileName("owner"), "penpot-plugin-owner.json");
    assert.equal(pluginStateFileName("second"), "penpot-plugin-second.json");
  });
  it("reads a well-formed state", () => {
    const text = JSON.stringify({ version: 1, role: "owner", email: "x", fileName: PENPOT_PLUGIN_FILE.owner, mcpToken: TOKEN });
    assert.deepEqual(parsePluginState(text, "owner"), { role: "owner", fileName: PENPOT_PLUGIN_FILE.owner, mcpToken: TOKEN });
  });
  it("rejects a state for the other role, a missing token, or bad JSON, without echoing the content", () => {
    const wrongRole = JSON.stringify({ version: 1, role: "second", fileName: "f", mcpToken: TOKEN });
    const noToken = JSON.stringify({ version: 1, role: "owner", fileName: "f", mcpToken: "" });
    for (const text of [wrongRole, noToken, "not json " + TOKEN]) {
      assert.throws(
        () => parsePluginState(text, "owner"),
        (err: Error) => err.message.startsWith(PENPOT_PLUGIN_STATE_INVALID) && !err.message.includes(TOKEN),
      );
    }
  });
});

describe("H6 requests and results", () => {
  it("builds the MCP URL with the user token as a query parameter, encoded", () => {
    const url = withUserToken("http://127.0.0.1:4401/mcp", "a b/c+d");
    assert.equal(new URL(url).pathname, "/mcp");
    assert.equal(new URL(url).searchParams.get("userToken"), "a b/c+d");
    assert.ok(url.includes("userToken=a+b%2Fc%2Bd"));
  });
  it("reads a JSON string or plain text from the execute_code reply", () => {
    assert.equal(fileNameFromToolText(JSON.stringify("h6-owner-file")), "h6-owner-file");
    assert.equal(fileNameFromToolText("h6-second-file\n"), "h6-second-file");
  });
  it("takes the first text block of a tools/call result, and throws without echoing an error", () => {
    assert.equal(firstTextBlock({ result: { content: [{ type: "text", text: "hi" }] } }), "hi");
    assert.throws(() => firstTextBlock({ result: { isError: true, content: [{ type: "text", text: "secret-file-name" }] } }), (err: Error) => err.message.startsWith(MCP_TOOL_ERROR) && !err.message.includes("secret-file-name"));
    assert.throws(() => firstTextBlock({ result: { content: [] } }), new RegExp(MCP_TOOL_ERROR));
  });
  it("sends tools/call with the name and arguments, and returns the text", async () => {
    const seen: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method?: string; id?: number; params?: unknown };
      seen.push(body);
      const headers = { "content-type": "application/json", "mcp-session-id": "s1" };
      if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200, headers });
      if (body.method === "notifications/initialized") return new Response("", { status: 202, headers });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify("h6-owner-file") }] } }), { status: 200, headers });
    }) as typeof fetch;
    const text = await callMcpTool({ url: "http://127.0.0.1:4401/mcp?userToken=t", name: "execute_code", args: { code: PENPOT_PLUGIN_CODE }, fetchImpl: fakeFetch });
    assert.equal(fileNameFromToolText(text), "h6-owner-file");
    const call = seen[seen.length - 1] as { method: string; params: { name: string; arguments: { code: string } } };
    assert.equal(call.method, "tools/call");
    assert.equal(call.params.name, "execute_code");
    assert.equal(call.params.arguments.code, PENPOT_PLUGIN_CODE);
  });
});

describe("H6 pass rule and the tab script's contract with the probe", () => {
  const base = { ownerFile: "h6-owner-file", secondFile: "h6-second-file", distinct: true, ownerMatches: true, secondMatches: true, ownerTools: 9, secondTools: 9 };
  it("passes only when the names differ, each matches its own file, and both tools lists are non-empty", () => {
    assert.equal(perUserPluginOk(base), true);
    assert.equal(perUserPluginOk({ ...base, distinct: false, secondFile: "h6-owner-file" }), false);
    assert.equal(perUserPluginOk({ ...base, ownerMatches: false }), false);
    assert.equal(perUserPluginOk({ ...base, secondTools: 0 }), false);
  });
  it("the tab script opens each profile's file by the same names the probe expects, and watches /mcp/ws", () => {
    const script = fs.readFileSync(path.join(HARNESS_ROOT, "scripts", "penpot-plugin-tabs.mjs"), "utf8");
    assert.ok(script.includes(`fileName: "${PENPOT_PLUGIN_FILE.owner}"`));
    assert.ok(script.includes(`fileName: "${PENPOT_PLUGIN_FILE.second}"`));
    assert.ok(script.includes('url.pathname === "/mcp/ws"'));
    assert.ok(script.includes("mode: 0o600"));
  });
});
