// Request trace for LibreChat's MCP connections (diagnostics only, ADR 0007). Loaded with NODE_OPTIONS=--require into the
// LibreChat container. It never changes a request. For each outgoing request to a known MCP host it prints one line with
// the server name, the method, the path and whether an Authorization header is present (true or false). It never prints
// a header value. Hosts come from P4_MCP_TRACE_HOSTS ("host=name,host=name"), which holds names only.
"use strict";

const dc = require("node:diagnostics_channel");

const hosts = new Map(
  String(process.env.P4_MCP_TRACE_HOSTS || "")
    .split(",")
    .map((pair) => pair.split("="))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([host, name]) => [host.trim(), name.trim()]),
);
const PER_SERVER_LINES = 12;
const seenPerServer = new Map();
const seenCombos = new Set();
let seq = 0;

/** True when the request headers hold a non-empty Authorization header. Handles undici's string, flat and nested forms. */
function hasAuthorization(headers) {
  if (headers == null) return false;
  const isAuth = (k, v) => String(k).trim().toLowerCase() === "authorization" && v != null && String(v).trim() !== "";
  if (typeof headers === "string") {
    return headers.split("\r\n").some((line) => {
      const at = line.indexOf(":");
      return at > 0 && isAuth(line.slice(0, at), line.slice(at + 1));
    });
  }
  if (Array.isArray(headers)) {
    if (headers.length > 0 && Array.isArray(headers[0])) return headers.some((h) => isAuth(h[0], h[1]));
    for (let i = 0; i + 1 < headers.length; i += 2) if (isAuth(headers[i], headers[i + 1])) return true;
    return false;
  }
  if (typeof headers === "object") return Object.entries(headers).some(([k, v]) => isAuth(k, v));
  return false;
}

function report(hostname, method, path, auth, via) {
  const name = hosts.get(hostname);
  if (name === undefined) return;
  const combo = `${name}|${method}|${auth}`;
  const count = (seenPerServer.get(name) || 0) + 1;
  seenPerServer.set(name, count);
  if (count > PER_SERVER_LINES && seenCombos.has(combo)) return;
  seenCombos.add(combo);
  seq += 1;
  const cleanPath = String(path || "").split("?")[0];
  process.stderr.write(
    `[p4-mcp-trace] seq=${seq} time=${new Date().toISOString()} pid=${process.pid} via=${via} server=${name} method=${method} path=${cleanPath} authorization=${auth}\n`,
  );
}

function safe(fn) {
  return (message) => {
    try {
      fn(message);
    } catch {
      // a trace must never break a request
    }
  };
}

if (hosts.size > 0) {
  // undici (global fetch and the undici package both publish here)
  dc.subscribe(
    "undici:request:create",
    safe(({ request }) => {
      const hostname = new URL(request.origin).hostname;
      report(hostname, request.method, request.path, hasAuthorization(request.headers), "undici");
    }),
  );
  // node:http clients (axios and others)
  dc.subscribe(
    "http.client.request.start",
    safe(({ request }) => {
      const hostname = String(request.host || request.getHeader("host") || "").split(":")[0];
      report(hostname, request.method, request.path, hasAuthorization(request.getHeaders()), "http");
    }),
  );
}
