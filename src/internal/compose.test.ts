import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAL_POSTGRES_SERVICE } from "../adapters/cal.adapter.js";
import { pgStatsComposeFilePaths } from "../adapters/pg-stats.js";
import { composeExecArgs, composeRestartArgs, composeUpArgs, type ComposeOptions } from "./compose.js";

const calOptions = (env: NodeJS.ProcessEnv): ComposeOptions => ({
  projectName: "qa-harness-cal",
  files: [
    "/cal/packages/prisma/docker-compose.yml",
    "/harness/docker/cal.compose.yml",
    ...pgStatsComposeFilePaths({ env, product: "cal" }),
  ],
  cwd: "/cal/packages/prisma",
});

describe("composeUpArgs for Cal", () => {
  it("waits on the postgres service only when HARNESS_PG_STATS=1", () => {
    const [overlay] = pgStatsComposeFilePaths({ env: { HARNESS_PG_STATS: "1" }, product: "cal" });
    const argv = composeUpArgs(calOptions({ HARNESS_PG_STATS: "1" }), {
      wait: true,
      waitServices: [CAL_POSTGRES_SERVICE],
    });
    assert.deepEqual(argv, [
      "compose",
      "-p",
      "qa-harness-cal",
      "-f",
      "/cal/packages/prisma/docker-compose.yml",
      "-f",
      "/harness/docker/cal.compose.yml",
      "-f",
      overlay,
      "up",
      "-d",
      "--wait",
      "postgres",
    ]);
  });

  it("is byte-identical to v0.2.17 when the flag is off: no --wait, no service, no overlay", () => {
    const expected = [
      "compose",
      "-p",
      "qa-harness-cal",
      "-f",
      "/cal/packages/prisma/docker-compose.yml",
      "-f",
      "/harness/docker/cal.compose.yml",
      "up",
      "-d",
    ];
    const argv = composeUpArgs(calOptions({}), {
      wait: false,
      waitServices: [CAL_POSTGRES_SERVICE],
    });
    assert.deepEqual(argv, expected);
    // Only the exact value "1" turns the flag on, so "true" keeps the v0.2.17 argv too.
    assert.deepEqual(
      composeUpArgs(calOptions({ HARNESS_PG_STATS: "true" }), {
        wait: false,
        waitServices: [CAL_POSTGRES_SERVICE],
      }),
      expected,
    );
  });

  it("never passes --wait without naming the postgres service on the Cal path", () => {
    const argv = composeUpArgs(calOptions({ HARNESS_PG_STATS: "1" }), {
      wait: true,
      waitServices: [CAL_POSTGRES_SERVICE],
    });
    assert.equal(argv[argv.indexOf("--wait") + 1], "postgres");
  });
});

describe("compose restart and exec argv (H6, H2, H3)", () => {
  const opts: ComposeOptions = { projectName: "qa-harness-openclaw", files: ["/harness/docker/openclaw.compose.yml"], cwd: "/harness/docker" };

  it("restarts one service and nothing else", () => {
    assert.deepEqual(composeRestartArgs(opts, "openclaw"), ["compose", "-p", "qa-harness-openclaw", "-f", "/harness/docker/openclaw.compose.yml", "restart", "openclaw"]);
  });

  it("execs without a tty and passes the command as separate argv entries", () => {
    assert.deepEqual(composeExecArgs(opts, "openclaw", ["openclaw", "approvals", "get", "--json"]), [
      "compose", "-p", "qa-harness-openclaw", "-f", "/harness/docker/openclaw.compose.yml",
      "exec", "-T", "openclaw", "openclaw", "approvals", "get", "--json",
    ]);
  });
});
