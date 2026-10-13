import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertTwentyImageTag,
  bootstrapTwentyDockerEnv,
  classifyTwentySecretValue,
  extractBearerFromLoginTokenExchange,
  extractBearerFromSignIn,
  isTwentyHealthyStatus,
  listTwentyDockerVolumeNames,
  parseDockerVolumeList,
  parseTwentyMetadataBody,
  seedFailRerunMessage,
  seedSkippedMessage,
  selectWorkspaceOrigin,
  twentyComposeFilePaths,
  TWENTY_FORBIDDEN_COMPOSE_FRAGMENT,
  twentyHarnessVolumesExist,
  twentyVolumeResetCommand,
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
    assert.match(seedFailRerunMessage(), /seeder output above/);
    assert.match(seedFailRerunMessage(), /down -v/);
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
