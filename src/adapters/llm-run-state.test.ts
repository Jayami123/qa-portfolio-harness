import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { P4_RUN_STATE_INVALID, P4_RUN_STATE_MISSING } from "./p4-run-state.js";
import { llmRunStateFile, readLlmRunState, writeLlmRunState } from "./llm-run-state.js";

const KEY = "sk-SHOULD_NOT_APPEAR_IN_ERRORS";

describe("llm run state (ADR 0007, D7)", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "llm-run-state-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("puts the state under .harness/<product>-run.json", () => {
    assert.equal(llmRunStateFile("litellm", root), path.join(root, ".harness", "litellm-run.json"));
  });

  it("writes mode 0600 and reads back the same state", () => {
    const file = llmRunStateFile("litellm", root);
    writeLlmRunState(file, { version: 1, product: "litellm", baseUrl: "http://127.0.0.1:4000/v1", apiKey: KEY });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readLlmRunState("litellm", file), {
      version: 1,
      product: "litellm",
      baseUrl: "http://127.0.0.1:4000/v1",
      apiKey: KEY,
    });
  });

  it("names a missing file without printing a value", () => {
    assert.throws(() => readLlmRunState("litellm", path.join(root, "absent.json")), (err: Error) => {
      assert.match(err.message, new RegExp(P4_RUN_STATE_MISSING));
      return true;
    });
  });

  it("rejects a file for another product or a non-URL base", () => {
    const file = path.join(root, "bad.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, product: "openclaw", baseUrl: "http://x/v1", apiKey: KEY }));
    assert.throws(() => readLlmRunState("litellm", file), new RegExp(P4_RUN_STATE_INVALID));
    fs.writeFileSync(file, JSON.stringify({ version: 1, product: "litellm", baseUrl: "ftp://x", apiKey: KEY }));
    assert.throws(() => readLlmRunState("litellm", file), new RegExp(P4_RUN_STATE_INVALID));
  });

  it("never includes the key in an error message", () => {
    const file = path.join(root, "damaged.json");
    fs.writeFileSync(file, `{"version":1,"product":"litellm","baseUrl":"ftp://x","apiKey":"${KEY}"`);
    assert.throws(() => readLlmRunState("litellm", file), (err: Error) => {
      assert.doesNotMatch(err.message, /SHOULD_NOT_APPEAR/);
      return true;
    });
  });
});
