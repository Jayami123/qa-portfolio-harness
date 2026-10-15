import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets, runCapture } from "./run.js";

const SECRET = "pw-secret-7f3a";
const cwd = process.cwd();

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
