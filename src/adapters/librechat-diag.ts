/**
 * Diagnostics for a LibreChat MCP timeout (CI run 2c629dc: "nextcloud is disconnected"). Pure helpers here, so each one is
 * unit tested. The adapter does the I/O. Nothing printed by these helpers contains a secret or a header value: every
 * captured line is redacted with the env-file values and the per-run secrets first.
 */
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
 * The probe that runs inside the LibreChat container. For each server it resolves the host and sends one initialize
 * request, sending the Authorization value from the container env by name. It prints the name, the address, the HTTP
 * status or the error code, and whether the auth env var is set. It never prints a header or an env value.
 */
export const PROBE_SCRIPT = [
  'const dns = require("dns").promises;',
  "const servers = JSON.parse(process.argv[1]);",
  "(async () => {",
  "  for (const [name, url, authEnv] of servers) {",
  "    const host = new URL(url).hostname;",
  '    let address;',
  '    try { address = (await dns.lookup(host)).address; } catch (e) { address = "dns " + (e.code || "error"); }',
  '    let status;',
  "    try {",
  '      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };',
  '      if (authEnv) headers.authorization = process.env[authEnv] || "";',
  "      const body = JSON.stringify({ jsonrpc: \"2.0\", id: 1, method: \"initialize\", params: { protocolVersion: \"2025-06-18\", capabilities: {}, clientInfo: { name: \"diag\", version: \"0\" } } });",
  "      const r = await fetch(url, { method: \"POST\", headers, body, signal: AbortSignal.timeout(8000) });",
  '      status = "http " + r.status + (authEnv ? (process.env[authEnv] ? " (auth env set)" : " (auth env EMPTY)") : " (no auth)");',
  "    } catch (e) {",
  '      const inner = e.cause && (e.cause.code || (e.cause.errors && e.cause.errors[0] && e.cause.errors[0].code));',
  '      const detail = e.cause && e.cause.message ? " / " + String(e.cause.message).slice(0, 120) : "";',
  '      status = "fetch " + (inner || e.name || "error") + detail;',
  "    }",
  '    console.log(name, host, address, status);',
  "  }",
  "})();",
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
