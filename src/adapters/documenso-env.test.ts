import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDocumensoNodeVersion,
  buildDocumensoAppEnv,
  classifyDocumensoProbe,
  documensoHealthUrls,
  documensoListen,
  isDocumensoHealthyStatus,
  localhostTwin,
  parseNetstatListeningPids,
  parseTasklistImageName,
} from "./documenso-env.js";

const cfg = { baseUrl: "http://127.0.0.1:3001", dbUrl: "postgres://documenso:password@127.0.0.1:5451/documenso" };

describe("documensoListen", () => {
  it("accepts 127.0.0.1 and defaults the port to 3001", () => {
    assert.deepEqual(documensoListen("http://127.0.0.1"), { host: "127.0.0.1", port: "3001" });
    assert.deepEqual(documensoListen("http://127.0.0.1:3001"), { host: "127.0.0.1", port: "3001" });
  });

  it("rejects localhost so an IPv6-only bind cannot pass silently", () => {
    assert.throws(() => documensoListen("http://localhost:3001"), /must use 127\.0\.0\.1/);
  });
});

describe("localhostTwin", () => {
  it("swaps 127.0.0.1 for localhost for the diagnostic probe only", () => {
    assert.equal(localhostTwin("http://127.0.0.1:3001"), "http://localhost:3001");
  });
});

describe("documensoHealthUrls", () => {
  it("probes the login page and the CSRF route, without a trailing slash", () => {
    assert.deepEqual(documensoHealthUrls("http://127.0.0.1:3001/"), {
      signin: "http://127.0.0.1:3001/signin",
      csrf: "http://127.0.0.1:3001/api/auth/csrf",
    });
  });
});

describe("isDocumensoHealthyStatus", () => {
  it("counts only HTTP 200 as healthy", () => {
    assert.equal(isDocumensoHealthyStatus(200), true);
    assert.equal(isDocumensoHealthyStatus(302), false);
    assert.equal(isDocumensoHealthyStatus(404), false);
    assert.equal(isDocumensoHealthyStatus(500), false);
  });
});

describe("buildDocumensoAppEnv", () => {
  const env = buildDocumensoAppEnv(cfg);

  it("uses the stock placeholder secrets, not random values", () => {
    assert.equal(env.NEXTAUTH_SECRET, "secret");
    assert.equal(env.NEXT_PRIVATE_ENCRYPTION_KEY, "CAFEBABE");
    assert.equal(env.NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY, "DEADBEEF");
    assert.equal(env.NEXT_PRIVATE_SMTP_PASSWORD, "password");
  });

  it("points the app, port, and DB at the harness-owned services", () => {
    assert.equal(env.NEXT_PUBLIC_WEBAPP_URL, "http://127.0.0.1:3001");
    assert.equal(env.NEXT_PRIVATE_INTERNAL_WEBAPP_URL, "http://127.0.0.1:3001");
    assert.equal(env.PORT, "3001");
    assert.equal(env.NEXT_PRIVATE_DATABASE_URL, cfg.dbUrl);
    assert.equal(env.NEXT_PRIVATE_DIRECT_DATABASE_URL, cfg.dbUrl);
    assert.equal(env.NEXT_PRIVATE_SMTP_HOST, "127.0.0.1");
    assert.equal(env.NEXT_PRIVATE_SMTP_PORT, "2525");
  });

  it("keeps uploads on the database and jobs local (no MinIO or Redis)", () => {
    assert.equal(env.NEXT_PUBLIC_UPLOAD_TRANSPORT, "database");
    assert.equal(env.NEXT_PRIVATE_JOBS_PROVIDER, "local");
  });
});

describe("assertDocumensoNodeVersion", () => {
  it("accepts Node 24 and newer", () => {
    assert.doesNotThrow(() => assertDocumensoNodeVersion("24.0.0"));
    assert.doesNotThrow(() => assertDocumensoNodeVersion("25.1.0"));
  });

  it("stops Node 22 with the Node 24 instruction", () => {
    assert.throws(
      () => assertDocumensoNodeVersion("22.20.0"),
      /Documenso needs Node 24 or newer; active Node is v22\.20\.0\. Run nvm use 24/,
    );
  });

  it("fails malformed versions", () => {
    assert.throws(() => assertDocumensoNodeVersion("not-a-version"), /needs Node 24 or newer/);
  });
});

describe("classifyDocumensoProbe", () => {
  it("passes only when 127.0.0.1 is healthy", () => {
    assert.equal(classifyDocumensoProbe(true, false), "healthy");
    assert.equal(classifyDocumensoProbe(true, true), "healthy");
  });

  it("flags localhost-only answers as an environment finding, never healthy", () => {
    assert.equal(classifyDocumensoProbe(false, true), "environment");
  });

  it("reports unhealthy when neither address answers", () => {
    assert.equal(classifyDocumensoProbe(false, false), "unhealthy");
  });
});

describe("parseNetstatListeningPids", () => {
  const netstat = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       4242",
    "  TCP    [::1]:3001             [::]:0                 LISTENING       4242",
    "  TCP    127.0.0.1:13001        0.0.0.0:0              LISTENING       9999",
    "  TCP    127.0.0.1:3001         127.0.0.1:55555        ESTABLISHED     7777",
    "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       1111",
  ].join("\r\n");

  it("returns only LISTENING owners of the exact port", () => {
    assert.deepEqual(parseNetstatListeningPids(netstat, "3001"), [4242]);
  });

  it("returns nothing when the port is free", () => {
    assert.deepEqual(parseNetstatListeningPids(netstat, "3005"), []);
  });
});

describe("parseTasklistImageName", () => {
  it("reads the executable name from tasklist output", () => {
    assert.equal(parseTasklistImageName("node.exe                      4242 Console                    1    90,000 K\r\n"), "node.exe");
  });

  it("returns undefined when no task matches", () => {
    assert.equal(parseTasklistImageName("INFO: No tasks are running which match the specified criteria."), undefined);
  });
});
