import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  documensoWebPidFile,
  readDocumensoWebPidFromFile,
  stopDocumensoWebFromPidFile,
  writeDocumensoWebPid,
} from "./documenso-web-pid.js";

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

  it("writes and reads a pid", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(4242, root);
    assert.equal(readDocumensoWebPidFromFile(root), 4242);
    assert.equal(fs.readFileSync(documensoWebPidFile(root), "utf8"), "4242\n");
  });

  it("stop with missing pid file does not throw", () => {
    const root = freshHarnessRoot();
    assert.doesNotThrow(() => stopDocumensoWebFromPidFile(root));
  });

  it("stop with stale pid removes the file without killing", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(999_999_999, root);
    const killed: number[] = [];
    stopDocumensoWebFromPidFile(root, {
      isPidRunning: () => false,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, []);
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
    });
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), false);
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
