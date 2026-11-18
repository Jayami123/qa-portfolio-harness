import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectionStates,
  interestingLogLines,
  LIBRECHAT_APP_CONTAINER,
  mcpContainerFor,
  MCP_CONTAINERS,
  PROBE_SCRIPT,
  probeArgs,
  redactionValues,
  redactText,
  serversFor,
} from "./librechat-diag.js";

describe("librechat-diag (CI diagnostics, values never printed)", () => {
  it("collects every env-file value of useful length and every secret string", () => {
    const env = "PORT=3080\nP4_NEXTCLOUD_MCP_AUTHORIZATION=Basic dXNlcjpzZWNyZXQ=\nJWT_SECRET=jwt-value-123\n";
    const values = redactionValues(env, { ownerPassword: "owner-pw-456", count: 3 });
    assert.ok(values.includes("Basic dXNlcjpzZWNyZXQ="));
    assert.ok(values.includes("jwt-value-123"));
    assert.ok(values.includes("owner-pw-456"));
    assert.ok(!values.includes("3080"), "short values are not redacted, so they do not hide ordinary text");
  });

  it("replaces every collected value in a text", () => {
    const values = ["jwt-value-123", "Basic dXNlcjpzZWNyZXQ="];
    const out = redactText("token jwt-value-123 and Basic dXNlcjpzZWNyZXQ= end", values);
    assert.doesNotMatch(out, /jwt-value-123|dXNlcjpzZWNyZXQ/);
    assert.match(out, /\*\*\*/);
  });

  it("keeps MCP, allow-list and error lines and drops the rest, newest last", () => {
    const text = ["boot ok", "[MCP][nextcloud] Domain not allowed", "unrelated line", "error: disconnected", "tail"].join("\n");
    assert.deepEqual(interestingLogLines(text), ["[MCP][nextcloud] Domain not allowed", "error: disconnected"]);
    assert.equal(interestingLogLines("mcp a\nmcp b\nmcp c", 2).length, 2);
  });

  it("maps each server state, and marks a missing server", () => {
    const body = { connectionStatus: { nextcloud: { connectionState: "disconnected" }, penpot: { connectionState: "connected" } } };
    assert.deepEqual(connectionStates(body, ["nextcloud", "penpot", "outline"]), {
      nextcloud: "disconnected",
      penpot: "connected",
      outline: "missing",
    });
    assert.deepEqual(connectionStates(null, ["nextcloud"]), { nextcloud: "missing" });
  });

  it("names the LibreChat app container and the five MCP containers, and no others", () => {
    assert.equal(LIBRECHAT_APP_CONTAINER, "qa-harness-librechat-app-1");
    assert.deepEqual(Object.keys(MCP_CONTAINERS).sort(), ["mattermost", "nextcloud", "outline", "penpot", "twenty"]);
    assert.equal(mcpContainerFor("nextcloud"), "qa-harness-nextcloud-mcp-1");
    assert.equal(mcpContainerFor("cal"), undefined);
  });

  it("builds the probe argv from names, URLs and env variable names only", () => {
    const args = probeArgs(serversFor(["nextcloud", "penpot"]));
    assert.deepEqual(args.slice(0, 4), ["exec", LIBRECHAT_APP_CONTAINER, "node", "-e"]);
    const list = JSON.parse(args[args.length - 1] ?? "[]") as unknown[][];
    assert.deepEqual(list, [
      ["nextcloud", "http://nextcloud-mcp:8000/mcp", "P4_NEXTCLOUD_MCP_AUTHORIZATION"],
      ["penpot", "http://penpot-mcp:4401/mcp", null],
    ]);
  });

  it("the probe script resolves the host and reports status without printing headers", () => {
    assert.match(PROBE_SCRIPT, /dns\.lookup/);
    assert.match(PROBE_SCRIPT, /process\.env\[authEnv\]/);
    assert.doesNotMatch(PROBE_SCRIPT, /console\.log\([^)]*headers/);
  });
});
