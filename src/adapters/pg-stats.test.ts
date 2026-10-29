import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPgStatsExtension,
  pgStatsComposeFiles,
  pgStatsEnabled,
  type PgStatsExec,
} from "./pg-stats.js";

const EXEC: PgStatsExec = {
  project: "qa-harness-medusa",
  files: ["/harness/docker/medusa.compose.yml", "/harness/docker/medusa.pg-stats.compose.yml"],
  service: "postgres",
  user: "medusa",
  db: "medusa",
  cwd: "/harness/docker",
};

describe("pgStatsEnabled", () => {
  it("is on only when HARNESS_PG_STATS is exactly 1", () => {
    assert.equal(pgStatsEnabled({ HARNESS_PG_STATS: "1" }), true);
  });

  it("is off for true, yes, and near-miss values", () => {
    for (const value of ["true", "yes", "01", " 1", "2"]) {
      assert.equal(pgStatsEnabled({ HARNESS_PG_STATS: value }), false, `value ${JSON.stringify(value)}`);
    }
  });

  it("treats an empty or blank value as off", () => {
    assert.equal(pgStatsEnabled({ HARNESS_PG_STATS: "" }), false);
    assert.equal(pgStatsEnabled({ HARNESS_PG_STATS: "   " }), false);
  });
});

describe("pgStatsComposeFiles", () => {
  it("returns no overlay when the flag is off", () => {
    assert.deepEqual(pgStatsComposeFiles({ env: {}, product: "medusa" }), []);
    assert.deepEqual(pgStatsComposeFiles({ env: { HARNESS_PG_STATS: "true" }, product: "cal" }), []);
  });
});

describe("createPgStatsExtension", () => {
  it("runs psql with ON_ERROR_STOP through compose exec with the exact argv", async () => {
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    await createPgStatsExtension(EXEC, async (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      return { stdout: "", stderr: "" };
    });
    assert.deepEqual(calls, [
      {
        cmd: "docker",
        args: [
          "compose",
          "-p",
          "qa-harness-medusa",
          "-f",
          "/harness/docker/medusa.compose.yml",
          "-f",
          "/harness/docker/medusa.pg-stats.compose.yml",
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "medusa",
          "-d",
          "medusa",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "CREATE EXTENSION IF NOT EXISTS pg_stat_statements",
        ],
        cwd: "/harness/docker",
      },
    ]);
  });

  it("throws HARNESS_PG_STATS with the first 400 characters of the psql error", async () => {
    const longError = `ERROR: extension "pg_stat_statements" is not available ${"x".repeat(600)}`;
    await assert.rejects(
      createPgStatsExtension(EXEC, async () => {
        throw new Error(longError);
      }),
      (error: Error) => {
        const prefix = "HARNESS_PG_STATS: CREATE EXTENSION pg_stat_statements failed: ";
        assert.ok(error.message.startsWith(prefix));
        const excerpt = error.message.slice(prefix.length);
        assert.equal(excerpt.length, 400);
        assert.equal(excerpt, longError.slice(0, 400));
        return true;
      },
    );
  });
});
