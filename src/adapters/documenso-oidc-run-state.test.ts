import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DOCUMENSO_OIDC_NOT_ENABLED,
  DOCUMENSO_OIDC_RUN_STATE_INVALID,
  DOCUMENSO_OIDC_RUN_STATE_MISSING,
  documensoOidcRunStateFile,
  documensoOidcTestUsers,
  removeDocumensoOidcRunState,
  writeDocumensoOidcRunState,
  type DocumensoOidcRunState,
} from "./documenso-oidc-run-state.js";
import { HARNESS_ROOT } from "../paths.js";

const SENTINEL = {
  secret: "SENTINEL-client-secret-7f3a9c",
  pwVerified: "SENTINEL-pw-verified-2b8d1e",
  pwUnverified: "SENTINEL-pw-unverified-9c4f02",
};
const ON = { DOCUMENSO_OIDC: "1" };
const OFF = {};

function state(): DocumensoOidcRunState {
  return {
    version: 1,
    clientId: "qa-documenso",
    clientSecret: SENTINEL.secret,
    redirectUri: "http://127.0.0.1:3001/api/auth/callback/oidc",
    users: {
      verified: { username: "verified", email: "verified@qa.test", emailVerified: true, password: SENTINEL.pwVerified },
      unverified: { username: "unverified", email: "unverified@qa.test", emailVerified: false, password: SENTINEL.pwUnverified },
    },
  };
}

/** Captures everything written to the console and the process streams during fn. */
function capture<T>(fn: () => T): { result: T; output: string } {
  const chunks: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const saved = methods.map((m) => console[m]);
  const savedOut = process.stdout.write.bind(process.stdout);
  const savedErr = process.stderr.write.bind(process.stderr);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      chunks.push(args.map(String).join(" "));
    };
  }
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { result, output: chunks.join("\n") };
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i] as (...args: unknown[]) => void));
    process.stdout.write = savedOut as typeof process.stdout.write;
    process.stderr.write = savedErr as typeof process.stderr.write;
  }
}

function expectNoValues(text: string): void {
  for (const v of Object.values(SENTINEL)) {
    assert.equal(text.includes(v), false, "a credential value appeared in output or an error message");
  }
}

const scratch = path.join(HARNESS_ROOT, ".harness", `test-run-state-${String(process.pid)}`);

describe("documensoOidcRunStateFile", () => {
  it("is under the harness runtime state directory, which is gitignored", () => {
    assert.equal(documensoOidcRunStateFile(HARNESS_ROOT), path.join(HARNESS_ROOT, ".harness", "documenso-oidc-run.json"));
    const gitignore = fs.readFileSync(path.join(HARNESS_ROOT, ".gitignore"), "utf8");
    assert.ok(gitignore.split("\n").some((l) => l.trim() === ".harness/"));
  });
});

describe("writer and remover", () => {
  before(() => fs.mkdirSync(scratch, { recursive: true }));
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("writes the state with mode 0600 and creates the directory", () => {
    const file = path.join(scratch, "fresh", "run.json");
    capture(() => writeDocumensoOidcRunState(file, state()));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), state());
  });

  it("tightens an existing file that was readable by others back to 0600", () => {
    const file = path.join(scratch, "loose.json");
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    capture(() => writeDocumensoOidcRunState(file, state()));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("removes the file on remove, and a second remove is not an error", () => {
    const file = path.join(scratch, "gone.json");
    writeDocumensoOidcRunState(file, state());
    capture(() => removeDocumensoOidcRunState(file));
    assert.equal(fs.existsSync(file), false);
    assert.doesNotThrow(() => capture(() => removeDocumensoOidcRunState(file)));
  });

  it("logs nothing and prints no value while writing and removing", () => {
    const file = path.join(scratch, "quiet.json");
    const { output: a } = capture(() => writeDocumensoOidcRunState(file, state()));
    const { output: b } = capture(() => removeDocumensoOidcRunState(file));
    assert.equal(a, "");
    assert.equal(b, "");
    expectNoValues(a + b);
  });
});

