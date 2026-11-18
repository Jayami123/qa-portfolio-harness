/**
 * Diagnostics for LibreChat's MCP connections. Pure helpers here, so each one is unit tested. The adapter does the I/O.
 * Nothing printed contains a secret or a header value: every captured line is redacted with the env-file values and the
 * per-run secrets first, and the probe prints only whether an auth variable is set and non-empty.
 */
import { spawn } from "node:child_process";
import { redactSecrets } from "../internal/run.js";
import { librechatMcpServerFor, type LibreChatMcpServer } from "./librechat-env.js";

/** The LibreChat app container (compose project qa-harness-librechat, service app). */
export const LIBRECHAT_APP_CONTAINER = "qa-harness-librechat-app-1";

/** The MCP container behind each Part A server name (compose project and service, as the Part A files define them). */
export const MCP_CONTAINERS: Record<string, string> = {
  nextcloud: "qa-harness-nextcloud-mcp-1",
  outline: "qa-harness-outline-outline-1",
  twenty: "qa-harness-twenty-server-1",
  penpot: "qa-harness-penpot-mcp-1",
  mattermost: "qa-harness-mattermost-mcp-1",
};

const MIN_SECRET_LENGTH = 6;
/** Hard stop for the streamed probe on the host. The in-container probe finishes well before this. */
export const PROBE_HOST_TIMEOUT_MS = 45_000;

/** Every value in the env file and every string in the secrets, so a redaction pass covers them all. */
export function redactionValues(envText: string, secrets: Record<string, unknown>): string[] {
  const values = new Set<string>();
  for (const line of envText.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) {
      const value = line.slice(at + 1);
      if (value.length >= MIN_SECRET_LENGTH) values.add(value);
    }
  }
  for (const value of Object.values(secrets)) {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) values.add(value);
  }
  return [...values];
}

export function redactText(text: string, values: string[]): string {
  return redactSecrets(text, values);
}

/** Lines about MCP connections, allow lists and errors. Keeps the last `max` of them. */
export function interestingLogLines(text: string, max = 60): string[] {
  return text
    .split("\n")
    .filter((line) => /mcp|allow|domain|oauth|ssrf|blocked|refus|error|warn|connect/i.test(line))
    .slice(-max);
}

/** Each server's connectionState from /api/mcp/connection/status. A missing server reads "missing". */
export function connectionStates(statusBody: unknown, names: string[]): Record<string, string> {
  const map = (statusBody as { connectionStatus?: Record<string, { connectionState?: unknown }> } | null)?.connectionStatus;
  const out: Record<string, string> = {};
  for (const name of names) {
    const state = map?.[name]?.connectionState;
    out[name] = typeof state === "string" ? state : "missing";
  }
  return out;
}

/**
 * The probe that runs inside the LibreChat container. Every server is checked in parallel. Each request has a 4 s limit
 * and each DNS lookup a 3 s limit, so the whole probe ends in about 8 s. A server's line is printed as soon as its check
 * ends. A line holds the name, the host, the resolved address, the HTTP status or error code, and whether the auth
 * variable is set and non-empty. The value is never printed, and the header is sent only when the value is non-empty.
 */
export const PROBE_SCRIPT = [
  'const dns = require("dns").promises;',
  "const servers = JSON.parse(process.argv[1]);",
  "const limit = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + \" timeout\")), ms))]);",
  "const authState = (authEnv) => authEnv === null ? \"no auth var\" : ((process.env[authEnv] || \"\").trim() !== \"\" ? \"auth var set\" : \"auth var EMPTY\");",
  "async function probe([name, url, authEnv]) {",
  "  const host = new URL(url).hostname;",
  "  let address;",
  '  try { address = (await limit(dns.lookup(host), 3000, "dns")).address; } catch (e) { address = "dns " + (e.code || e.message); }',
  "  let status;",
  "  try {",
  '    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };',
  "    if (authEnv && (process.env[authEnv] || \"\").trim() !== \"\") headers.authorization = process.env[authEnv];",
  '    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "diag", version: "0" } } });',
  '    const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(4000) });',
  '    status = "http " + r.status;',
  "  } catch (e) {",
  "    const inner = e.cause && (e.cause.code || (e.cause.errors && e.cause.errors[0] && e.cause.errors[0].code));",
  '    const detail = e.cause && e.cause.message ? " / " + String(e.cause.message).slice(0, 120) : "";',
  '    status = "fetch " + (inner || e.name || "error") + detail;',
  "  }",
  '  console.log([name, host, address, status, authState(authEnv)].join(" | "));',
  "}",
  'Promise.all(servers.map(probe)).then(() => console.log("probe done"));',
].join("\n");

