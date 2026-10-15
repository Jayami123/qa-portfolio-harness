import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertMedusaBackendPresent,
  assertMedusaNodeVersion,
  assertMedusaPnpmVersion,
  buildMedusaBackendEnvFile,
  classifyMedusaProbe,
  decideMedusaBuildSkip,
  isMedusaHealthyStatus,
  medusaBackendConfigPath,
  medusaBackendStartArgs,
  medusaHarnessBuildMarkerPath,
  medusaHealthUrl,
  medusaListen,
  parseMedusaEnvFile,
  parseMedusaHarnessBuildGitSha,
  redactMedusaText,
  redactPublishableKey,
  serializeMedusaHarnessBuildRecord,
} from "./medusa-env.js";

const TEMPLATE = [
  "STORE_CORS=http://localhost:8000",
  "ADMIN_CORS=http://localhost:9000",
  "AUTH_CORS=http://localhost:9000",
  "REDIS_URL=redis://localhost:6379",
  "JWT_SECRET=fixture-jwt",
  "COOKIE_SECRET=fixture-cookie",
  "DATABASE_URL=",
  "DB_NAME=medusa-backend",
  "",
].join("\n");

const DATABASE_URL = "postgres://medusa:medusa@127.0.0.1:5433/medusa";

describe("medusaListen", () => {
  it("accepts 127.0.0.1 and defaults the port to 9000", () => {
    assert.deepEqual(medusaListen("http://127.0.0.1"), { host: "127.0.0.1", port: "9000" });
    assert.deepEqual(medusaListen("http://127.0.0.1:9000"), { host: "127.0.0.1", port: "9000" });
  });

  it("rejects localhost so an IPv6-only bind cannot pass silently", () => {
    assert.throws(() => medusaListen("http://localhost:9000"), /must use 127\.0\.0\.1/);
  });
});

describe("medusaHealthUrl", () => {
  it("is GET /health on the 127.0.0.1 listen URL", () => {
    assert.equal(medusaHealthUrl("http://127.0.0.1:9000/"), "http://127.0.0.1:9000/health");
  });
});

describe("isMedusaHealthyStatus", () => {
  it("counts only HTTP 200 as healthy", () => {
    assert.equal(isMedusaHealthyStatus(200), true);
    assert.equal(isMedusaHealthyStatus(201), false);
    assert.equal(isMedusaHealthyStatus(204), false);
    assert.equal(isMedusaHealthyStatus(301), false);
    assert.equal(isMedusaHealthyStatus(404), false);
    assert.equal(isMedusaHealthyStatus(500), false);
  });
});

describe("classifyMedusaProbe", () => {
  it("treats a localhost-only 200 as environment, never healthy", () => {
    assert.equal(classifyMedusaProbe(true, false), "healthy");
    assert.equal(classifyMedusaProbe(false, true), "environment");
    assert.equal(classifyMedusaProbe(false, false), "unhealthy");
  });
});

describe("assertMedusaNodeVersion", () => {
  it("accepts 22.22.0 and newer, and rejects 22.21", () => {
    assert.doesNotThrow(() => assertMedusaNodeVersion("22.22.0"));
    assert.doesNotThrow(() => assertMedusaNodeVersion("v24.21.0"));
    assert.throws(() => assertMedusaNodeVersion("22.21.9"), /22\.22\.0/);
    assert.throws(() => assertMedusaNodeVersion("20.19.0"), /22\.22\.0/);
  });
});

describe("assertMedusaPnpmVersion", () => {
  it("accepts the starter packageManager and rejects older pnpm", () => {
    assert.doesNotThrow(() => assertMedusaPnpmVersion("10.11.1"));
    assert.doesNotThrow(() => assertMedusaPnpmVersion("10.12.0"));
    assert.throws(() => assertMedusaPnpmVersion("10.11.0"), /10\.11\.1/);
    assert.throws(() => assertMedusaPnpmVersion("9.15.0"), /10\.11\.1/);
  });
});

describe("buildMedusaBackendEnvFile", () => {
  it("sets DATABASE_URL to the harness Postgres URL on 127.0.0.1 and drops REDIS_URL", () => {
    const file = buildMedusaBackendEnvFile(TEMPLATE, { databaseUrl: DATABASE_URL });
    const env = parseMedusaEnvFile(file);
    assert.equal(env.DATABASE_URL, DATABASE_URL);
    assert.equal(env.REDIS_URL, undefined);
    assert.equal(env.JWT_SECRET, "fixture-jwt");
    assert.equal(env.DB_NAME, "medusa-backend");
    assert.equal(file.includes("127.0.0.1:5433"), true);
    assert.equal(file.includes("redis://"), false);
  });

  it("writes REDIS_URL only when the caller passes one", () => {
    const file = buildMedusaBackendEnvFile(TEMPLATE, {
      databaseUrl: DATABASE_URL,
      redisUrl: "redis://127.0.0.1:6380",
    });
    assert.equal(parseMedusaEnvFile(file).REDIS_URL, "redis://127.0.0.1:6380");
  });
});

