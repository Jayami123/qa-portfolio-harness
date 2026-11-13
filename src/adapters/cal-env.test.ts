import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAL_DB_VOLUME,
  calDownArgs,
  calUpPrelude,
  classifyCalEnvValue,
  ensureCalRootEnv,
  rewriteLocalhostToLoopback,
  type CalEnvFs,
} from "./cal-env.js";

const ROOT = "/r";
const ENV_PATH = "/r/.env";
const EXAMPLE_PATH = "/r/.env.example";
const EXAMPLE = [
  "APP_URL=http://localhost:3000",
  "NEXTAUTH_URL=http://localhost:3000",
  "NEXTAUTH_SECRET=",
  "CALENDSO_ENCRYPTION_KEY=",
  "DATABASE_URL=postgresql://calendso@127.0.0.1:5450/calendso",
  "",
].join("\n");

interface FakeFs extends CalEnvFs {
  readonly calls: string[];
  readonly files: Map<string, string>;
}

/** The temp path the writer uses beside .env (pid-suffixed, as in cal-env.ts). */
const TMP_PATH = `${ENV_PATH}.harness-tmp-${process.pid}`;

function fakeFs(initial: Record<string, string>, opts: { renameFails?: boolean } = {}): FakeFs {
  const files = new Map<string, string>(Object.entries(initial));
  const calls: string[] = [];
  return {
    calls,
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const text = files.get(p);
      if (text === undefined) {
        throw new Error(`no such file in fake fs: ${p}`);
      }
      return text;
    },
    writeFileSync: (p, data, o) => {
      calls.push(`write ${p} mode ${o.mode.toString(8)} flag ${o.flag ?? "w"}`);
      if (o.flag === "wx" && files.has(p)) {
        throw new Error(`EEXIST: ${p}`);
      }
      files.set(p, data);
    },
    copyFileSync: () => {
      calls.push("copy");
    },
    chmodSync: (p, mode) => {
      calls.push(`chmod ${p} ${mode.toString(8)}`);
    },
    renameSync: (from, to) => {
      calls.push(`rename ${from} ${to}`);
      if (opts.renameFails) {
        throw new Error("EXDEV: simulated rename failure");
      }
      const text = files.get(from);
      if (text === undefined) {
        throw new Error(`rename: no such file ${from}`);
      }
      files.delete(from);
      files.set(to, text);
    },
    rmSync: (p, o) => {
      calls.push(`rm ${p} force ${o.force}`);
      files.delete(p);
    },
  };
}

/** A fixed byte source: the value is a run of the same byte, so the decoded length is the requested size. */
const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 7);
const generatedValue = (size: number): string => fixedRandom(size).toString("base64");

