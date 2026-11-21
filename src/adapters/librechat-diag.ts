/**
 * Diagnostics for LibreChat's MCP connections. Pure helpers here, so each one is unit tested. The adapter does the I/O.
 * Nothing printed contains a secret or a header value: every captured line is redacted with the env-file values and the
 * per-run secrets first, and the probe prints only whether an auth variable is set and non-empty.
 */
import { spawn } from "node:child_process";
import { redactSecrets } from "../internal/run.js";
import { librechatMcpServerForRun, type LibreChatMcpServer } from "./librechat-env.js";

/** Redaction placeholder, the same text the MCP recorder writes (src/mcp-recorder/redact.ts). */
const REDACTED = "[REDACTED]";
/** A ?userToken= or &userToken= query value (H6). It is redacted even when the value is not in the env file. */
const USER_TOKEN_QUERY = /([?&]userToken=)[^\s&"'<>\\]+/gi;

/** Hides any userToken query value in a line. The token is never printed, so a line that has one is cut to a placeholder. */
export function redactUserTokenQuery(text: string): string {
  return text.replace(USER_TOKEN_QUERY, `$1${REDACTED}`);
}

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
  return redactSecrets(redactUserTokenQuery(text), values);
}

/** A LibreChat line about one MCP server, such as "[MCP][outline] OAuth Required: true". */
const MCP_SERVER_LINE = /\[MCP\]\[[^\]]+\]/;

/**
 * Lines about MCP connections, allow lists and errors, in log order. Every [MCP][<name>] line is kept, so a per-server
 * decision such as "OAuth Required" is never cut. Of the other matching lines, only the last `max` are kept.
 */
export function interestingLogLines(text: string, max = 60): string[] {
  const matching = text.split("\n").filter((line) => /mcp|allow|domain|oauth|ssrf|blocked|refus|error|warn|connect/i.test(line));
  const firstKeptOther = Math.max(0, matching.filter((line) => !MCP_SERVER_LINE.test(line)).length - max);
  let otherIndex = -1;
  return matching.filter((line) => {
    if (MCP_SERVER_LINE.test(line)) return true;
    otherIndex += 1;
    return otherIndex >= firstKeptOther;
  });
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
/**
 * H6: expands ${NAME} in a server URL from the container's own environment, inside the container. The host sends only the
 * template, so a token is never in the docker exec argv. An unset name stays as written. Source text, so the probe and the
 * unit tests run the same code.
 */
export const EXPAND_ENV_FN = [
  "function expandEnv(text) {",
  "  return text.replace(/\\$\\{([A-Za-z0-9_]+)\\}/g, (m, n) => (process.env[n] || \"\") !== \"\" ? process.env[n] : m);",
  "}",
].join("\n");

export const PROBE_SCRIPT = [
  'const dns = require("dns").promises;',
  "const servers = JSON.parse(process.argv[1]);",
  EXPAND_ENV_FN,
  "const limit = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + \" timeout\")), ms))]);",
  "const authState = (authEnv) => authEnv === null ? \"no auth var\" : ((process.env[authEnv] || \"\").trim() !== \"\" ? \"auth var set\" : \"auth var EMPTY\");",
  "const urlState = (urlEnv) => (process.env[urlEnv] || \"\").trim() !== \"\" ? \"url token set\" : \"url token EMPTY\";",
  "async function probe([name, template, authEnv, urlEnv]) {",
  "  const url = expandEnv(template);",
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
  '  const cells = [name, host, address, status, authState(authEnv)];',
  "  if (urlEnv) cells.push(urlState(urlEnv));",
  '  console.log(cells.join(" | "));',
  "}",
  'Promise.all(servers.map(probe)).then(() => console.log("probe done"));',
].join("\n");

/** The docker exec argv for the probe. The server list holds names, URL templates and env variable NAMES only. */
export function probeArgs(servers: LibreChatMcpServer[]): string[] {
  // The fourth column (H6) is only sent for a server with a URL token, so every other server's argv is unchanged.
  const list = servers.map((s) => (s.urlTokenEnv === undefined ? [s.name, s.url, s.authEnv] : [s.name, s.url, s.authEnv, s.urlTokenEnv]));
  return ["exec", LIBRECHAT_APP_CONTAINER, "node", "-e", PROBE_SCRIPT, JSON.stringify(list)];
}

/** H6: `penpotPlugin` gives Penpot its token-URL template, as the adapter writes it. */
export function serversFor(names: string[], opts: { penpotPlugin: boolean } = { penpotPlugin: false }): LibreChatMcpServer[] {
  return names.map((name) => librechatMcpServerForRun(name, opts));
}

export function mcpContainerFor(name: string): string | undefined {
  return MCP_CONTAINERS[name];
}

/**
 * Runs the probe on the host and prints each line as it arrives, redacted. It resolves when the probe ends, and it never
 * rejects: a probe that cannot start is printed and the wait keeps its own error.
 */
export function streamMcpProbe(
  names: string[],
  values: string[],
  log: (line: string) => void = console.log,
  opts: { penpotPlugin: boolean } = { penpotPlugin: false },
): Promise<void> {
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
      child = spawn("docker", probeArgs(serversFor(names, opts)), { stdio: ["ignore", "pipe", "pipe"] });
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

