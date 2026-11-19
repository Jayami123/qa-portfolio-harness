import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  TWENTY_SEED_APPLE_WORKSPACE_SUBDOMAIN,
  TWENTY_SEED_YC_WORKSPACE_SUBDOMAIN,
  assertTwentyImageTag,
  bootstrapTwentyDockerEnv,
  classifyTwentySecretValue,
  extractBearerFromLoginTokenExchange,
  extractBearerFromSignIn,
  isTwentyHealthyStatus,
  listTwentyDockerVolumeNames,
  parseDockerVolumeList,
  parseTwentyMetadataBody,
  seedExecFailedMessage,
  seedMembershipFailedMessage,
  seedResetFailedMessage,
  seedSkippedMessage,
  seedTwentyWithMembershipCheck,
  TWENTY_SEED_MAX_ATTEMPTS,
  selectWorkspaceOrigin,
  twentyComposeFilePaths,
  TWENTY_FORBIDDEN_COMPOSE_FRAGMENT,
  twentyHarnessVolumesExist,
  twentyVolumeResetCommand,
  assertTwentyFreshOrRefuse,
  readTwentyRequireFresh,
} from "./twenty-env.js";

describe("isTwentyHealthyStatus", () => {
  it("counts only HTTP 200 as healthy", () => {
    assert.equal(isTwentyHealthyStatus(200), true);
    assert.equal(isTwentyHealthyStatus(302), false);
    assert.equal(isTwentyHealthyStatus(502), false);
  });
});

describe("assertTwentyImageTag", () => {
  it("rejects empty and latest", () => {
    assert.throws(() => assertTwentyImageTag(""), /empty/);
    assert.throws(() => assertTwentyImageTag("latest"), /latest/);
    assert.throws(() => assertTwentyImageTag("  "), /empty/);
  });

  it("accepts a pinned tag", () => {
    assert.doesNotThrow(() => assertTwentyImageTag("v2.44.0"));
  });
});