function valueOf(text: string, key: string): string | undefined {
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

const volumeAbsent = () => false;
const volumePresent = () => true;

describe("classifyCalEnvValue", () => {
  it("treats absent, empty, quoted-empty and whitespace-only values as missing or placeholder", () => {
    assert.equal(classifyCalEnvValue(undefined), "missing");
    assert.equal(classifyCalEnvValue(""), "placeholder");
    assert.equal(classifyCalEnvValue("   "), "placeholder");
    assert.equal(classifyCalEnvValue('""'), "placeholder");
    assert.equal(classifyCalEnvValue("''"), "placeholder");
    assert.equal(classifyCalEnvValue("abc"), "real");
  });
});

describe("rewriteLocalhostToLoopback", () => {
  it("rewrites every http://localhost:3000 and leaves other hosts alone", () => {
    assert.equal(
      rewriteLocalhostToLoopback("a=http://localhost:3000 b=http://localhost:3000/x c=http://localhost:9000"),
      "a=http://127.0.0.1:3000 b=http://127.0.0.1:3000/x c=http://localhost:9000",
    );
  });
});

describe("ensureCalRootEnv", () => {
  it("creates a missing file from the example, rewrites localhost, generates both keys, writes mode 600 then chmods 600", () => {
    const fs = fakeFs({ [EXAMPLE_PATH]: EXAMPLE });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.equal(result.createdFromExample, true);
    assert.deepEqual([...result.generated], ["NEXTAUTH_SECRET", "CALENDSO_ENCRYPTION_KEY"]);
    assert.deepEqual(fs.calls, [
      `write ${TMP_PATH} mode 600 flag wx`,
      `chmod ${TMP_PATH} 600`,
      `rename ${TMP_PATH} ${ENV_PATH}`,
    ]);
    assert.equal(fs.calls.includes(`write ${ENV_PATH} mode 600 flag w`), false);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(text.includes("localhost"), false);
    assert.equal(valueOf(text, "APP_URL"), "http://127.0.0.1:3000");
    assert.equal(valueOf(text, "NEXTAUTH_URL"), "http://127.0.0.1:3000");
  });

  it("replaces placeholder keys in an existing file", () => {
    const fs = fakeFs({ [ENV_PATH]: EXAMPLE });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.equal(result.createdFromExample, false);
    assert.deepEqual([...result.generated], ["NEXTAUTH_SECRET", "CALENDSO_ENCRYPTION_KEY"]);
    assert.deepEqual(fs.calls, [
      `write ${TMP_PATH} mode 600 flag wx`,
      `chmod ${TMP_PATH} 600`,
      `rename ${TMP_PATH} ${ENV_PATH}`,
    ]);
    assert.equal(fs.files.has(TMP_PATH), false);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(valueOf(text, "NEXTAUTH_SECRET"), generatedValue(32));
    assert.equal(valueOf(text, "CALENDSO_ENCRYPTION_KEY"), generatedValue(24));
  });

  it("removes the temp file and rethrows when the rename fails, leaving .env unchanged", () => {
    const fs = fakeFs({ [ENV_PATH]: EXAMPLE }, { renameFails: true });
    assert.throws(
      () => ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent }),
      /EXDEV/,
    );
    assert.deepEqual(fs.calls, [
      `write ${TMP_PATH} mode 600 flag wx`,
      `chmod ${TMP_PATH} 600`,
      `rename ${TMP_PATH} ${ENV_PATH}`,
      `rm ${TMP_PATH} force true`,
    ]);
    assert.equal(fs.files.has(TMP_PATH), false);
    assert.equal(fs.files.get(ENV_PATH), EXAMPLE);
  });

  it("does not write at all when both keys are real", () => {
    const fs = fakeFs({
      [ENV_PATH]: "NEXTAUTH_SECRET=real-secret\nCALENDSO_ENCRYPTION_KEY=real-key\nEMAIL_SERVER_HOST=smtp.example.test\nEMAIL_SERVER_PORT=587\n",
    });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.deepEqual(fs.calls, []);
    assert.deepEqual([...result.generated], []);
    assert.equal(result.createdFromExample, false);
    assert.equal(result.smtpRouted, false);
  });

  it("replaces only the placeholder when one key is real and one is a placeholder", () => {
    const fs = fakeFs({ [ENV_PATH]: "NEXTAUTH_SECRET=keep-me\nCALENDSO_ENCRYPTION_KEY=\n" });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.deepEqual([...result.generated], ["CALENDSO_ENCRYPTION_KEY"]);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(valueOf(text, "NEXTAUTH_SECRET"), "keep-me");
    assert.equal(valueOf(text, "CALENDSO_ENCRYPTION_KEY"), generatedValue(24));
  });

  it("does not rewrite a localhost line in an existing file", () => {
    const fs = fakeFs({ [ENV_PATH]: "APP_URL=http://localhost:3000\nNEXTAUTH_SECRET=\nCALENDSO_ENCRYPTION_KEY=\n" });
    ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.equal(valueOf(fs.files.get(ENV_PATH) ?? "", "APP_URL"), "http://localhost:3000");
  });

  it("generates values that decode to 32 bytes (NEXTAUTH_SECRET) and 24 bytes (CALENDSO_ENCRYPTION_KEY)", () => {
    const fs = fakeFs({ [EXAMPLE_PATH]: EXAMPLE });
    ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(Buffer.from(valueOf(text, "NEXTAUTH_SECRET") ?? "", "base64").length, 32);
    assert.equal(Buffer.from(valueOf(text, "CALENDSO_ENCRYPTION_KEY") ?? "", "base64").length, 24);
  });

  it("refuses a new encryption key over an existing volume, before any write (missing file)", () => {
    const fs = fakeFs({ [EXAMPLE_PATH]: EXAMPLE });
    assert.throws(
      () => ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent }),
      /CAL_ENCRYPTION_KEY_VOLUME_EXISTS/,
    );
    assert.deepEqual(fs.calls, []);
    assert.equal(fs.files.has(ENV_PATH), false);
  });

  it("refuses a new encryption key over an existing volume, before any write (placeholder key)", () => {
    const fs = fakeFs({ [ENV_PATH]: "NEXTAUTH_SECRET=keep\nCALENDSO_ENCRYPTION_KEY=\n" });
    assert.throws(
      () => ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent }),
      /CAL_ENCRYPTION_KEY_VOLUME_EXISTS/,
    );
    assert.deepEqual(fs.calls, []);
    assert.equal(fs.files.get(ENV_PATH), "NEXTAUTH_SECRET=keep\nCALENDSO_ENCRYPTION_KEY=\n");
  });

  it("does not refuse when only NEXTAUTH_SECRET is generated, even with the volume present", () => {
    const fs = fakeFs({ [ENV_PATH]: "NEXTAUTH_SECRET=\nCALENDSO_ENCRYPTION_KEY=real-key\n" });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.deepEqual([...result.generated], ["NEXTAUTH_SECRET"]);
    assert.equal(valueOf(fs.files.get(ENV_PATH) ?? "", "CALENDSO_ENCRYPTION_KEY"), "real-key");
  });

  it("never puts a generated value in an error message or in the result", () => {
    const secret = generatedValue(24);
    const fs = fakeFs({ [EXAMPLE_PATH]: EXAMPLE });
    let thrown: unknown;
    try {
      ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof Error);
    assert.equal(thrown.message.includes(secret), false);
    const ok = ensureCalRootEnv({ productRoot: ROOT, fs: fakeFs({ [EXAMPLE_PATH]: EXAMPLE }), randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.equal(JSON.stringify(ok).includes(secret), false);
    assert.equal(JSON.stringify(ok).includes(generatedValue(32)), false);
  });
});

