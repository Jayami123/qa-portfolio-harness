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
  stopDocumensoWebRoot,
  writeDocumensoWebPid,
  ownedKillTarget,
  parentPidOf,
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

  it("stop with a missing pid file reports none and does not throw", () => {
    const root = freshHarnessRoot();
    assert.deepEqual(stopDocumensoWebRoot(root).state, "none");
  });

  // Cause B: the recorded root had already exited. Its children still hold the port. The root must not be
  // treated as a stopped tree, and the pid file must stay until the port is confirmed free.
  it("a dead recorded root is reported dead, not signaled, and keeps the pid file", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(28740, root);
    const killed: number[] = [];
    const result = stopDocumensoWebRoot(root, {
      isPidRunning: () => false,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.equal(result.state, "dead");
    assert.equal(result.record?.pid, 28740);
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), true);
  });

  it("a live recorded root is signaled once, and the pid file stays for the caller to remove", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    const killed: number[] = [];
    const result = stopDocumensoWebRoot(root, {
      isPidRunning: (pid) => pid === 1234,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
      captureStartMark: () => "mark",
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
    });
    assert.equal(result.state, "live");
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(documensoWebPidFile(root)), true);
  });

  it("a live root whose kill fails while still running throws and keeps the pid file", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    assert.throws(
      () =>
        stopDocumensoWebRoot(root, {
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

  it("a root whose kill throws after it exited is reported live and not an error", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    let running = true;
    const result = stopDocumensoWebRoot(root, {
      isPidRunning: () => running,
      captureStartMark: () => undefined,
      readRecord: () => ({ pid: 1234 }),
      killProcessTree: () => {
        running = false;
        throw new Error("no such process");
      },
    });
    assert.equal(result.state, "live");
  });

  it("stop skips signaling when start mark mismatches a live pid", () => {
    const root = freshHarnessRoot();
    writeDocumensoWebPid(1234, root);
    const killed: number[] = [];
    assert.throws(
      () =>
        stopDocumensoWebRoot(root, {
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

  it("stop with a corrupt pid file removes the file without throwing", () => {
    const root = freshHarnessRoot();
    const file = documensoWebPidFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-a-pid\n", "utf8");
    const killed: number[] = [];
    stopDocumensoWebRoot(root, {
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(file), false);
  });
});

// Cause A and B: the listener is signaled only when the recorded pid is on its ancestor chain.
describe("ownedKillTarget", () => {
  // listener 33004 -> 20676 -> 38980 -> 40320 -> 28740 (the recorded root)
  const parents: Record<number, number | undefined> = { 33004: 20676, 20676: 38980, 38980: 40320, 40320: 28740 };
  const parentOf = (pid: number) => parents[pid];

  it("with a dead root, signals the child just below it, which takes the listener with it", () => {
    assert.equal(ownedKillTarget({ listener: 33004, recordedRoot: 28740, rootAlive: false, parentOf }), 40320);
  });

  it("with a live root, signals the root", () => {
    assert.equal(ownedKillTarget({ listener: 33004, recordedRoot: 28740, rootAlive: true, parentOf }), 28740);
  });

  it("does not signal a listener that the record is not an ancestor of", () => {
    assert.equal(ownedKillTarget({ listener: 9999, recordedRoot: 28740, rootAlive: true, parentOf: () => 1 }), undefined);
  });

  it("does not signal when the recorded pid is the listener itself and the root is dead", () => {
    assert.equal(ownedKillTarget({ listener: 28740, recordedRoot: 28740, rootAlive: false, parentOf }), undefined);
  });

  it("stops on a parent cycle instead of looping", () => {
    assert.equal(ownedKillTarget({ listener: 5, recordedRoot: 7, rootAlive: true, parentOf: (pid) => (pid === 5 ? 6 : 5) }), undefined);
  });

  it("parentPidOf returns a positive pid for this process", () => {
    const parent = parentPidOf(process.pid);
    assert.ok(parent === undefined || (Number.isSafeInteger(parent) && parent > 0));
  });
});
