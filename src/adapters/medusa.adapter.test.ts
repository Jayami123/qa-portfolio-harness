import assert from "node:assert/strict";
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
