import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { P4_NETWORK, p4NetworkCreateArgs, p4NetworkInspectArgs } from "./p4-network.js";

describe("p4 network helper (review answer 0.1)", () => {
  it("uses the qa-harness-p4 name", () => {
    assert.equal(P4_NETWORK, "qa-harness-p4");
  });

  it("builds inspect and create argv for a bridge network with that name", () => {
    assert.deepEqual(p4NetworkInspectArgs(), ["network", "inspect", "qa-harness-p4"]);
    assert.deepEqual(p4NetworkCreateArgs(), ["network", "create", "--driver", "bridge", "qa-harness-p4"]);
  });
});
