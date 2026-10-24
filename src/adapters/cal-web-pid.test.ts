import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CalWebStopError,
  calWebPidFile,
  parseCalWebPidFileText,
  readCalWebPidFromFile,
  stopCalWebFromPidFile,
  writeCalWebPid,
} from "./cal-web-pid.js";
import { parsePositiveSafeInteger } from "./documenso-web-pid.js";

describe("parsePositiveSafeInteger", () => {
  it("accepts only a full positive safe integer string", () => {
    assert.equal(parsePositiveSafeInteger("4242"), 4242);
    assert.equal(parsePositiveSafeInteger(" 4242 "), 4242);
    assert.equal(parsePositiveSafeInteger("4242abc"), undefined);
    assert.equal(parsePositiveSafeInteger("not-a-pid"), undefined);
    assert.equal(parsePositiveSafeInteger(""), undefined);
  });
});

describe("parseCalWebPidFileText", () => {
  it("rejects trailing junk after digits", () => {
    assert.deepEqual(parseCalWebPidFileText("4242\n"), { pid: 4242 });
    assert.equal(parseCalWebPidFileText("4242x"), undefined);
  });
});

describe("cal web pid file", () => {
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
    writeCalWebPid(4242, root);
    assert.equal(readCalWebPidFromFile(root), 4242);
    const raw = fs.readFileSync(calWebPidFile(root), "utf8");
    assert.match(raw, /^\{"pid":4242/);
  });

  it("stop with missing pid file does not throw", () => {
    const root = freshHarnessRoot();
    assert.doesNotThrow(() => stopCalWebFromPidFile(root));
  });

  it("stop with stale pid removes the file after kill attempt fails", () => {
    const root = freshHarnessRoot();
    writeCalWebPid(999_999_999, root);
    const killed: number[] = [];
    stopCalWebFromPidFile(root, {
      isPidRunning: () => false,
      killProcessTree: (pid) => {
        killed.push(pid);
        throw new Error("pid gone");
      },
    });
    assert.deepEqual(killed, [999_999_999]);
    assert.equal(fs.existsSync(calWebPidFile(root)), false);
  });

  it("stop with a running pid kills the tree and removes the file", () => {
    const root = freshHarnessRoot();
    writeCalWebPid(1234, root);
    const killed: number[] = [];
    stopCalWebFromPidFile(root, {
      isPidRunning: (pid) => pid === 1234,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
      captureStartMark: () => "mark",
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
    });
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(calWebPidFile(root)), false);
  });

  it("stop preserves the pid file when kill fails and the pid is still running", () => {
    const root = freshHarnessRoot();
    writeCalWebPid(1234, root);
    assert.throws(
      () =>
        stopCalWebFromPidFile(root, {
          isPidRunning: () => true,
          killProcessTree: () => {
            throw new Error("taskkill failed");
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /taskkill failed/);
        return true;
      },
    );
    assert.equal(fs.existsSync(calWebPidFile(root)), true);
  });

  it("stop skips signaling when start mark mismatches a live pid", () => {
    const root = freshHarnessRoot();
    writeCalWebPid(1234, root);
    const killed: number[] = [];
    assert.throws(
      () =>
        stopCalWebFromPidFile(root, {
          isPidRunning: () => true,
          captureStartMark: () => "current",
          readRecord: () => ({ pid: 1234, startMark: "recorded" }),
          killProcessTree: (pid) => {
            killed.push(pid);
          },
        }),
      CalWebStopError,
    );
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(calWebPidFile(root)), true);
  });

  it("stop with corrupt pid file removes the file without throwing", () => {
    const root = freshHarnessRoot();
    const file = calWebPidFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-a-pid\n", "utf8");
    const killed: number[] = [];
    stopCalWebFromPidFile(root, {
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(file), false);
  });
});