/** The docker exec argv for the probe. The server list holds names, URLs and env variable NAMES only. */
export function probeArgs(servers: LibreChatMcpServer[]): string[] {
  const list = servers.map((s) => [s.name, s.url, s.authEnv]);
  return ["exec", LIBRECHAT_APP_CONTAINER, "node", "-e", PROBE_SCRIPT, JSON.stringify(list)];
}

export function serversFor(names: string[]): LibreChatMcpServer[] {
  return names.map((name) => librechatMcpServerFor(name));
}

export function mcpContainerFor(name: string): string | undefined {
  return MCP_CONTAINERS[name];
}

/**
 * Runs the probe on the host and prints each line as it arrives, redacted. It resolves when the probe ends, and it never
 * rejects: a probe that cannot start is printed and the wait keeps its own error.
 */
export function streamMcpProbe(names: string[], values: string[], log: (line: string) => void = console.log): Promise<void> {
  return new Promise((resolve) => {
    let carry = "";
    const emit = (text: string): void => {
      carry += text;
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") log(`  ${redactText(line, values)}`);
      }
    };
    let child;
    try {
      child = spawn("docker", probeArgs(serversFor(names)), { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      log(`  the probe could not start: ${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}`);
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_HOST_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => emit(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => emit(chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      log(`  the probe failed to run: ${err.message.slice(0, 120)}`);
      resolve();
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (carry.trim() !== "") log(`  ${redactText(carry, values)}`);
      resolve();
    });
  });
}

/** The tag the trace preload (docker/librechat-mcp-trace.cjs) puts on each line. */
export const MCP_TRACE_TAG = "[p4-mcp-trace]";

/** "host=name,host=name" for P4_MCP_TRACE_HOSTS. Host and server names only, never a value. */
export function mcpTraceHosts(servers: LibreChatMcpServer[]): string {
  return servers.map((s) => `${new URL(s.url).hostname}=${s.name}`).join(",");
}

export interface McpTraceEntry {
  seq: number;
  server: string;
  method: string;
  authorization: boolean;
}

/** The trace lines in a LibreChat log, parsed. Lines that do not parse are skipped. */
export function parseMcpTrace(logText: string): McpTraceEntry[] {
  const out: McpTraceEntry[] = [];
  for (const line of logText.split("\n")) {
    const at = line.indexOf(MCP_TRACE_TAG);
    if (at < 0) continue;
    const fields = new Map(
      line
        .slice(at + MCP_TRACE_TAG.length)
        .trim()
        .split(/\s+/)
        .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)] as [string, string]),
    );
    const seq = Number(fields.get("seq"));
    const server = fields.get("server");
    const method = fields.get("method");
    const auth = fields.get("authorization");
    if (!Number.isInteger(seq) || !server || !method || (auth !== "true" && auth !== "false")) continue;
    out.push({ seq, server, method, authorization: auth === "true" });
  }
  return out;
}

/**
 * One summary line per server, in the order the servers were first attempted: requests seen, with and without an
 * Authorization header. Names and counts only.
 */
export function summarizeMcpTrace(entries: McpTraceEntry[]): string[] {
  const order: string[] = [];
  const counts = new Map<string, { total: number; withAuth: number; withoutAuth: number }>();
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    let c = counts.get(e.server);
    if (c === undefined) {
      c = { total: 0, withAuth: 0, withoutAuth: 0 };
      counts.set(e.server, c);
      order.push(e.server);
    }
    c.total += 1;
    if (e.authorization) c.withAuth += 1;
    else c.withoutAuth += 1;
  }
  return order.map((name, i) => {
    const c = counts.get(name)!;
    return `#${i + 1} ${name}: traced requests ${c.total}, authorization=true ${c.withAuth}, authorization=false ${c.withoutAuth}`;
  });
}