describe("bootstrapTwentyDockerEnv", () => {
  const dockerDir = path.join("packages", "twenty-docker");
  const harnessCompose = "/harness/docker/twenty.compose.yml";

  it("copies example and writes both keys when .env is missing", () => {
    const files = new Map<string, string>([
      [path.join(dockerDir, ".env.example"), "TAG=latest\n# ENCRYPTION_KEY=replace_me\n"],
    ]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p) ?? "",
      writeFileSync: (p: string, data: string) => {
        files.set(p, data);
      },
      copyFileSync: (from: string, to: string) => {
        files.set(to, files.get(from) ?? "");
      },
    };
    const random = Buffer.from("a".repeat(32));
    const result = bootstrapTwentyDockerEnv({
      dockerDir,
      harnessComposeFile: harnessCompose,
      fs,
      randomBytes: () => random,
      volumes: { listVolumes: () => [] },
    });
    assert.equal(result.generatedNewSecrets, true);
    const env = files.get(path.join(dockerDir, ".env")) ?? "";
    assert.match(env, /^ENCRYPTION_KEY=.{10,}/m);
    assert.match(env, /^APP_SECRET=.{10,}/m);
  });

  it("does not overwrite a real ENCRYPTION_KEY", () => {
    const envPath = path.join(dockerDir, ".env");
    const files = new Map<string, string>([[envPath, "ENCRYPTION_KEY=real-key-value\nAPP_SECRET=replace_me\n"]]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p) ?? "",
      writeFileSync: (p: string, data: string) => {
        files.set(p, data);
      },
      copyFileSync: () => {
        throw new Error("unexpected copy");
      },
    };
    bootstrapTwentyDockerEnv({
      dockerDir,
      harnessComposeFile: harnessCompose,
      fs,
      randomBytes: () => Buffer.from("b".repeat(32)),
      volumes: { listVolumes: () => [] },
    });
    const env = files.get(envPath) ?? "";
    assert.match(env, /ENCRYPTION_KEY=real-key-value/);
    assert.doesNotMatch(env, /ENCRYPTION_KEY=real-key-value.*real-key-value/);
    assert.doesNotMatch(env, /Y{10,}/);
  });

  it("replaces replace_me placeholders", () => {
    const envPath = path.join(dockerDir, ".env");
    const files = new Map<string, string>([[envPath, "ENCRYPTION_KEY=replace_me_with_a_random_string\n"]]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p) ?? "",
      writeFileSync: (p: string, data: string) => {
        files.set(p, data);
      },
      copyFileSync: () => {
        throw new Error("unexpected copy");
      },
    };
    bootstrapTwentyDockerEnv({
      dockerDir,
      harnessComposeFile: harnessCompose,
      fs,
      randomBytes: () => Buffer.from("c".repeat(32)),
      volumes: { listVolumes: () => [] },
    });
    const env = files.get(envPath) ?? "";
    assert.doesNotMatch(env, /replace_me/);
  });

  it("never puts generated secrets into thrown mismatch errors", () => {
    const envPath = path.join(dockerDir, ".env");
    const files = new Map<string, string>([[envPath, "ENCRYPTION_KEY=replace_me\n"]]);
    const secret = Buffer.from("d".repeat(32)).toString("base64");
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p) ?? "",
      writeFileSync: (p: string, data: string) => {
        files.set(p, data);
      },
      copyFileSync: () => {
        throw new Error("unexpected copy");
      },
    };
    try {
      bootstrapTwentyDockerEnv({
        dockerDir,
        harnessComposeFile: harnessCompose,
        fs,
        randomBytes: () => Buffer.from(secret, "base64"),
        volumes: { listVolumes: () => ["qa-harness-twenty_db-data"] },
      });
      assert.fail("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Reset volumes/);
      assert.doesNotMatch(message, new RegExp(secret));
    }
  });

  it("allows restart when volumes exist and keys are real", () => {
    const envPath = path.join(dockerDir, ".env");
    const files = new Map<string, string>([[envPath, "ENCRYPTION_KEY=real-key\nAPP_SECRET=real-secret\n"]]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p) ?? "",
      writeFileSync: () => {
        throw new Error("should not write");
      },
      copyFileSync: () => {
        throw new Error("unexpected copy");
      },
    };
    const result = bootstrapTwentyDockerEnv({
      dockerDir,
      harnessComposeFile: harnessCompose,
      fs,
      randomBytes: () => Buffer.from("e".repeat(32)),
      volumes: { listVolumes: () => ["qa-harness-twenty_db-data", "qa-harness-twenty_server-local-data"] },
    });
    assert.equal(result.generatedNewSecrets, false);
  });
});

describe("twentyHarnessVolumesExist", () => {
  it("detects harness project volumes", () => {
    assert.equal(
      twentyHarnessVolumesExist({ listVolumes: () => ["qa-harness-twenty_db-data", "other"] }),
      true,
    );
    assert.equal(twentyHarnessVolumesExist({ listVolumes: () => ["other"] }), false);
  });
});

describe("parseTwentyMetadataBody", () => {
  it("throws on HTTP 200 with errors[]", () => {
    assert.throws(
      () => parseTwentyMetadataBody(200, { errors: [{ message: "nope" }] }, "test"),
      /GraphQL errors/,
    );
  });

  it("returns data when token present", () => {
    const data = parseTwentyMetadataBody(
      200,
      { data: { getLoginTokenFromCredentials: { loginToken: { token: "abc" } } } },
      "test",
    );
    assert.equal(data.getLoginTokenFromCredentials.loginToken.token, "abc");
  });

  it("throws when data is missing", () => {
    assert.throws(() => parseTwentyMetadataBody(200, {}, "test"), /no data/);
  });
});

describe("auth extractors", () => {
  it("reads bearer from signIn and login-token exchange", () => {
    assert.equal(
      extractBearerFromSignIn({
        signIn: { tokens: { accessOrWorkspaceAgnosticToken: { token: " direct " } } },
      }),
      "direct",
    );
    assert.equal(
      extractBearerFromLoginTokenExchange({
        getAuthTokensFromLoginToken: { tokens: { accessOrWorkspaceAgnosticToken: { token: "x" } } },
      }),
      "x",
    );
  });
});

