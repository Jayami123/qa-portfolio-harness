import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureP4Network, P4_NETWORK, p4NetworkCreateArgs, p4NetworkInspectArgs } from "./p4-network.js";

describe("p4 network helper (review answer 0.1; CI fix: create before any Part A product)", () => {
  it("uses the qa-harness-p4 name", () => {
    assert.equal(P4_NETWORK, "qa-harness-p4");
  });

  it("builds inspect and create argv for a bridge network with that name", () => {
    assert.deepEqual(p4NetworkInspectArgs(), ["network", "inspect", "qa-harness-p4"]);
    assert.deepEqual(p4NetworkCreateArgs(), ["network", "create", "--driver", "bridge", "qa-harness-p4"]);
  });

  it("creates the network when inspect fails (missing)", async () => {
    const calls: string[][] = [];
    await ensureP4Network(async (args) => {
      calls.push(args);
      if (args[0] === "network" && args[1] === "inspect") throw new Error("No such network");
    });
    assert.deepEqual(calls, [p4NetworkInspectArgs(), p4NetworkCreateArgs()]);
  });

  it("leaves an existing network alone (idempotent)", async () => {
    const calls: string[][] = [];
    await ensureP4Network(async (args) => {
      calls.push(args);
    });
    assert.deepEqual(calls, [p4NetworkInspectArgs()]);
  });

  it("propagates a failed create instead of swallowing it", async () => {
    await assert.rejects(
      ensureP4Network(async (args) => {
        if (args[1] === "inspect") throw new Error("missing");
        throw new Error("create refused");
      }),
      /create refused/,
    );
  });
});
