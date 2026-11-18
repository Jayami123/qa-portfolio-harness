import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMemUsageMiB, RAM_BUDGET_MIB, summarize, type RamSample } from "./p4-ram.js";

describe("parseMemUsageMiB", () => {
  it("reads binary and decimal units into MiB", () => {
    assert.equal(parseMemUsageMiB("884.3MiB / 15.71GiB"), 884.3);
    assert.equal(parseMemUsageMiB("1GiB / 15GiB"), 1024);
    assert.equal(parseMemUsageMiB("2048KiB / 1GiB"), 2);
    assert.ok(Math.abs(parseMemUsageMiB("1000MB / 1GiB") - 953.67) < 0.01);
    assert.ok(Math.abs(parseMemUsageMiB("1000kB / 1GiB") - 0.9537) < 0.001);
  });

  it("returns NaN for garbage, an unknown unit, or an empty value", () => {
    assert.ok(Number.isNaN(parseMemUsageMiB("")));
    assert.ok(Number.isNaN(parseMemUsageMiB("n/a / 1GiB")));
    assert.ok(Number.isNaN(parseMemUsageMiB("12XB / 1GiB")));
  });
});

describe("summarize", () => {
  it("checks the budget against the peak of the per-instant sum, not the sum of peaks", () => {
    // Two containers that peak at different times. Their sum per instant is never 200, but each peaks at 100.
    const samples: RamSample[] = [
      { t: 1, container: "qa-harness-a-1", mib: 100 },
      { t: 1, container: "qa-harness-b-1", mib: 10 },
      { t: 2, container: "qa-harness-a-1", mib: 10 },
      { t: 2, container: "qa-harness-b-1", mib: 100 },
    ];
    const report = summarize(samples, { products: ["a", "b"] });
    assert.equal(report.totalPeakMiB, 110);
    assert.equal(report.sumOfPeaksMiB, 200);
    assert.ok(report.totalPeakMiB <= report.sumOfPeaksMiB);
    assert.deepEqual(
      report.containers.map((c) => [c.name, c.peakMiB]),
      [
        ["qa-harness-a-1", 100],
        ["qa-harness-b-1", 100],
      ],
    );
  });

  it("fits at exactly the budget and fails one MiB over", () => {
    const at: RamSample[] = [{ t: 1, container: "qa-harness-x-1", mib: RAM_BUDGET_MIB }];
    assert.equal(summarize(at, { products: ["x"] }).fit, true);
    const over: RamSample[] = [{ t: 1, container: "qa-harness-x-1", mib: RAM_BUDGET_MIB + 1 }];
    assert.equal(summarize(over, { products: ["x"] }).fit, false);
  });

  it("never passes an empty probe", () => {
    const report = summarize([], { products: ["x"] });
    assert.equal(report.fit, false);
    assert.deepEqual(report.containers, []);
    assert.equal(report.totalPeakMiB, 0);
  });

  it("ignores samples with a NaN value", () => {
    const samples: RamSample[] = [
      { t: 1, container: "qa-harness-x-1", mib: Number.NaN },
      { t: 2, container: "qa-harness-x-1", mib: 50 },
    ];
    const report = summarize(samples, { products: ["x"] });
    assert.equal(report.totalPeakMiB, 50);
    assert.equal(report.fit, true);
  });

  it("carries the host, disk and readiness numbers through, and the budget is committed at 14 GiB", () => {
    assert.equal(RAM_BUDGET_MIB, 14336);
    const report = summarize([{ t: 1, container: "qa-harness-x-1", mib: 10 }], {
      products: ["x"],
      hostUsedPeakMiB: 1234.56,
      diskFreeGiB: 12.34,
      readyMs: 987654,
    });
    assert.equal(report.hostUsedPeakMiB, 1234.6);
    assert.equal(report.diskFreeGiB, 12.3);
    assert.equal(report.readyMs, 987654);
    assert.equal(report.schema, 1);
  });
});
