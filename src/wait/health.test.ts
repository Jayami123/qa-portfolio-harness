import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it, mock } from "node:test";
import { candidateUrls, pollHealth, waitUntilHealthy } from "./health.js";

describe("candidateUrls", () => {
  it("swaps localhost and 127.0.0.1 for the default fallback", () => {
    assert.deepEqual(candidateUrls("http://localhost:3000/"), ["http://localhost:3000/", "http://127.0.0.1:3000/"]);
    assert.deepEqual(candidateUrls("http://127.0.0.1:3000/"), ["http://127.0.0.1:3000/", "http://localhost:3000/"]);
  });

  it("leaves other hosts alone", () => {
    assert.deepEqual(candidateUrls("http://example.test/"), ["http://example.test/"]);
  });
});

describe("pollHealth with a local server (no product needed)", () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/signin") {
        res.writeHead(200).end("login");
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/signin" }).end();
      } else {
        res.writeHead(500).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("treats 200 as ok with the default predicate", async () => {
    const result = await pollHealth(`${base}/signin`, { timeoutMs: 0, alternateLoopback: false });
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
  });

  it("does not treat a 302 as healthy when isOk requires 200", async () => {
    const result = await pollHealth(`${base}/redirect`, {
      timeoutMs: 0,
      alternateLoopback: false,
      isOk: (status) => status === 200,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 302);
  });

  it("still counts a 500 as unhealthy under the default predicate", async () => {
    const result = await pollHealth(`${base}/missing`, { timeoutMs: 0, alternateLoopback: false });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 500);
  });

  it("with alternateLoopback false, probes only the supplied URL", async () => {
    const result = await pollHealth("http://localhost:1/signin", { timeoutMs: 0, alternateLoopback: false });
    assert.equal(result.ok, false);
    assert.equal(result.url, "http://localhost:1/signin");
  });
});

describe("waitUntilHealthy with an exited container", () => {
  it("fails fast with the container name, exit code and OOMKilled instead of waiting out the timeout", async () => {
    const logs = mock.method(console, "log", () => undefined);
    const started = Date.now();
    try {
      await assert.rejects(
        waitUntilHealthy("http://127.0.0.1:1/", {
          timeoutMs: 60_000,
          intervalMs: 10,
          alternateLoopback: false,
          container: "qa-harness-app-1",
          docker: (args) =>
            args[0] === "inspect"
              ? { status: 0, stdout: "exited 1 false\n", stderr: "" }
              : { status: 0, stdout: "boom\n", stderr: "" },
        }),
        /qa-harness-app-1.*exit code 1.*OOMKilled false/,
      );
    } finally {
      logs.mock.restore();
    }
    assert.ok(Date.now() - started < 5000);
  });

  it("keeps polling while the container runs and times out normally", async () => {
    let inspects = 0;
    await assert.rejects(
      waitUntilHealthy("http://127.0.0.1:1/", {
        timeoutMs: 100,
        intervalMs: 20,
        requestTimeoutMs: 200,
        alternateLoopback: false,
        container: "c",
        docker: () => {
          inspects += 1;
          return { status: 0, stdout: "running 0 false\n", stderr: "" };
        },
      }),
      /Timed out waiting/,
    );
    assert.ok(inspects >= 1);
  });
});