describe("ensureCalRootEnv SMTP routing", () => {
  const SECRETS = "NEXTAUTH_SECRET=real-secret\nCALENDSO_ENCRYPTION_KEY=real-key\n";
  const hostLines = (text: string) => text.split("\n").filter((l) => l.startsWith("EMAIL_SERVER_HOST=")).length;

  it("routes missing EMAIL keys to the harness catcher without touching a real secret", () => {
    const fs = fakeFs({ [ENV_PATH]: SECRETS });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.equal(result.smtpRouted, true);
    assert.deepEqual([...result.generated], []);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(valueOf(text, "EMAIL_SERVER_HOST"), "127.0.0.1");
    assert.equal(valueOf(text, "EMAIL_SERVER_PORT"), "1026");
    assert.equal(valueOf(text, "NEXTAUTH_SECRET"), "real-secret");
  });

  it("routes the fork's quoted example defaults and leaves one line per key", () => {
    const fs = fakeFs({ [ENV_PATH]: `${SECRETS}EMAIL_SERVER_HOST='localhost'\nEMAIL_SERVER_PORT=1025\n` });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.equal(result.smtpRouted, true);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(hostLines(text), 1);
    assert.equal(valueOf(text, "EMAIL_SERVER_HOST"), "127.0.0.1");
    assert.equal(valueOf(text, "EMAIL_SERVER_PORT"), "1026");
  });

  it("routes the SMTP lines of a file created from the example", () => {
    const fs = fakeFs({ [EXAMPLE_PATH]: `${EXAMPLE}EMAIL_SERVER_HOST='localhost'\nEMAIL_SERVER_PORT=1025\n` });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.equal(result.createdFromExample, true);
    assert.equal(result.smtpRouted, true);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(hostLines(text), 1);
    assert.equal(valueOf(text, "EMAIL_SERVER_PORT"), "1026");
  });

  it("treats an empty host as unset and routes when the port is the example default", () => {
    const fs = fakeFs({ [ENV_PATH]: `${SECRETS}EMAIL_SERVER_HOST=\nEMAIL_SERVER_PORT=1025\n` });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.equal(result.smtpRouted, true);
    assert.equal(valueOf(fs.files.get(ENV_PATH) ?? "", "EMAIL_SERVER_HOST"), "127.0.0.1");
  });

  it("never overwrites a real host, even when the port is the example default", () => {
    const before = `${SECRETS}EMAIL_SERVER_HOST=smtp.example.test\nEMAIL_SERVER_PORT=1025\n`;
    const fs = fakeFs({ [ENV_PATH]: before });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.equal(result.smtpRouted, false);
    assert.deepEqual(fs.calls, []);
    assert.equal(fs.files.get(ENV_PATH), before);
  });

  it("never overwrites a real port, even when the host is the example default", () => {
    const before = `${SECRETS}EMAIL_SERVER_HOST=localhost\nEMAIL_SERVER_PORT=2525\n`;
    const fs = fakeFs({ [ENV_PATH]: before });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    assert.equal(result.smtpRouted, false);
    assert.deepEqual(fs.calls, []);
    assert.equal(fs.files.get(ENV_PATH), before);
  });

  it("writes a generated secret and leaves a real SMTP pair alone", () => {
    const fs = fakeFs({ [ENV_PATH]: "NEXTAUTH_SECRET=\nCALENDSO_ENCRYPTION_KEY=real-key\nEMAIL_SERVER_HOST=smtp.example.test\nEMAIL_SERVER_PORT=587\n" });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumeAbsent });
    assert.deepEqual([...result.generated], ["NEXTAUTH_SECRET"]);
    assert.equal(result.smtpRouted, false);
    const text = fs.files.get(ENV_PATH) ?? "";
    assert.equal(valueOf(text, "EMAIL_SERVER_HOST"), "smtp.example.test");
    assert.equal(valueOf(text, "EMAIL_SERVER_PORT"), "587");
  });

  it("never returns an SMTP value in the result", () => {
    const fs = fakeFs({ [ENV_PATH]: SECRETS });
    const result = ensureCalRootEnv({ productRoot: ROOT, fs, randomBytes: fixedRandom, calDbVolumeExists: volumePresent });
    const shown = JSON.stringify(result);
    assert.equal(shown.includes("127.0.0.1"), false);
    assert.equal(shown.includes("1026"), false);
  });
});

