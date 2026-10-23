import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import { MedusaAdapter } from "./medusa.adapter.js";

describe("MedusaAdapter already-healthy branch", () => {
  const realLog = console.log;
  const realWarn = console.warn;
  let logs: string[];
  let warns: string[];

  beforeEach(() => {
    logs = [];
    warns = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  it("starts the storefront and warns that Redis/Stripe changes need down first", async () => {
    const adapter = new MedusaAdapter({
      baseUrl: "http://localhost:9000",
    } as MedusaConfig);
    let storefrontStarts = 0;
    (
      adapter as unknown as { maybeStartStorefront: () => Promise<void> }
    ).maybeStartStorefront = async () => {
      storefrontStarts += 1;
    };

    await (
      adapter as unknown as {
        onAlreadyHealthy: (probe: {
          verdict: "healthy";
          status: { ok: true; url: string };
        }) => Promise<void>;
      }
    ).onAlreadyHealthy({
      verdict: "healthy",
      status: { ok: true, url: "http://127.0.0.1:9000/health" },
    });

    assert.equal(storefrontStarts, 1);
    assert.deepEqual(warns, [
      "Medusa already running; MEDUSA_REDIS/MEDUSA_STRIPE changes need `npm run down -- medusa` first.",
    ]);
    assert.ok(
      logs.some((line) =>
        line.startsWith(
          "Medusa already healthy at http://127.0.0.1:9000/health",
        ),
      ),
    );
  });
});

interface SecondStopInternals {
  stopSecondBackend: () => Promise<void>;
  readSecondRecord: () => { pid: number; baseUrl?: string } | undefined;
  stopSecondPidFile: () => void;
  reapProductListeners: (port: string, kind: string) => Promise<void>;
  waitForPortClosed: (host: string, port: string, deadlineMs: number) => Promise<boolean>;
  listeningPids: (port: string) => number[];
  processArgv: (pid: number) => string[];
  processCwd: (pid: number) => string | undefined;
  killProcessTree: (pid: number) => Promise<void>;
}

function secondStopAdapter(
  secondBaseUrl: string | undefined,
  record: { pid: number; baseUrl?: string } | undefined,
  options: { stopThrows?: Error; portClosed?: boolean; stubReap?: boolean },
) {
  const adapter = new MedusaAdapter({
    baseUrl: "http://127.0.0.1:9000",
    productRoot: "/products/medusa-dtc-starter",
    secondBaseUrl,
  } as MedusaConfig);
  const internals = adapter as unknown as SecondStopInternals;
  const calls = { pidStop: 0, reaped: [] as string[], killed: [] as number[] };
  internals.readSecondRecord = () => record;
  internals.stopSecondPidFile = () => {
    calls.pidStop += 1;
    if (options.stopThrows !== undefined) {
      throw options.stopThrows;
    }
  };
  internals.waitForPortClosed = async () => options.portClosed ?? true;
  if (options.stubReap === false) {
    // Let the real reap run against a foreign listener: it must refuse to kill it.
    internals.listeningPids = () => [555];
    internals.processArgv = () => ["node", "/somewhere/else/cli.js", "start"];
    internals.processCwd = () => "/somewhere/else";
    internals.killProcessTree = async (pid) => {
      calls.killed.push(pid);
    };
  } else {
    internals.reapProductListeners = async (port) => {
      calls.reaped.push(port);
    };
  }
  return { adapter, calls };
}

describe("MedusaAdapter stopSecondBackend", () => {
  const realLog = console.log;
  const realWarn = console.warn;

  beforeEach(() => {
    console.log = () => undefined;
    console.warn = () => undefined;
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  it("is a no-op when no record exists and the env is unset", async () => {
    const { adapter, calls } = secondStopAdapter(undefined, undefined, {});
    await (adapter as unknown as SecondStopInternals).stopSecondBackend();
    assert.equal(calls.pidStop, 0);
    assert.deepEqual(calls.reaped, []);
  });

  it("still stops the recorded pid and waits on the recorded port when the env is now unset", async () => {
    const { adapter, calls } = secondStopAdapter(undefined, { pid: 1234, baseUrl: "http://127.0.0.1:9001" }, {});
    await (adapter as unknown as SecondStopInternals).stopSecondBackend();
    assert.equal(calls.pidStop, 1);
    assert.deepEqual(calls.reaped, ["9001"]);
  });

  it("refuses a foreign listener on the port when no record exists: throws and kills nothing", async () => {
    const { adapter, calls } = secondStopAdapter("http://127.0.0.1:9001", undefined, {
      portClosed: false,
      stubReap: false,
    });
    await assert.rejects(
      (adapter as unknown as SecondStopInternals).stopSecondBackend(),
      /Second Medusa backend still listening on 127\.0\.0\.1:9001; not killed\./,
    );
    assert.deepEqual(calls.killed, []);
  });

  it("does not reap when the pid-file stop throws, and propagates the error", async () => {
    const { adapter, calls } = secondStopAdapter(undefined, { pid: 1234, baseUrl: "http://127.0.0.1:9001" }, {
      stopThrows: new Error("boom"),
    });
    await assert.rejects((adapter as unknown as SecondStopInternals).stopSecondBackend(), /boom/);
    assert.deepEqual(calls.reaped, []);
  });

  it("succeeds once the port closes", async () => {
    const { adapter, calls } = secondStopAdapter("http://127.0.0.1:9001", undefined, { portClosed: true });
    await (adapter as unknown as SecondStopInternals).stopSecondBackend();
    assert.equal(calls.pidStop, 1);
    assert.deepEqual(calls.reaped, ["9001"]);
  });
});

describe("MedusaAdapter already-healthy with a second backend configured", () => {
  const realLog = console.log;
  const realWarn = console.warn;

  beforeEach(() => {
    console.log = () => undefined;
    console.warn = () => undefined;
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  it("throws and does not start the storefront when MEDUSA_SECOND_BASE_URL is set", async () => {
    const adapter = new MedusaAdapter({
      baseUrl: "http://127.0.0.1:9000",
      secondBaseUrl: "http://127.0.0.1:9001",
    } as MedusaConfig);
    let storefrontStarts = 0;
    (adapter as unknown as { maybeStartStorefront: () => Promise<void> }).maybeStartStorefront = async () => {
      storefrontStarts += 1;
    };

    await assert.rejects(
      (
        adapter as unknown as {
          onAlreadyHealthy: (probe: {
            verdict: "healthy";
            status: { ok: true; url: string };
          }) => Promise<void>;
        }
      ).onAlreadyHealthy({
        verdict: "healthy",
        status: { ok: true, url: "http://127.0.0.1:9000/health" },
      }),
      /Run down first; the second backend was not started/,
    );
    assert.equal(storefrontStarts, 0);
  });
});

describe("MedusaAdapter startSecondBackend on a busy second port", () => {
  const realLog = console.log;
  const realWarn = console.warn;
  let server: http.Server;
  let port = 0;

  beforeEach(async () => {
    console.log = () => undefined;
    console.warn = () => undefined;
    server = http.createServer((req, res) => {
      res.statusCode = req.url === "/health" ? 200 : 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    console.log = realLog;
    console.warn = realWarn;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function busySecondAdapter(record: { pid: number; baseUrl?: string } | undefined, pidLive: boolean) {
    const adapter = new MedusaAdapter({
      baseUrl: "http://127.0.0.1:9000",
      productRoot: "/products/medusa-dtc-starter",
      secondBaseUrl: `http://127.0.0.1:${String(port)}`,
    } as MedusaConfig);
    const internals = adapter as unknown as {
      readSecondRecord: () => { pid: number; baseUrl?: string } | undefined;
      secondPidRunning: (pid: number) => boolean;
    };
    internals.readSecondRecord = () => record;
    internals.secondPidRunning = () => pidLive;
    return adapter;
  }

  it("accepts a healthy listener when medusa-backend-2.pid records a live pid for this baseUrl", async () => {
    const adapter = busySecondAdapter(
      { pid: 77, baseUrl: `http://127.0.0.1:${String(port)}` },
      true,
    );
    await assert.doesNotReject(
      (adapter as unknown as { startSecondBackend: () => Promise<void> }).startSecondBackend(),
    );
  });

  it("throws without adopting when there is no pid record", async () => {
    const adapter = busySecondAdapter(undefined, false);
    await assert.rejects(
      (adapter as unknown as { startSecondBackend: () => Promise<void> }).startSecondBackend(),
      /does not record a live pid .* did not adopt it and did not stop anything/,
    );
  });

  it("throws when the recorded pid is not live", async () => {
    const adapter = busySecondAdapter({ pid: 77, baseUrl: `http://127.0.0.1:${String(port)}` }, false);
    await assert.rejects(
      (adapter as unknown as { startSecondBackend: () => Promise<void> }).startSecondBackend(),
      /does not record a live pid/,
    );
  });

  it("throws when the recorded baseUrl is for a different URL", async () => {
    const adapter = busySecondAdapter({ pid: 77, baseUrl: "http://127.0.0.1:9999" }, true);
    await assert.rejects(
      (adapter as unknown as { startSecondBackend: () => Promise<void> }).startSecondBackend(),
      /does not record a live pid/,
    );
  });
});

describe("MedusaAdapter startAndAwaitSecondBackend cleanup", () => {
  const realLog = console.log;
  const realWarn = console.warn;

  beforeEach(() => {
    console.log = () => undefined;
    console.warn = () => undefined;
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  function cleanupAdapter(launched: boolean, readyError?: Error) {
    const adapter = new MedusaAdapter({
      baseUrl: "http://127.0.0.1:9000",
      secondBaseUrl: "http://127.0.0.1:9001",
    } as MedusaConfig);
    const internals = adapter as unknown as {
      startSecondBackend: () => Promise<boolean>;
      waitSecondReady: (url: string, timeoutMs: number) => Promise<void>;
      stopSecondBackend: () => Promise<void>;
    };
    const calls = { stopped: 0 };
    internals.startSecondBackend = async () => launched;
    internals.waitSecondReady = async () => {
      if (readyError !== undefined) {
        throw readyError;
      }
    };
    internals.stopSecondBackend = async () => {
      calls.stopped += 1;
    };
    return { adapter, calls };
  }

  it("stops the second backend on a readiness failure when this call launched it", async () => {
    const { adapter, calls } = cleanupAdapter(true, new Error("not ready"));
    await assert.rejects(
      (adapter as unknown as { startAndAwaitSecondBackend: () => Promise<void> }).startAndAwaitSecondBackend(),
      /not ready/,
    );
    assert.equal(calls.stopped, 1);
  });

  it("does not stop an adopted second backend on a readiness failure", async () => {
    const { adapter, calls } = cleanupAdapter(false, new Error("not ready"));
    await assert.rejects(
      (adapter as unknown as { startAndAwaitSecondBackend: () => Promise<void> }).startAndAwaitSecondBackend(),
      /not ready/,
    );
    assert.equal(calls.stopped, 0);
  });

  it("does not stop anything when the second backend becomes ready", async () => {
    const { adapter, calls } = cleanupAdapter(true);
    await (adapter as unknown as { startAndAwaitSecondBackend: () => Promise<void> }).startAndAwaitSecondBackend();
    assert.equal(calls.stopped, 0);
  });
});

describe("MedusaAdapter startSecondBackend and an existing pid record", () => {
  const realLog = console.log;
  const realWarn = console.warn;

  beforeEach(() => {
    console.log = () => undefined;
    console.warn = () => undefined;
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  async function freeSecondUrl(): Promise<string> {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return `http://127.0.0.1:${String(port)}`;
  }

  function adapterWithRecord(secondBaseUrl: string, record: { pid: number; baseUrl?: string }, pidLive: boolean) {
    const adapter = new MedusaAdapter({
      baseUrl: "http://127.0.0.1:9000",
      productRoot: "/products/medusa-dtc-starter",
      secondBaseUrl,
    } as MedusaConfig);
    const internals = adapter as unknown as {
      readSecondRecord: () => { pid: number; baseUrl?: string } | undefined;
      secondPidRunning: (pid: number) => boolean;
    };
    internals.readSecondRecord = () => record;
    internals.secondPidRunning = () => pidLive;
    return adapter;
  }

  it("refuses to overwrite a record whose pid is still live at a different URL", async () => {
    const url = await freeSecondUrl();
    const adapter = adapterWithRecord(url, { pid: 77, baseUrl: "http://127.0.0.1:9999" }, true);
    await assert.rejects(
      (adapter as unknown as { startSecondBackend: () => Promise<boolean> }).startSecondBackend(),
      /still records live pid 77 at http:\/\/127\.0\.0\.1:9999\. Run down first/,
    );
  });

  it("does not block on a stale record whose pid is no longer running", async () => {
    const url = await freeSecondUrl();
    const adapter = adapterWithRecord(url, { pid: 77, baseUrl: "http://127.0.0.1:9999" }, false);
    // Passes the record guard and stops at the missing start directory, so no process is spawned.
    await assert.rejects(
      (adapter as unknown as { startSecondBackend: () => Promise<boolean> }).startSecondBackend(),
      /start directory missing/,
    );
  });
});