describe("selectWorkspaceOrigin", () => {
  it("prefers subdomainUrl, then customUrl, then base", () => {
    assert.equal(
      selectWorkspaceOrigin(
        { workspaceUrls: { subdomainUrl: "http://apple.localhost:3002/", customUrl: "http://custom" } },
        "http://127.0.0.1:3002",
      ),
      "http://apple.localhost:3002",
    );
    assert.equal(
      selectWorkspaceOrigin({ workspaceUrls: { customUrl: "http://custom/" } }, "http://127.0.0.1:3002"),
      "http://custom",
    );
    assert.equal(selectWorkspaceOrigin({}, "http://127.0.0.1:3002"), "http://127.0.0.1:3002");
  });
});

describe("seed messages", () => {
  it("documents skip vs fail paths", () => {
    assert.match(seedSkippedMessage("jane@example.com"), /seed skipped/);
    const cause = "Error response from daemon: No such exec instance";
    const failMsg = seedExecFailedMessage("jane.austen@apple.dev", cause);
    assert.match(failMsg, /jane\.austen@apple\.dev/);
    assert.match(failMsg, /No such exec instance/);
    assert.match(failMsg, /TWENTY_DOWN_VOLUMES=1 npm run down -- twenty/);
    assert.doesNotMatch(failMsg, /already-seeded database/);
  });
});

describe("parseDockerVolumeList", () => {
  it("splits docker volume ls lines", () => {
    assert.deepEqual(parseDockerVolumeList("qa-harness-twenty_db-data\n\nqa-harness-twenty_server-local-data\n"), [
      "qa-harness-twenty_db-data",
      "qa-harness-twenty_server-local-data",
    ]);
  });
});

describe("listTwentyDockerVolumeNames", () => {
  it("propagates when docker volume ls fails", async () => {
    await assert.rejects(
      () =>
        listTwentyDockerVolumeNames(async () => {
          throw new Error("docker volume ls failed");
        }),
      /docker volume ls failed/,
    );
  });
});

describe("classifyTwentySecretValue", () => {
  it("classifies missing, placeholder, and real values", () => {
    assert.equal(classifyTwentySecretValue(undefined), "missing");
    assert.equal(classifyTwentySecretValue("replace_me_x"), "placeholder");
    assert.equal(classifyTwentySecretValue("abc"), "real");
  });
});

describe("twentyVolumeResetCommand", () => {
  it("includes harness overlay path", () => {
    assert.match(twentyVolumeResetCommand("/docker-dir", "/overlay.yml"), /down -v/);
    assert.match(twentyVolumeResetCommand("/docker-dir", "/overlay.yml"), /overlay\.yml/);
  });
});

describe("twentyComposeFilePaths", () => {
  it("uses only tracked fork compose plus harness overlay", () => {
    const dockerDir = path.join("products", "twenty-CRM", "packages", "twenty-docker");
    const overlay = path.join("harness", "docker", "twenty.compose.yml");
    const files = twentyComposeFilePaths(dockerDir, overlay);
    assert.equal(files.length, 2);
    assert.equal(files[0], path.join(dockerDir, "docker-compose.yml"));
    assert.equal(files[1], overlay);
    for (const file of files) {
      assert.doesNotMatch(file, new RegExp(TWENTY_FORBIDDEN_COMPOSE_FRAGMENT));
    }
  });
});

describe("readTwentyRequireFresh", () => {
  it('reads exactly "1" as on', () => {
    assert.equal(readTwentyRequireFresh({ TWENTY_REQUIRE_FRESH: "1" }), true);
  });

  it("treats unset and blank as off", () => {
    assert.equal(readTwentyRequireFresh({}), false);
    assert.equal(readTwentyRequireFresh({ TWENTY_REQUIRE_FRESH: "" }), false);
  });

  it('throws TWENTY_REQUIRE_FRESH_INVALID for "true", "0" and " 1"', () => {
    for (const raw of ["true", "0", " 1"]) {
      assert.throws(() => readTwentyRequireFresh({ TWENTY_REQUIRE_FRESH: raw }), /TWENTY_REQUIRE_FRESH_INVALID/);
    }
  });
});

