import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calHeapEnv, CAL_HEAP_MB } from "./cal.adapter.js";

describe("calHeapEnv", () => {
  it("is byte-identical to v0.2.18 when NODE_OPTIONS is unset or blank", () => {
    assert.equal(CAL_HEAP_MB, 8192);
    assert.deepEqual(calHeapEnv({}), { NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=8192" });
    assert.deepEqual(calHeapEnv({ NODE_OPTIONS: "   " }), calHeapEnv({}));
  });

  it("merges the default into a preset NODE_OPTIONS instead of dropping it", () => {
    assert.equal(calHeapEnv({ NODE_OPTIONS: "--use-openssl-ca" }).NODE_OPTIONS, "--use-openssl-ca --max-old-space-size=8192");
  });

  it("keeps the caller's own heap limit with no second flag", () => {
    assert.equal(calHeapEnv({ NODE_OPTIONS: "--max-old-space-size=4096" }).NODE_OPTIONS, "--max-old-space-size=4096");
  });
});
