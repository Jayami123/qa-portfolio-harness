import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { clipForRecord, createRecorder, RECORD_CLIP_RESERVE } from "./proxy.js";
import { REDACTED } from "./redact.js";
import { parseRecorderRoutes } from "./routes.js";

const SECRET_BEARER = "fakebearer-abc123XYZ";
const SECRET_PASS = "fakepass-hunter2-zz";
const SECRET_SESSION = "fakesession-idvalue-42";
const SECRET_COOKIE = "sessfake-cookie-9876";

/** A fake MCP upstream: records what it received, answers JSON, SSE, a large body or an error on request. */
function fakeUpstream(seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }>) {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url?.startsWith("/sse")) {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": SECRET_SESSION });
        res.write(`event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n`);
        setTimeout(() => {
          res.write(`event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":2}}\n\n`);
          res.end();
        }, 30);
        return;
      }
      if (req.url?.startsWith("/big")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ tools: "x".repeat(200_000) }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": `session=${SECRET_COOKIE}; Path=/` });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { echo: body.length } }));
    });
  });
}

function request(port: number, options: http.RequestOptions, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("createRecorder (H9): forwarding and redacted recording", () => {
  const seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const lines: string[] = [];
  let upstream: http.Server;
  let recorder: http.Server;
  let upPort = 0;
  let recPort = 0;

  before(async () => {
    upstream = fakeUpstream(seen);
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    upPort = (upstream.address() as AddressInfo).port;
    const routes = parseRecorderRoutes(`fake=http://127.0.0.1:${upPort}`);
    recorder = createRecorder({ routes, emit: (line) => lines.push(line), maxRequestBytes: 64 * 1024 });
    await new Promise<void>((r) => recorder.listen(0, "127.0.0.1", () => r()));
    recPort = (recorder.address() as AddressInfo).port;
  });
  after(async () => {
    await new Promise<void>((r) => recorder.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it("forwards the request unchanged: path, Authorization and body reach the upstream", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { arguments: { password: SECRET_PASS } } });
    const res = await request(recPort, {
      method: "POST",
      path: "/fake/mcp?x=1",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET_BEARER}`, cookie: `session=${SECRET_COOKIE}` },
    }, body);
    assert.equal(res.status, 200);
    const got = seen.at(-1);
    assert.equal(got?.url, "/mcp?x=1");
    assert.equal(got?.headers.authorization, `Bearer ${SECRET_BEARER}`);
    assert.equal(got?.body, body);
    assert.equal(got?.headers["accept-encoding"], "identity", "upstream is asked for an uncompressed body");
  });

  it("returns the upstream's response to the client, including the set-cookie header", async () => {
    const res = await request(recPort, { method: "POST", path: "/fake/mcp", headers: { "content-type": "application/json" } }, "{}");
    assert.equal(res.headers["set-cookie"]?.[0]?.includes(SECRET_COOKIE), true);
  });

  it("writes request and response records with credentials replaced", () => {
    const joined = lines.join("\n");
    assert.equal(joined.includes(SECRET_BEARER), false, "bearer value written");
    assert.equal(joined.includes(SECRET_PASS), false, "body password written");
    assert.equal(joined.includes(SECRET_COOKIE), false, "cookie value written");
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const request = records.find((r) => r.kind === "request" && String(r.body).includes("tools/call"));
    assert.ok(request, "a request record for tools/call exists");
    assert.equal((request.headers as Record<string, string>).authorization, REDACTED);
    assert.equal((request.headers as Record<string, string>).cookie, REDACTED);
    assert.equal(request.server, "fake");
    assert.equal(request.path, "/mcp?x=1");
    assert.ok(records.some((r) => r.kind === "response" && r.status === 200));
    assert.ok(records.some((r) => r.kind === "response_body" && typeof r.bodyBytes === "number"));
  });

  it("streams an SSE response to the client as it arrives, and logs its head before its body", async () => {
    const before = lines.length;
    const res = await request(recPort, { method: "GET", path: "/fake/sse", headers: { accept: "text/event-stream" } });
    assert.equal(res.status, 200);
    assert.match(res.body, /"id":1/);
    assert.match(res.body, /"id":2/);
    const fresh = lines.slice(before).map((l) => JSON.parse(l) as Record<string, unknown>);
    const headIndex = fresh.findIndex((r) => r.kind === "response");
    const bodyIndex = fresh.findIndex((r) => r.kind === "response_body");
    assert.ok(headIndex >= 0 && bodyIndex > headIndex, "response head is logged before the body");
    assert.match(String((fresh[headIndex]?.headers as Record<string, string>)["mcp-session-id"]), /^sha256:[0-9a-f]{8}$/);
    assert.equal(lines.join("\n").includes(SECRET_SESSION), false, "session id written");
  });

  it("clips a large response in the log but forwards every byte", async () => {
    const res = await request(recPort, { method: "GET", path: "/fake/big" });
    assert.equal(res.body.length, JSON.stringify({ tools: "x".repeat(200_000) }).length);
    const bodyRecord = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((r) => r.kind === "response_body").at(-1);
    assert.equal(bodyRecord?.bodyTruncated, true);
    assert.ok(String(bodyRecord?.body).length < 64 * 1024);
  });

  it("answers 404 for an unknown route, and writes no record for it", async () => {
    const before = lines.length;
    const res = await request(recPort, { method: "GET", path: "/nope/mcp" });
    assert.equal(res.status, 404);
    assert.equal(lines.length, before);
  });

  it("answers the health route without writing a record", async () => {
    const before = lines.length;
    const res = await request(recPort, { method: "GET", path: "/healthz" });
    assert.equal(res.body, "ok");
    assert.equal(lines.length, before);
  });

  it("refuses a request body over the limit with 413 and does not forward it", async () => {
    const before = seen.length;
    const res = await request(recPort, { method: "POST", path: "/fake/mcp", headers: { "content-type": "application/json" } }, "y".repeat(70 * 1024));
    assert.equal(res.status, 413);
    assert.equal(seen.length, before);
  });
});

describe("createRecorder (H9): upstream down", () => {
  it("answers 502 and logs an error record with a code only", async () => {
    const lines: string[] = [];
    const routes = parseRecorderRoutes("down=http://127.0.0.1:1");
    const recorder = createRecorder({ routes, emit: (l) => lines.push(l) });
    await new Promise<void>((r) => recorder.listen(0, "127.0.0.1", () => r()));
    const port = (recorder.address() as AddressInfo).port;
    try {
      const res = await request(port, { method: "POST", path: "/down/mcp", headers: { authorization: `Bearer ${SECRET_BEARER}` } }, "{}");
      assert.equal(res.status, 502);
      assert.equal(res.body, "upstream unavailable");
      const error = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((r) => r.kind === "error");
      assert.equal(error?.stage, "request");
      assert.equal(typeof error?.code, "string");
      assert.equal(lines.join("\n").includes(SECRET_BEARER), false);
    } finally {
      await new Promise<void>((r) => recorder.close(() => r()));
    }
  });
});

describe("clipForRecord", () => {
  it("keeps a short body whole", () => {
    const buf = Buffer.from("short");
    assert.deepEqual(clipForRecord(buf, 100, 5), { text: buf, truncated: false });
  });
  it("drops the reserve from a clipped body, so a cut credential cannot show a fragment", () => {
    const kept = Buffer.alloc(1000, 0x61);
    const out = clipForRecord(kept, 1000, 5000);
    assert.equal(out.truncated, true);
    assert.equal(out.text.length, 1000 - RECORD_CLIP_RESERVE);
  });
});
