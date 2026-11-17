import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  P4_RUN_STATE_INVALID,
  P4_RUN_STATE_MISSING,
  p4RunStateFile,
  type P4RunState,
  readP4McpCredentials,
  removeP4RunState,
  writeP4RunState,
} from "./p4-run-state.js";

const SECRET = "tok_SHOULD_NOT_APPEAR_IN_ERRORS";

function state(overrides: Partial<P4RunState> = {}): P4RunState {
  return {
    version: 1,
    product: "outline",
    mcpUrl: "http://127.0.0.1:3010/mcp",
    mcpAuthorization: `Bearer ${SECRET}`,
    owner: { username: "qa-owner", email: "qa-owner@p4.test" },
    ...overrides,
  };
}

describe("p4 run state", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "p4-run-state-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("puts the state under .harness/<product>-run.json", () => {
    assert.equal(p4RunStateFile("penpot", root), path.join(root, ".harness", "penpot-run.json"));
  });

  it("round-trips the MCP URL and Authorization value", () => {
    const file = p4RunStateFile("outline", root);
    writeP4RunState(file, state());
    assert.deepEqual(readP4McpCredentials("outline", file), {
      mcpUrl: "http://127.0.0.1:3010/mcp",
      mcpAuthorization: `Bearer ${SECRET}`,
    });
  });

  it("writes mode 0600, also when the file is overwritten", () => {
    const file = p4RunStateFile("outline", root);
    writeP4RunState(file, state());
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.chmodSync(file, 0o644);
    writeP4RunState(file, state());
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("removes the file, and a second remove is not an error", () => {
    const file = p4RunStateFile("outline", root);
    writeP4RunState(file, state());
    removeP4RunState(file);
    assert.equal(fs.existsSync(file), false);
    assert.doesNotThrow(() => removeP4RunState(file));
  });

  it("throws P4_RUN_STATE_MISSING for an absent file, without any value", () => {
    const file = p4RunStateFile("outline", root);
    assert.throws(
      () => readP4McpCredentials("outline", file),
      (e: Error) => e.message.startsWith(P4_RUN_STATE_MISSING) && !e.message.includes(SECRET),
    );
  });

  it("throws P4_RUN_STATE_INVALID for JSON that is not the state, without its content", () => {
    const file = p4RunStateFile("outline", root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `{"broken": "${SECRET}`);
    assert.throws(
      () => readP4McpCredentials("outline", file),
      (e: Error) => e.message.startsWith(P4_RUN_STATE_INVALID) && !e.message.includes(SECRET),
    );
  });

  it("accepts a null credential (Penpot single-user) and round-trips it", () => {
    const file = p4RunStateFile("penpot", root);
    writeP4RunState(file, state({ product: "penpot", mcpAuthorization: null }));
    assert.equal(readP4McpCredentials("penpot", file).mcpAuthorization, null);
  });

  it("rejects a state for another product, a non-http URL, or an empty credential", () => {
    const file = p4RunStateFile("outline", root);
    const cases: Partial<P4RunState>[] = [
      { product: "penpot" },
      { mcpUrl: "ftp://127.0.0.1/mcp" },
      { mcpAuthorization: "   " },
      { version: 2 as unknown as 1 },
    ];
    for (const override of cases) {
      writeP4RunState(file, state(override));
      assert.throws(
        () => readP4McpCredentials("outline", file),
        (e: Error) => e.message.startsWith(P4_RUN_STATE_INVALID) && !e.message.includes(SECRET),
        JSON.stringify(override),
      );
    }
  });
});
