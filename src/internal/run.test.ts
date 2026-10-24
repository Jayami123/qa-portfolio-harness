import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { redactSecrets, runCapture } from "./run.js";

const SECRET = "pw-secret-7f3a";
const cwd = process.cwd();

describe("runCapture redactLine redaction", () => {
  // A runner process calls runCapture and prints what it passes through, so the test runner's own stdout is never touched.
  // The child scripts take no spaces: on Windows runCapture joins the arguments into a shell command line.
  function printedByRunner(childScript: string, mode: "pass" | "hold"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-redact-"));
    const runner = path.join(dir, "runner.mjs");
    const runCaptureUrl = new URL("./run.js", import.meta.url).href;
    fs.writeFileSync(
      runner,
      `import { runCapture } from ${JSON.stringify(runCaptureUrl)};
const [secret, mode, script] = process.argv.slice(2);
const passThrough = (chunk, carry) => ({ text: chunk, carry });
const holdLastLine = (chunk, carry) => {
  const joined = carry + chunk;
  const cut = joined.lastIndexOf("\\n") + 1;
  return { text: joined.slice(0, cut), carry: joined.slice(cut) };
};
await runCapture("node", ["-e", script, secret], {
  cwd: process.cwd(),
  redact: [secret],
  redactLine: mode === "hold" ? holdLastLine : passThrough,
});
`,
    );
    try {
      const result = spawnSync(process.execPath, [runner, SECRET, mode, childScript], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("redacts the secret in a line that redactLine passes through", () => {
    const printed = printedByRunner("console.log(process.argv[1])", "pass");
    assert.equal(printed, "***\n");
  });

  it("redacts a last line without a newline when the exit flush prints it", () => {
    const printed = printedByRunner("process.stdout.write(process.argv[1])", "hold");
    assert.equal(printed, "***");
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence with ***", () => {
    assert.equal(
      redactSecrets(`a ${SECRET} b ${SECRET}`, [SECRET]),
      "a *** b ***",
    );
  });

  it("ignores empty secrets and leaves text without secrets alone", () => {
    assert.equal(redactSecrets("plain text", ["", SECRET]), "plain text");
    assert.equal(redactSecrets("plain text"), "plain text");
  });
});

describe("runCapture redaction", () => {
  it("keeps the password out of the exit error message and captured output", async () => {
    const error = await runCapture(
      "node",
      ["-e", "process.stdout.write(process.argv[1]);process.exit(3)", SECRET],
      { cwd, redact: [SECRET] },
    ).then(
      () => assert.fail("expected a non-zero exit"),
      (err: Error & { stdout: string; stderr: string }) => err,
    );

    assert.match(error.message, /exited with code 3/);
    assert.equal(error.message.includes(SECRET), false);
    assert.match(error.message, /\*\*\*/);
    assert.equal(error.stdout.includes(SECRET), false);
    assert.equal(error.stdout, "***");
  });

  it("keeps the password out of the timeout error message", async () => {
    const error = await runCapture(
      "node",
      ["-e", "setTimeout(Function,5000)", SECRET],
      {
        cwd,
        timeoutMs: 200,
        redact: [SECRET],
      },
    ).then(
      () => assert.fail("expected a timeout"),
      (err: Error) => err,
    );

    assert.match(error.message, /timed out after 200ms/);
    assert.equal(error.message.includes(SECRET), false);
  });

  it("leaves messages unredacted when no redact list is given", async () => {
    const error = await runCapture("node", ["-e", "process.exit(4)", SECRET], {
      cwd,
    }).then(
      () => assert.fail("expected a non-zero exit"),
      (err: Error) => err,
    );

    assert.equal(error.message.includes(SECRET), true);
  });
});
