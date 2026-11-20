/**
 * The MCP recorder (H9): a reverse proxy in front of each MCP server. Bytes go through unchanged, in both directions, and
 * streamed responses (SSE) are piped as they arrive. Only the copy written to the log is redacted (redact.ts). Each exchange
 * writes a `request` line when the request body is read, a `response` line (status and headers) when the response head
 * arrives, and a `response_body` line when the body ends. A long-lived event stream therefore shows its head at once, and
 * its body only when it closes.
 *
 * It imports only Node built-ins and its own files, so the same compiled code runs in the recorder container.
 */
import http from "node:http";
import https from "node:https";
import { redactBody, redactHeaders, redactText } from "./redact.js";
import { matchRoute, type RecorderRoute } from "./routes.js";

export interface RecorderOptions {
  routes: readonly RecorderRoute[];
  /** Receives one JSON line per record, already redacted. The container writes it to stdout. */
  emit: (line: string) => void;
  now?: () => Date;
  /** Bytes of each body kept for the log. The forwarded bytes are never cut. */
  maxRecordBytes?: number;
  /** Largest request body accepted. Larger requests get 413 and are not forwarded. */
  maxRequestBytes?: number;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardRequestHeaders(headers: http.IncomingHttpHeaders, host: string, length: number): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === "host" || name === "content-length") continue;
    out[name] = value;
  }
  out.host = host;
  out["content-length"] = String(length);
  // The recorder reads bodies as text. Asking for an uncompressed reply keeps them readable, so redaction can see them.
  out["accept-encoding"] = "identity";
  return out;
}

function forwardResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/** A clipped body loses its last RECORD_CLIP_RESERVE bytes, so a credential cut at the limit cannot show a fragment. */
export const RECORD_CLIP_RESERVE = 512;

/**
 * The part of a body kept for the log. When the whole body is longer than maxRecord, the last RECORD_CLIP_RESERVE bytes of
 * the kept part are dropped too, so a credential cut at the limit cannot show a fragment.
 */
export function clipForRecord(kept: Buffer, maxRecord: number, totalBytes: number): { text: Buffer; truncated: boolean } {
  const truncated = totalBytes > maxRecord;
  if (!truncated) return { text: kept, truncated };
  return { text: kept.subarray(0, Math.max(0, Math.min(kept.length, maxRecord - RECORD_CLIP_RESERVE))), truncated };
}

export function createRecorder(opts: RecorderOptions): http.Server {
  const now = opts.now ?? (() => new Date());
  const maxRecord = opts.maxRecordBytes ?? 64 * 1024;
  const maxRequest = opts.maxRequestBytes ?? 4 * 1024 * 1024;
  let nextId = 0;

  const emit = (record: Record<string, unknown>): void => {
    opts.emit(JSON.stringify({ ts: now().toISOString(), ...record }));
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://recorder.invalid");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    const match = matchRoute(opts.routes, url.pathname);
    if (!match) {
      res.writeHead(404, { "content-type": "text/plain" }).end("no route");
      return;
    }
    const { route, upstreamPath } = match;
    const id = ++nextId;
    const requestChunks: Buffer[] = [];
    let requestBytes = 0;
    let refused = false;

    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      requestBytes += chunk.length;
      if (requestBytes > maxRequest) {
        refused = true;
        res.writeHead(413, { "content-type": "text/plain" }).end("request too large");
        req.resume();
        return;
      }
      requestChunks.push(chunk);
    });

    req.on("end", () => {
      if (refused) return;
      const body = Buffer.concat(requestChunks);
      const path = upstreamPath + url.search;
      const contentType = req.headers["content-type"];
      const clip = clipForRecord(body, maxRecord, body.length);
      emit({
        kind: "request",
        id,
        server: route.name,
        method: req.method,
        path: redactText(path),
        headers: redactHeaders(req.headers),
        body: redactBody(clip.text.toString("utf8"), contentType),
        bodyBytes: body.length,
        bodyTruncated: clip.truncated,
      });

      const lib = route.protocol === "https:" ? https : http;
      const upstreamReq = lib.request(
        {
          protocol: route.protocol,
          hostname: route.hostname,
          port: route.port,
          method: req.method,
          path,
          headers: forwardRequestHeaders(req.headers, `${route.hostname}:${route.port}`, body.length),
        },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, forwardResponseHeaders(upRes.headers));
          // The head is logged on arrival, so a long-lived event stream is visible before it ends.
          emit({
            kind: "response",
            id,
            server: route.name,
            status: upRes.statusCode ?? 0,
            headers: redactHeaders(upRes.headers),
          });
          const kept: Buffer[] = [];
          let keptBytes = 0;
          let total = 0;
          upRes.on("data", (chunk: Buffer) => {
            total += chunk.length;
            res.write(chunk);
            if (keptBytes < maxRecord) {
              const slice = chunk.subarray(0, maxRecord - keptBytes);
              kept.push(slice);
              keptBytes += slice.length;
            }
          });
          upRes.on("end", () => {
            res.end();
            emit({
              kind: "response_body",
              id,
              server: route.name,
              body: redactBody(clipForRecord(Buffer.concat(kept), maxRecord, total).text.toString("utf8"), upRes.headers["content-type"]),
              bodyBytes: total,
              bodyTruncated: total > maxRecord,
            });
          });
          upRes.on("error", (err: NodeJS.ErrnoException) => {
            res.destroy();
            emit({ kind: "error", id, server: route.name, stage: "response", code: err.code ?? "UNKNOWN" });
          });
        },
      );

      upstreamReq.on("error", (err: NodeJS.ErrnoException) => {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain" }).end("upstream unavailable");
        } else {
          res.destroy();
        }
        emit({ kind: "error", id, server: route.name, stage: "request", code: err.code ?? "UNKNOWN" });
      });
      res.on("close", () => {
        if (!res.writableEnded) upstreamReq.destroy();
      });
      upstreamReq.end(body);
    });

    req.on("error", () => {
      if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain" }).end("bad request");
    });
  });
}
