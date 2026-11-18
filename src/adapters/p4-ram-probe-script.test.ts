import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

/**
 * CI fix: the probe writes its report even when readiness fails. This runs the real script with a fake npm that fails on
 * `up`, so readiness is skipped, then checks that the JSON exists with readiness marked failed and overallPass false.
 * The fake docker only lets the sampler run. The report must not depend on dist/ being built.
 */
describe("scripts/p4-ram-probe.sh always writes the report (CI fix)", () => {
  it("writes readiness, bindCheck and overallPass when an up fails", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "p4-probe-bin-"));
    fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const rel = path.join("evidence", `test-ram-probe-${process.pid}.json`);
    try {
      const r = spawnSync("bash", ["scripts/p4-ram-probe.sh", "litellm"], {
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, P4_RAM_OUT: rel, CI: "" },
      });
      assert.notEqual(r.status, 0, "a failed up must fail the probe");
      const json = JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")) as {
        readiness?: { status?: string; failedProduct?: string };
        bindCheck?: { status?: string };
        overallPass?: boolean;
      };
      assert.equal(json.readiness?.status, "failed");
      assert.equal(json.readiness?.failedProduct, "litellm");
      assert.ok(json.bindCheck?.status === "ok" || json.bindCheck?.status === "failed", "the bind check is recorded");
      assert.equal(json.overallPass, false);
    } finally {
      fs.rmSync(path.resolve(rel), { force: true });
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});
