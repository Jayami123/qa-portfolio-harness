import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpWaitIo, waitForMcpServers } from "./librechat-mcp-wait.js";

const NAMES = ["nextcloud", "outline", "twenty", "penpot", "mattermost"];
const ALL_CONNECTED = { connectionStatus: Object.fromEntries(NAMES.map((n) => [n, { connectionState: "connected" }])) };
const TOOLS = { servers: Object.fromEntries(NAMES.map((n) => [n, { tools: [{ name: `${n}-tool` }] }])) };

/** A fake clock and a scripted server. sleep() advances the clock, so no real time passes. */
function fakeIo(script: { statusBodies: unknown[]; toolsBodies?: unknown[] }) {
  const calls: string[] = [];
  let clock = 0;
  let statusIndex = 0;
  let toolsIndex = 0;
  const timeouts: Record<string, string>[] = [];
  const io: McpWaitIo = {
    openTools: async () => {
      calls.push("openTools");
      const body = (script.toolsBodies ?? [TOOLS])[Math.min(toolsIndex, (script.toolsBodies ?? [TOOLS]).length - 1)];
      toolsIndex += 1;
      return body;
    },
    readStatus: async () => {
      calls.push("readStatus");
      const body = script.statusBodies[Math.min(statusIndex, script.statusBodies.length - 1)];
      statusIndex += 1;
      return body;
    },
    onTimeout: (states) => {
      timeouts.push(states);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { io, calls, timeouts };
}

const DISCONNECTED = { connectionStatus: Object.fromEntries(NAMES.map((n) => [n, { connectionState: "disconnected" }])) };
const OPTS = { names: NAMES, timeoutMs: 60_000, pollMs: 2_000, reopenMs: 15_000 };

describe("waitForMcpServers (CI fix: open connections before polling status)", () => {
  it("calls the tools route before the first status poll", async () => {
    const { io, calls } = fakeIo({ statusBodies: [ALL_CONNECTED] });
    await waitForMcpServers(io, OPTS);
    assert.equal(calls[0], "openTools", "the first call must open the connections");
    assert.equal(calls.indexOf("readStatus") > calls.indexOf("openTools"), true);
  });

  it("never polls status before the connections have been opened", async () => {
    const { io, calls } = fakeIo({ statusBodies: [DISCONNECTED, DISCONNECTED, ALL_CONNECTED] });
    await waitForMcpServers(io, OPTS);
    const firstStatus = calls.indexOf("readStatus");
    const firstOpen = calls.indexOf("openTools");
    assert.ok(firstOpen >= 0 && firstOpen < firstStatus);
  });

  it("returns the tool counts for all five servers once every one is connected", async () => {
    const { io } = fakeIo({ statusBodies: [DISCONNECTED, ALL_CONNECTED] });
    const counts = await waitForMcpServers(io, OPTS);
    assert.deepEqual(Object.keys(counts).sort(), [...NAMES].sort());
    assert.equal(counts.nextcloud, 1);
  });

  it("does not return while any one of the five is still down", async () => {
    const oneDown = {
      connectionStatus: {
        ...Object.fromEntries(NAMES.map((n) => [n, { connectionState: "connected" }])),
        mattermost: { connectionState: "disconnected" },
      },
    };
    const { io, calls } = fakeIo({ statusBodies: [oneDown, ALL_CONNECTED] });
    await waitForMcpServers(io, OPTS);
    assert.equal(calls.filter((c) => c === "readStatus").length, 2, "it polled again after the one server was down");
  });

  it("re-opens the connections at the reopen interval while a server is still down", async () => {
    const { io, calls } = fakeIo({ statusBodies: [DISCONNECTED] });
    await assert.rejects(waitForMcpServers(io, { ...OPTS, timeoutMs: 40_000 }));
    const opens = calls.filter((c) => c === "openTools").length;
    assert.ok(opens >= 3, `expected re-opens during the wait, got ${opens}`);
  });

  it("on timeout, lists every server's state and hands them to onTimeout", async () => {
    const { io, timeouts } = fakeIo({ statusBodies: [DISCONNECTED] });
    await assert.rejects(waitForMcpServers(io, { ...OPTS, timeoutMs: 6_000 }), (err: Error) => {
      for (const n of NAMES) assert.match(err.message, new RegExp(`${n}=disconnected`));
      return true;
    });
    assert.equal(timeouts.length, 1);
    assert.deepEqual(Object.keys(timeouts[0] ?? {}).sort(), [...NAMES].sort());
  });

  it("keeps waiting when a status read fails, then succeeds", async () => {
    let fail = true;
    const { io } = fakeIo({ statusBodies: [ALL_CONNECTED] });
    const real = io.readStatus;
    io.readStatus = async () => {
      if (fail) {
        fail = false;
        throw new Error("socket hang up");
      }
      return real();
    };
    const counts = await waitForMcpServers(io, OPTS);
    assert.equal(Object.keys(counts).length, 5);
  });

  it("runs onFirstNotConnected once, as soon as a server is down, and not when all are up at once", async () => {
    const seen: Record<string, string>[] = [];
    const { io, calls } = fakeIo({ statusBodies: [DISCONNECTED, DISCONNECTED, ALL_CONNECTED] });
    io.onFirstNotConnected = async (states) => {
      seen.push(states);
      calls.push("probe");
    };
    await waitForMcpServers(io, OPTS);
    assert.equal(seen.length, 1, "exactly once");
    assert.equal(calls.indexOf("probe") < calls.lastIndexOf("readStatus"), true, "it ran before the wait ended");
    assert.deepEqual(Object.keys(seen[0] ?? {}).sort(), [...NAMES].sort());

    const quiet = fakeIo({ statusBodies: [ALL_CONNECTED] });
    let ran = false;
    quiet.io.onFirstNotConnected = async () => {
      ran = true;
    };
    await waitForMcpServers(quiet.io, OPTS);
    assert.equal(ran, false);
  });
});