describe("documensoOidcTestUsers (reader)", () => {
  before(() => fs.mkdirSync(scratch, { recursive: true }));
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("throws DOCUMENSO_OIDC_NOT_ENABLED when the flag is unset, without reading the file", () => {
    const file = path.join(scratch, "not-read.json");
    writeDocumensoOidcRunState(file, state());
    assert.throws(() => documensoOidcTestUsers(OFF, file), (err: Error) => err.message.startsWith(DOCUMENSO_OIDC_NOT_ENABLED));
    removeDocumensoOidcRunState(file);
  });

  it("throws DOCUMENSO_OIDC_RUN_STATE_MISSING, naming the path and not a value, when the file is absent", () => {
    const file = path.join(scratch, "absent.json");
    assert.throws(
      () => documensoOidcTestUsers(ON, file),
      (err: Error) => err.message.startsWith(DOCUMENSO_OIDC_RUN_STATE_MISSING) && err.message.includes(file),
    );
  });

  it("throws DOCUMENSO_OIDC_RUN_STATE_INVALID on non-JSON content, without printing the content", () => {
    const file = path.join(scratch, "bad.json");
    fs.writeFileSync(file, `not json ${SENTINEL.pwVerified}`, { mode: 0o600 });
    const { output, result } = capture(() => {
      try {
        documensoOidcTestUsers(ON, file);
        return "no-throw";
      } catch (err) {
        return (err as Error).message;
      }
    });
    assert.ok(String(result).startsWith(DOCUMENSO_OIDC_RUN_STATE_INVALID));
    expectNoValues(String(result) + output);
  });

  it("throws DOCUMENSO_OIDC_RUN_STATE_INVALID when the shape is wrong (missing password, wrong client), without the content", () => {
    const file = path.join(scratch, "shape.json");
    const bad = { ...state(), clientId: "someone-else" };
    fs.writeFileSync(file, JSON.stringify(bad), { mode: 0o600 });
    let message = "";
    capture(() => {
      try {
        documensoOidcTestUsers(ON, file);
      } catch (err) {
        message = (err as Error).message;
      }
    });
    assert.ok(message.startsWith(DOCUMENSO_OIDC_RUN_STATE_INVALID));
    expectNoValues(message);
  });

  it("returns the two users' usernames and passwords, and nothing else", () => {
    const file = path.join(scratch, "ok.json");
    writeDocumensoOidcRunState(file, state());
    const users = capture(() => documensoOidcTestUsers(ON, file)).result;
    assert.deepEqual(users, {
      verified: { username: "verified", password: SENTINEL.pwVerified },
      unverified: { username: "unverified", password: SENTINEL.pwUnverified },
    });
    assert.deepEqual(Object.keys(users).sort(), ["unverified", "verified"]);
  });

  it("logs nothing while reading", () => {
    const file = path.join(scratch, "quiet-read.json");
    writeDocumensoOidcRunState(file, state());
    const { output } = capture(() => documensoOidcTestUsers(ON, file));
    assert.equal(output, "");
    expectNoValues(output);
  });
});

describe("no credential value in the adapter's log lines", () => {
  it("the OIDC console lines in documenso.adapter.ts never interpolate a secret, password or run value", () => {
    const src = fs.readFileSync(path.join(HARNESS_ROOT, "src", "adapters", "documenso.adapter.ts"), "utf8");
    const logLines = src.split("\n").filter((l) => /console\.(log|warn|error|info)\(/.test(l) && /oidc/i.test(l));
    assert.ok(logLines.length >= 2, "expected OIDC log lines to check");
    for (const line of logLines) {
      assert.equal(/clientSecret|Password|userPasswords|adminPassword|oidcRun/.test(line), false, `log line exposes a value: ${line.trim()}`);
    }
  });
});
