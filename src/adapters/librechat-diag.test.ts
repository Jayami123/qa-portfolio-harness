import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  connectionStates,
  interestingLogLines,
  LIBRECHAT_APP_CONTAINER,
  mcpContainerFor,
  MCP_CONTAINERS,
  MCP_TRACE_TAG,
  mcpTraceHosts,
  parseMcpTrace,
  PROBE_SCRIPT,
  probeArgs,
  redactionValues,
  redactText,
  serversFor,
  summarizeMcpTrace,
} from "./librechat-diag.js";

describe("librechat-diag (CI diagnostics, values never printed)", () => {
  it("collects every env-file value of useful length and every secret string", () => {
    const env = "PORT=3080\nP4_NEXTCLOUD_MCP_AUTHORIZATION=Basic dXNlcjpzZWNyZXQ=\nJWT_SECRET=jwt-value-123\n";
    const values = redactionValues(env, { ownerPassword: "owner-pw-456", count: 3 });
    assert.ok(values.includes("Basic dXNlcjpzZWNyZXQ="));
    assert.ok(values.includes("jwt-value-123"));
    assert.ok(values.includes("owner-pw-456"));
    assert.ok(!values.includes("3080"), "short values are not redacted");
  });

  it("replaces every collected value in a text", () => {
    const out = redactText("token jwt-value-123 and Basic dXNlcjpzZWNyZXQ= end", ["jwt-value-123", "Basic dXNlcjpzZWNyZXQ="]);
    assert.doesNotMatch(out, /jwt-value-123|dXNlcjpzZWNyZXQ/);
    assert.match(out, /\*\*\*/);
  });

  it("keeps MCP, allow-list and error lines and drops the rest, newest last", () => {
    const text = ["boot ok", "[MCP][nextcloud] Domain not allowed", "unrelated line", "error: disconnected", "tail"].join("\n");
    assert.deepEqual(interestingLogLines(text), ["[MCP][nextcloud] Domain not allowed", "error: disconnected"]);
    assert.equal(interestingLogLines("mcp a\nmcp b\nmcp c", 2).length, 2);
  });

  it("keeps every [MCP][<name>] line beyond the cap, in log order, and caps only the other lines", () => {
    const serverLines = Array.from({ length: 80 }, (_, i) => `info: [MCP][outline] line ${i}`);
    const text = ["warn: old 1", ...serverLines.slice(0, 40), "warn: old 2", ...serverLines.slice(40), "error: new 3"].join("\n");
    const kept = interestingLogLines(text, 2);
    assert.equal(kept.filter((l) => l.includes("[MCP][outline]")).length, 80);
    assert.deepEqual(
      kept.filter((l) => !l.includes("[MCP][outline]")),
      ["warn: old 2", "error: new 3"],
    );
    assert.equal(kept[0], "info: [MCP][outline] line 0");
    assert.equal(kept.at(-1), "error: new 3");
  });

  it("maps each server state, and marks a missing server", () => {
    const body = { connectionStatus: { nextcloud: { connectionState: "disconnected" }, penpot: { connectionState: "connected" } } };
    assert.deepEqual(connectionStates(body, ["nextcloud", "penpot", "outline"]), {
      nextcloud: "disconnected",
      penpot: "connected",
      outline: "missing",
    });
  });

  it("names the LibreChat app container and the five MCP containers", () => {
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

  it("the probe has short limits, checks in parallel, and never prints a header or an env value", () => {
    assert.match(PROBE_SCRIPT, /AbortSignal\.timeout\(4000\)/);
    assert.match(PROBE_SCRIPT, /Promise\.all\(servers\.map\(probe\)\)/);
    assert.match(PROBE_SCRIPT, /auth var set|auth var EMPTY/);
    assert.doesNotMatch(PROBE_SCRIPT, /console\.log\([^)]*(headers|process\.env\[authEnv\])/);
  });

  describe("the probe, run for real against a local server", () => {
    let server: Server;
    let base = "";

    before(async () => {
      server = createServer((req, res) => {
        req.resume();
        req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    });

    after(() => {
      server.close();
    });

    /** Async on purpose: the probe's server lives in this process, so a blocking spawn would starve it. */
    function runProbe(env: Record<string, string>): Promise<{ lines: string[]; out: string }> {
      const list = JSON.stringify([
        ["withauth", base, "P4_TEST_AUTH"],
        ["noauthvar", base, null],
        ["emptyauth", base, "P4_TEST_EMPTY"],
      ]);
      return new Promise((resolve, reject) => {
        const child = spawn("node", ["-e", PROBE_SCRIPT, list], { env: { ...process.env, ...env } });
        let out = "";
        child.stdout.on("data", (c: Buffer) => (out += c.toString()));
        child.stderr.on("data", (c: Buffer) => (out += c.toString()));
        const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
        child.on("error", reject);
        child.on("close", () => {
          clearTimeout(timer);
          resolve({ lines: out.split("\n").filter((l) => l.includes(" | ")), out });
        });
      });
    }

    it("prints one line per server with the status and the auth state, and never the value", async () => {
      const secret = "tok-SHOULD-NOT-APPEAR-9f3c";
      const { lines, out } = await runProbe({ P4_TEST_AUTH: secret, P4_TEST_EMPTY: "" });
      assert.equal(lines.length, 3);
      assert.match(lines.find((l) => l.startsWith("withauth")) ?? "", /http 200 \| auth var set/);
      assert.match(lines.find((l) => l.startsWith("noauthvar")) ?? "", /no auth var/);
      assert.match(lines.find((l) => l.startsWith("emptyauth")) ?? "", /auth var EMPTY/);
      assert.doesNotMatch(out, /tok-SHOULD-NOT-APPEAR/);
    });
  });
});

describe("librechat-diag MCP trace (names and true/false only)", () => {
  it("maps each alias host to its server name", () => {
    assert.equal(
      mcpTraceHosts(serversFor(["nextcloud", "mattermost"])),
      "nextcloud-mcp=nextcloud,mattermost-mcp=mattermost",
    );
  });

  it("parses trace lines, skips others, and summarises in first-attempt order", () => {
    const log = [
      "some other line",
      `2026 ${MCP_TRACE_TAG} seq=2 time=t pid=1 via=undici server=nextcloud method=POST path=/mcp authorization=true`,
      `${MCP_TRACE_TAG} seq=1 time=t pid=1 via=undici server=mattermost method=POST path=/mcp authorization=false`,
      `${MCP_TRACE_TAG} seq=3 time=t pid=1 via=undici server=mattermost method=GET path=/mcp authorization=true`,
      `${MCP_TRACE_TAG} seq=x server=broken`,
    ].join("\n");
    const entries = parseMcpTrace(log);
    assert.equal(entries.length, 3);
    assert.deepEqual(summarizeMcpTrace(entries), [
      "#1 mattermost: traced requests 2, authorization=true 1, authorization=false 1",
      "#2 nextcloud: traced requests 1, authorization=true 1, authorization=false 0",
    ]);
  });
});