describe("assertTwentyFreshOrRefuse", () => {
  const volumes = (names: string[]) => ({ listVolumes: () => names });
  const DB = "qa-harness-twenty_db-data";
  const SERVER = "qa-harness-twenty_server-local-data";

  it("throws naming both volumes when both exist", () => {
    assert.throws(
      () => assertTwentyFreshOrRefuse({ requireFresh: true, volumes: volumes([DB, SERVER]) }),
      (err: Error) => err.message.includes(DB) && err.message.includes(SERVER) && err.message.includes("TWENTY_REQUIRE_FRESH_VOLUMES_EXIST"),
    );
  });

  it("names only the volume that exists", () => {
    assert.throws(
      () => assertTwentyFreshOrRefuse({ requireFresh: true, volumes: volumes([SERVER]) }),
      (err: Error) => err.message.includes(SERVER) && !err.message.includes(DB),
    );
    assert.throws(
      () => assertTwentyFreshOrRefuse({ requireFresh: true, volumes: volumes([DB]) }),
      (err: Error) => err.message.includes(DB) && !err.message.includes(SERVER),
    );
  });

  it("does not throw when no harness volume exists", () => {
    assert.doesNotThrow(() => assertTwentyFreshOrRefuse({ requireFresh: true, volumes: volumes(["other_volume"]) }));
  });

  it("does not throw when requireFresh is false, even with volumes present", () => {
    assert.doesNotThrow(() => assertTwentyFreshOrRefuse({ requireFresh: false, volumes: volumes([DB, SERVER]) }));
  });
});

/** The two seed workspace lines copied verbatim from the fork's dev seeder at 7cbdfec6 (seeder-workspaces.constant.ts:36-47).
 *  Copied, not read from disk: the fork is not present in CI, and the harness never edits it. */
const SEEDER_FIXTURE = `
    displayName: 'Apple',
    subdomain: 'apple',
    inviteHash: 'apple.dev-invite-hash',
  },
  [SEED_YCOMBINATOR_WORKSPACE_ID]: {
    displayName: 'YCombinator',
    subdomain: 'yc',
    inviteHash: 'yc.dev-invite-hash',
`;

describe("seed workspace subdomains", () => {
  it("match the seeder at the 7cbdfec6 pin, in Apple then YCombinator order", () => {
    const found = [...SEEDER_FIXTURE.matchAll(/subdomain: '([a-z0-9-]+)'/g)].map((m) => m[1]);
    assert.deepEqual(found, [TWENTY_SEED_APPLE_WORKSPACE_SUBDOMAIN, TWENTY_SEED_YC_WORKSPACE_SUBDOMAIN]);
  });

  it("are the exact seeded strings (no guess)", () => {
    assert.equal(TWENTY_SEED_APPLE_WORKSPACE_SUBDOMAIN, "apple");
    assert.equal(TWENTY_SEED_YC_WORKSPACE_SUBDOMAIN, "yc");
  });
});