describe("calDownArgs", () => {
  it("returns -v only when CAL_DOWN_VOLUMES is exactly 1", () => {
    assert.deepEqual([...calDownArgs({ CAL_DOWN_VOLUMES: "1" })], ["-v"]);
    assert.deepEqual([...calDownArgs({})], []);
    assert.deepEqual([...calDownArgs({ CAL_DOWN_VOLUMES: "" })], []);
    assert.deepEqual([...calDownArgs({ CAL_DOWN_VOLUMES: "0" })], []);
    assert.deepEqual([...calDownArgs({ CAL_DOWN_VOLUMES: "true" })], []);
  });
});

describe("calUpPrelude", () => {
  it("runs the writer before compose up", async () => {
    const order: string[] = [];
    await calUpPrelude({
      ensureEnv: () => {
        order.push("ensureEnv");
      },
      composeUp: async () => {
        order.push("composeUp");
      },
    });
    assert.deepEqual(order, ["ensureEnv", "composeUp"]);
  });

  it("does not run compose up when the writer throws", async () => {
    const order: string[] = [];
    await assert.rejects(
      calUpPrelude({
        ensureEnv: () => {
          order.push("ensureEnv");
          throw new Error("CAL_ENCRYPTION_KEY_VOLUME_EXISTS");
        },
        composeUp: async () => {
          order.push("composeUp");
        },
      }),
      /CAL_ENCRYPTION_KEY_VOLUME_EXISTS/,
    );
    assert.deepEqual(order, ["ensureEnv"]);
  });
});

describe("CAL_DB_VOLUME", () => {
  it("is the compose name of the Cal database volume", () => {
    assert.equal(CAL_DB_VOLUME, "qa-harness-cal_db_data");
  });
});
