import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  DocumensoWebStopError,
  documensoWebPidFile,
  parseDocumensoWebPidFileText,
  parsePositiveSafeInteger,
  readDocumensoWebPidFromFile,
  stopDocumensoWebFromPidFile,
  writeDocumensoWebPid,
} from "./documenso-web-pid.js";

describe("parsePositiveSafeInteger", () => {
  it("accepts only a full positive safe integer string", () => {
    assert.equal(parsePositiveSafeInteger("4242"), 4242);
    assert.equal(parsePositiveSafeInteger(" 4242 "), 4242);
    assert.equal(parsePositiveSafeInteger("4242abc"), undefined);
    assert.equal(parsePositiveSafeInteger("not-a-pid"), undefined);
    assert.equal(parsePositiveSafeInteger(""), undefined);
  });
});

describe("parseDocumensoWebPidFileText", () => {
  it("rejects trailing junk after digits", () => {
    assert.deepEqual(parseDocumensoWebPidFileText("4242\n"), { pid: 4242 });
    assert.equal(parseDocumensoWebPidFileText("4242x"), undefined);
  });
});

describe("documenso web pid file", () => {
  let tmpRoot = "";

  afterEach(() => {
    if (tmpRoot !== "") {
      fs.rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = "";
    }
  });

  function freshHarnessRoot(): string {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-pid-"));
    return tmpRoot;
  }

  it("writes JSON with pid and reads it back", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(4242, root);
    assert.equal(readDocumensoWebPidFromFile(root), 4242);
    const raw = fs.readFileSync(documensoWebPidFile(root), "utf8");
    assert.match(raw, /^\{"pid":4242/);
  });

  it("stop with missing pid file does not throw", () => {
    const root = freshHarnessRoot();
    assert.doesNotThrow(() => stopDocumensoWebFromPidFile(root));
  });

  it("stop with stale pid removes the file after kill attempt fails", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(999_999_999, root);
    const killed: number[] = [];
    stopDocumensoWebFromPidFile(root, {
      isPidRunning: () => false,
      killProcessTree: (pid) => {
        killed.push(pid);
        throw new Error("pid gone");
      },
    });
    assert.deepEqual(killed, [999_999_999]);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), false);
  });

  it("stop with a running pid kills the tree and removes the file", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    const killed: number[] = [];
    stopDocumensoWebFromPidFile(root, {
      isPidRunning: (pid) => pid === 1234,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
      captureStartMark: () => "mark",
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
    });
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), false);
  });

  it("stop preserves the pid file when kill fails and the pid is still running", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    assert.throws(
      () =>
        stopDocumensoWebFromPidFile(root, {
          isPidRunning: () => true,
          killProcessTree: () => {
            throw new Error("taskkill failed");
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DocumensoWebStopError);
        assert.match(error.message, /taskkill failed/);
        return true;
      },
    );
    assert.equal(fs.existsSync(documensoWebPidFile(root)), true);
  });

  it("stop skips signaling when start mark mismatches a live pid", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    const killed: number[] = [];
    assert.throws(
      () =>
        stopDocumensoWebFromPidFile(root, {
          isPidRunning: () => true,
          captureStartMark: () => "current",
          readRecord: () => ({ pid: 1234, startMark: "recorded" }),
          killProcessTree: (pid) => {
            killed.push(pid);
          },
        }),
      DocumensoWebStopError,
    );
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), true);
  });

  it("stop with corrupt pid file removes the file without throwing", () => {
    const root = freshHarnessRoot();
    const file = documensoWebPidFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-a-pid\n", "utf8");
    const killed: number[] = [];
    stopDocumensoWebFromPidFile(root, {
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(file), false);
  });
});