describe("seedTwentyWithMembershipCheck (a cut-short upstream seed is reset and retried, then reported)", () => {
  const EMAIL = "tim@apple.dev";
  type Step = { exec?: "ok" | "throw"; member: boolean; resetFails?: boolean };
  /** A scripted run. `events` records the order of seed, member and reset calls, so ordering can be asserted. */
  function scripted(script: Step[]) {
    const events: string[] = [];
    let seeds = 0;
    let members = 0;
    let resets = 0;
    const logs: string[] = [];
    return {
      events,
      logs,
      counts: () => ({ seeds, members, resets }),
      io: {
        runSeed: async () => {
          const step = script[Math.min(seeds, script.length - 1)]!;
          seeds++;
          events.push("seed");
          if (step.exec === "throw") throw new Error("Query read timeout");
        },
        membershipOk: async () => {
          const step = script[Math.min(members, script.length - 1)]!;
          members++;
          events.push("member");
          return step.member;
        },
        reset: async () => {
          const step = script[Math.min(resets, script.length - 1)]!;
          resets++;
          events.push("reset");
          if (step.resetFails === true) throw new Error("docker compose down failed");
        },
        log: (line: string) => logs.push(line),
      },
    };
  }

  it("allows the seed once and two retries", () => {
    assert.equal(TWENTY_SEED_MAX_ATTEMPTS, 3);
  });

  it("returns 1 and never resets when the first seed leaves a usable membership", async () => {
    const t = scripted([{ member: true }]);
    assert.equal(await seedTwentyWithMembershipCheck(t.io, EMAIL), 1);
    assert.deepEqual(t.events, ["seed", "member"]);
    assert.deepEqual(t.logs, []);
  });

  it("forced failure: the membership check fails the first time, the database is reset, and the second seed recovers", async () => {
    const t = scripted([{ member: false }, { member: true }]);
    assert.equal(await seedTwentyWithMembershipCheck(t.io, EMAIL), 2);
    // The reset sits between the failed attempt and the retry. The retry never runs on top of the partial seed.
    assert.deepEqual(t.events, ["seed", "member", "reset", "seed", "member"]);
    assert.match(t.logs[0] ?? "", /attempt 1 of 3 did not leave a usable workspace/);
    assert.match(t.logs[0] ?? "", /resetting the database/);
  });

  it("forced failure: a seed command that throws is reset and retried too, and its membership is not trusted", async () => {
    const t = scripted([{ exec: "throw", member: true }, { exec: "ok", member: true }]);
    assert.equal(await seedTwentyWithMembershipCheck(t.io, EMAIL), 2);
    assert.deepEqual(t.events, ["seed", "reset", "seed", "member"]);
  });

  it("recovers on the third attempt, with a reset before each retry and none before the first", async () => {
    const t = scripted([{ member: false }, { member: false }, { member: true }]);
    assert.equal(await seedTwentyWithMembershipCheck(t.io, EMAIL), 3);
    assert.deepEqual(t.events, ["seed", "member", "reset", "seed", "member", "reset", "seed", "member"]);
  });

  it("after the last retry fails: a clear error, three seeds, two resets, no reset after the last attempt", async () => {
    const t = scripted([{ member: false }]);
    await assert.rejects(seedTwentyWithMembershipCheck(t.io, EMAIL), (err: Error) => {
      assert.match(err.message, /after 3 attempt\(s\), each on a freshly reset database/);
      assert.match(err.message, /User is not a member of the workspace/);
      assert.match(err.message, /exited 0 but the workspace membership check failed/);
      assert.match(err.message, /TWENTY_DOWN_VOLUMES=1 npm run down -- twenty/);
      assert.ok(err.message.includes(EMAIL));
      return true;
    });
    assert.deepEqual(t.counts(), { seeds: 3, members: 3, resets: 2 });
    assert.equal(t.events[t.events.length - 1], "member", "the last event is the last membership check, not a reset");
  });

  it("reports a thrown seed command's message in the final error", async () => {
    const t = scripted([{ exec: "throw", member: false }]);
    await assert.rejects(seedTwentyWithMembershipCheck(t.io, EMAIL), /seed command failed: Query read timeout/);
    assert.equal(t.counts().seeds, 3);
  });

  it("stops with a clear error when a reset itself fails, and does not seed again", async () => {
    const t = scripted([{ member: false, resetFails: true }]);
    await assert.rejects(seedTwentyWithMembershipCheck(t.io, EMAIL), (err: Error) => {
      assert.match(err.message, /attempt 1 failed and the reset before the next attempt also failed: docker compose down failed/);
      assert.match(err.message, /TWENTY_DOWN_VOLUMES=1 npm run down -- twenty/);
      assert.equal((err.cause as Error).message, "docker compose down failed");
      return true;
    });
    assert.deepEqual(t.events, ["seed", "member", "reset"]);
  });

  it("builds the failure messages without a password or token", () => {
    assert.doesNotMatch(seedMembershipFailedMessage(EMAIL, 3, "x"), /password|token=|Bearer/i);
    assert.doesNotMatch(seedResetFailedMessage(1, "x"), /password|token=|Bearer/i);
  });
});
