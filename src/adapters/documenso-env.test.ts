import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertDocumensoNodeVersion,
  assertDocumensoPublicHostResolvesToLoopback,
  assertDocumensoSigningCert,
  buildDocumensoAppEnv,
  documensoLocalSigningCertPath,
  classifyDocumensoProbe,
  documensoHealthUrls,
  documensoListen,
  isDocumensoHealthyStatus,
  localhostTwin,
  parseDocumensoPublicUrl,
  parseDocumensoRunningWebappUrl,
  parseNetstatListeningPids,
  parseTasklistImageName,
  runningWebappUrlMatches,
} from "./documenso-env.js";

const productRoot = path.resolve("products", "documenso");
const cfg = {
  baseUrl: "http://127.0.0.1:3001",
  dbUrl: "postgres://documenso:password@127.0.0.1:5451/documenso",
  productRoot,
};

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

  it("points local signing at the fork example cert with an empty passphrase", () => {
    assert.equal(env.NEXT_PRIVATE_SIGNING_TRANSPORT, "local");
    assert.equal(env.NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH, documensoLocalSigningCertPath(productRoot));
    assert.equal(path.isAbsolute(env.NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH), true);
    assert.equal(env.NEXT_PRIVATE_SIGNING_PASSPHRASE, "");
  });

  it("when publicUrl is unset, public and internal webapp URLs stay on the listen address", () => {
    const unset = buildDocumensoAppEnv(cfg);
    assert.equal(unset.NEXT_PUBLIC_WEBAPP_URL, "http://127.0.0.1:3001");
    assert.equal(unset.NEXT_PRIVATE_INTERNAL_WEBAPP_URL, "http://127.0.0.1:3001");
    assert.equal(unset.PORT, "3001");
  });

  it("when publicUrl is set, only NEXT_PUBLIC_WEBAPP_URL follows it", () => {
    const set = buildDocumensoAppEnv({ ...cfg, publicUrl: "http://p1.lvh.me:3001" });
    assert.equal(set.NEXT_PUBLIC_WEBAPP_URL, "http://p1.lvh.me:3001");
    assert.equal(set.NEXT_PRIVATE_INTERNAL_WEBAPP_URL, "http://127.0.0.1:3001");
    assert.equal(set.PORT, "3001");
  });

  it("adds DANGEROUS_BYPASS_RATE_LIMITS only when process env is exactly true", () => {
    const prev = process.env.DANGEROUS_BYPASS_RATE_LIMITS;
    try {
      delete process.env.DANGEROUS_BYPASS_RATE_LIMITS;
      assert.equal(buildDocumensoAppEnv(cfg).DANGEROUS_BYPASS_RATE_LIMITS, undefined);

      process.env.DANGEROUS_BYPASS_RATE_LIMITS = "1";
      assert.equal(buildDocumensoAppEnv(cfg).DANGEROUS_BYPASS_RATE_LIMITS, undefined);

      process.env.DANGEROUS_BYPASS_RATE_LIMITS = "true";
      assert.equal(buildDocumensoAppEnv(cfg).DANGEROUS_BYPASS_RATE_LIMITS, "true");
    } finally {
      if (prev === undefined) {
        delete process.env.DANGEROUS_BYPASS_RATE_LIMITS;
      } else {
        process.env.DANGEROUS_BYPASS_RATE_LIMITS = prev;
      }
    }
  });
});

describe("documensoLocalSigningCertPath", () => {
  it("resolves an absolute path under apps/remix/example/cert.p12", () => {
    const certPath = documensoLocalSigningCertPath(productRoot);
    assert.equal(certPath, path.resolve(productRoot, "apps", "remix", "example", "cert.p12"));
    assert.equal(path.isAbsolute(certPath), true);
  });
});

describe("assertDocumensoSigningCert", () => {
  it("passes when the injected exists check finds the cert", () => {
    assert.doesNotThrow(() => assertDocumensoSigningCert(productRoot, () => true));
  });

  it("names the missing path and tells the user to run npm ci", () => {
    const certPath = documensoLocalSigningCertPath(productRoot);
    assert.throws(
      () => assertDocumensoSigningCert(productRoot, () => false),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(certPath));
        assert.match(error.message, /Run npm ci in the Documenso fork/);
        return true;
      },
    );
  });
});