describe("redactPublishableKey", () => {
  const realisticKey = `pk_${"a".repeat(64)}`;

  it("does not echo a realistic pk_ token", () => {
    assert.equal(realisticKey.length, 67);
    const redacted = redactPublishableKey(realisticKey);
    assert.equal(redacted.includes(realisticKey), false);
    assert.equal(redacted.includes("a".repeat(8)), false);
    assert.equal(redacted, "(redacted)");
  });

  it("does not throw on empty or short input", () => {
    assert.equal(redactPublishableKey(""), "(empty)");
    assert.equal(redactPublishableKey("   "), "(empty)");
    assert.equal(redactPublishableKey("pk_short"), "(redacted)");
    assert.equal(redactPublishableKey("pk_short").includes("pk_short"), false);
  });
});

describe("redactMedusaText", () => {
  it("removes a pk_ token and a database URL from a log tail", () => {
    const token = `pk_${"b".repeat(64)}`;
    const text = `ready token=${token} db=postgres://medusa:medusa@127.0.0.1:5433/medusa`;
    const redacted = redactMedusaText(text);
    assert.equal(redacted.includes(token), false);
    assert.equal(redacted.includes("medusa:medusa"), false);
    assert.equal(redacted.includes("(redacted)"), true);
    assert.equal(redacted.includes("postgres://(redacted)"), true);
  });
});

describe("assertMedusaBackendPresent", () => {
  it("names the missing medusa-config.ts path", () => {
    const root = "D:\\products\\medusa";
    assert.throws(
      () => assertMedusaBackendPresent(root, () => false),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(medusaBackendConfigPath(root)), true);
        assert.equal(error.message.includes("medusa-dtc-starter"), true);
        return true;
      },
    );
  });
});

describe("medusaBackendStartArgs", () => {
  it("uses medusa start in production and medusa develop otherwise", () => {
    assert.deepEqual(medusaBackendStartArgs("production"), ["medusa", "start"]);
    assert.deepEqual(medusaBackendStartArgs("develop"), ["medusa", "develop"]);
  });
});

describe("parseMedusaHarnessBuildGitSha", () => {
  it("reads gitSha from harness-build.json text", () => {
    const sha = "f677db438f27294fc50e4c7c6612e71ff38eeff5";
    assert.equal(parseMedusaHarnessBuildGitSha(serializeMedusaHarnessBuildRecord(sha)), sha);
    assert.equal(parseMedusaHarnessBuildGitSha("{}\n"), undefined);
    assert.equal(parseMedusaHarnessBuildGitSha("not-json"), undefined);
  });
});

describe("decideMedusaBuildSkip", () => {
  const head = "abc123def456";
  const marker = serializeMedusaHarnessBuildRecord(head);

  it("skips when the built server and harness-build.json match HEAD", () => {
    assert.deepEqual(
      decideMedusaBuildSkip({
        httpMode: "production",
        forceRebuild: false,
        builtServerPackageExists: true,
        markerFileText: marker,
        headGitSha: head,
      }),
      { skip: true, reason: "skip_matches_head" },
    );
  });

  it("rebuilds when output, marker, or HEAD disagree", () => {
    assert.equal(
      decideMedusaBuildSkip({
        httpMode: "production",
        forceRebuild: false,
        builtServerPackageExists: false,
        markerFileText: marker,
        headGitSha: head,
      }).reason,
      "rebuild_missing_output",
    );
    assert.equal(
      decideMedusaBuildSkip({
        httpMode: "production",
        forceRebuild: false,
        builtServerPackageExists: true,
        markerFileText: undefined,
        headGitSha: head,
      }).reason,
      "rebuild_missing_marker",
    );
    assert.equal(
      decideMedusaBuildSkip({
        httpMode: "production",
        forceRebuild: false,
        builtServerPackageExists: true,
        markerFileText: marker,
        headGitSha: "other-sha",
      }).reason,
      "rebuild_sha_mismatch",
    );
    assert.equal(
      decideMedusaBuildSkip({
        httpMode: "production",
        forceRebuild: true,
        builtServerPackageExists: true,
        markerFileText: marker,
        headGitSha: head,
      }).reason,
      "rebuild_forced",
    );
  });

  it("places harness-build.json under .medusa/server", () => {
    const backend = "D:\\products\\medusa-dtc-starter\\apps\\backend";
    assert.equal(
      medusaHarnessBuildMarkerPath(backend),
      "D:\\products\\medusa-dtc-starter\\apps\\backend\\.medusa\\server\\harness-build.json",
    );
  });
});