describe("parseDocumensoPublicUrl", () => {
  it("accepts an origin URL and returns scheme, host, and port only", () => {
    assert.equal(parseDocumensoPublicUrl("http://p1.lvh.me:3001/", "3001"), "http://p1.lvh.me:3001");
    assert.equal(parseDocumensoPublicUrl("http://p1.lvh.me:3001", "3001"), "http://p1.lvh.me:3001");
  });

  it("rejects localhost", () => {
    assert.throws(
      () => parseDocumensoPublicUrl("http://localhost:3001", "3001"),
      /hostname must not be localhost or an IP \(got localhost\)/,
    );
  });

  it("rejects IPv4 and IPv6 addresses", () => {
    assert.throws(
      () => parseDocumensoPublicUrl("http://127.0.0.1:3001", "3001"),
      /hostname must not be localhost or an IP \(got 127\.0\.0\.1\)/,
    );
    assert.throws(
      () => parseDocumensoPublicUrl("http://[::1]:3001", "3001"),
      /hostname must not be localhost or an IP \(got ::1\)/,
    );
  });

  it("rejects a port that does not match the listen port", () => {
    assert.throws(
      () => parseDocumensoPublicUrl("http://p1.lvh.me:3000", "3001"),
      /port must match DOCUMENSO_BASE_URL listen port 3001 \(got 3000\)/,
    );
  });

  it("rejects a path, query, hash, or credentials", () => {
    const example = /Example: http:\/\/p1\.lvh\.me:3001/;
    assert.throws(() => parseDocumensoPublicUrl("http://p1.lvh.me:3001/app", "3001"), example);
    assert.throws(() => parseDocumensoPublicUrl("http://p1.lvh.me:3001?x=1", "3001"), example);
    assert.throws(() => parseDocumensoPublicUrl("http://p1.lvh.me:3001#h", "3001"), example);
    assert.throws(() => parseDocumensoPublicUrl("http://u:p@p1.lvh.me:3001", "3001"), example);
  });
});

describe("assertDocumensoPublicHostResolvesToLoopback", () => {
  it("passes when the injected lookup returns 127.0.0.1", async () => {
    await assert.doesNotReject(() =>
      assertDocumensoPublicHostResolvesToLoopback("p1.lvh.me", async () => ({ address: "127.0.0.1" })),
    );
  });

  it("rejects any other IPv4 address and names the hosts-file line", async () => {
    await assert.rejects(
      () => assertDocumensoPublicHostResolvesToLoopback("p1.lvh.me", async () => ({ address: "8.8.8.8" })),
      /does not resolve to 127\.0\.0\.1 \(got 8\.8\.8\.8\)[\s\S]*127\.0\.0\.1 p1\.lvh\.me/,
    );
  });

  it("rejects ENOTFOUND with the hosts-file instruction", async () => {
    await assert.rejects(
      () =>
        assertDocumensoPublicHostResolvesToLoopback("p1.lvh.me", async () => {
          throw new Error("getaddrinfo ENOTFOUND p1.lvh.me");
        }),
      /does not resolve to 127\.0\.0\.1 \(getaddrinfo ENOTFOUND p1\.lvh\.me\)[\s\S]*Linux\/macOS: \/etc\/hosts/,
    );
  });
});

describe("parseDocumensoRunningWebappUrl", () => {
  const envScript = (webappUrl: string) =>
    `<html><script>window.__ENV__ = ${JSON.stringify({ NEXT_PUBLIC_WEBAPP_URL: webappUrl, NEXT_PUBLIC_UPLOAD_TRANSPORT: "database" })}; window.__webpack_nonce__ = "abc"</script></html>`;

  it("reads a matching public URL from window.__ENV__", () => {
    const html = envScript("http://p1.lvh.me:3001");
    assert.equal(parseDocumensoRunningWebappUrl(html), "http://p1.lvh.me:3001");
    assert.equal(runningWebappUrlMatches(html, "http://p1.lvh.me:3001/"), true);
  });

  it("treats a stale 127.0.0.1 webapp URL as a mismatch", () => {
    const html = envScript("http://127.0.0.1:3001");
    assert.equal(parseDocumensoRunningWebappUrl(html), "http://127.0.0.1:3001");
    assert.equal(runningWebappUrlMatches(html, "http://p1.lvh.me:3001"), false);
  });

  it("returns undefined when the __ENV__ script is missing", () => {
    assert.equal(parseDocumensoRunningWebappUrl("<html><body>signin</body></html>"), undefined);
    assert.equal(runningWebappUrlMatches("<html></html>", "http://p1.lvh.me:3001"), false);
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
