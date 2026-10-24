import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CalWebStopError,
  type CalWebStopDeps,
  type CalWebSignal,
  assertListenerIsRecorded,
  calWebPidFile,
  calWebSpawnSpec,
  parseCalWebPidFileText,
  readCalWebPidRecord,
  settleCalWebStop,
  stopRecordedCalWeb,
  writeCalWebPid,
} from "./cal-web-pid.js";
import { parsePositiveSafeInteger } from "./documenso-web-pid.js";

interface Recorder {
  rootSignaled: Array<{ pid: number; signal: CalWebSignal }>;
  removed: number;
}

function fakeDeps(overrides: Partial<CalWebStopDeps>, platform: NodeJS.Platform = "linux"): CalWebStopDeps & Recorder {
  const deps: CalWebStopDeps & Recorder = {
    platform,
    readRecord: () => undefined,
    hasPidFile: () => false,
    removePidFile: () => {
      deps.removed += 1;
    },
    isPidRunning: () => false,
    captureStartMark: () => undefined,
    killRootTree: (pid, signal) => {
      deps.rootSignaled.push({ pid, signal });
    },
    rootSignaled: [],
    removed: 0,
    ...overrides,
  };
  return deps;
}

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
    assert.equal(readCalWebPidRecord(root)?.pid, 4242);
    const raw = fs.readFileSync(calWebPidFile(root), "utf8");
    assert.match(raw, /^\{"pid":4242/);
  });

  it("stop with missing pid file does not throw", () => {
    const deps = fakeDeps({});
    assert.equal(stopRecordedCalWeb(deps), undefined);
    assert.equal(deps.rootSignaled.length, 0);
  });

  it("stop with a dead recorded pid does not signal it, and the settle removes the file", () => {
    const deps = fakeDeps({ readRecord: () => ({ pid: 999_999_999 }) });
    const record = stopRecordedCalWeb(deps);
    assert.deepEqual(record, { pid: 999_999_999 });
    assert.equal(deps.rootSignaled.length, 0);
    settleCalWebStop({ address: "127.0.0.1:3000", portHeld: false, listeners: [], record, removePidFile: deps.removePidFile });
    assert.equal(deps.removed, 1);
  });

  it("stop with a running pid kills its tree and removes the file", () => {
    const deps = fakeDeps({
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
      isPidRunning: (pid) => pid === 1234,
      captureStartMark: () => "mark",
    });
    const record = stopRecordedCalWeb(deps);
    assert.deepEqual(deps.rootSignaled, [{ pid: 1234, signal: "SIGTERM" }]);
    settleCalWebStop({ address: "127.0.0.1:3000", portHeld: false, listeners: [], record, removePidFile: deps.removePidFile });
    assert.equal(deps.removed, 1);
  });

  it("stop preserves the pid file when kill fails and the pid is still running", () => {
    const deps = fakeDeps({
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
      isPidRunning: () => true,
      captureStartMark: () => "mark",
      killRootTree: () => {
        throw new Error("taskkill failed");
      },
    });
    assert.throws(
      () => stopRecordedCalWeb(deps),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /taskkill failed/);
        assert.match(error.message, /recorded pid 1234, start mark mark/);
        return true;
      },
    );
    assert.equal(deps.removed, 0);
  });

  it("stop skips signaling when start mark mismatches a live pid", () => {
    const deps = fakeDeps({
      readRecord: () => ({ pid: 1234, startMark: "recorded" }),
      isPidRunning: () => true,
      captureStartMark: () => "current",
    });
    assert.throws(() => stopRecordedCalWeb(deps), (error: unknown) => {
      assert.ok(error instanceof CalWebStopError);
      assert.match(error.message, /recorded pid 1234, start mark recorded/);
      assert.match(error.message, /current start mark current/);
      return true;
    });
    assert.equal(deps.rootSignaled.length, 0);
    assert.equal(deps.removed, 0);
  });

  it("stop with corrupt pid file removes the file without throwing", () => {
    const deps = fakeDeps({ hasPidFile: () => true });
    assert.equal(stopRecordedCalWeb(deps), undefined);
    assert.equal(deps.removed, 1);
    assert.equal(deps.rootSignaled.length, 0);
  });
});

describe("calWebSpawnSpec (node runs the Next.js bin, no shell)", () => {
  const args = ["start", "-H", "127.0.0.1", "-p", "3000"];

  it("runs node on the next bin, detached on POSIX so the server leads its process group", () => {
    const spec = calWebSpawnSpec({
      platform: "linux",
      execPath: "/usr/bin/node",
      nextBin: "/products/cal/node_modules/next/dist/bin/next",
      args,
    });
    assert.deepEqual(spec, {
      command: "/usr/bin/node",
      args: ["/products/cal/node_modules/next/dist/bin/next", ...args],
      shell: false,
      detached: true,
    });
  });

  it("runs node on the next bin on Windows with no shell, detached so it outlives up", () => {
    const spec = calWebSpawnSpec({
      platform: "win32",
      execPath: "C:\\nvm4w\\nodejs\\node.exe",
      nextBin: "D:\\products\\cal\\node_modules\\next\\dist\\bin\\next",
      args,
    });
    assert.equal(spec.command, "C:\\nvm4w\\nodejs\\node.exe");
    assert.equal(spec.args[0], "D:\\products\\cal\\node_modules\\next\\dist\\bin\\next");
    assert.equal(spec.shell, false);
    assert.equal(spec.detached, true);
  });
});

describe("listener on the web port", () => {
  it("dead recorded pid with an unrelated listener is refused, and the message names the record", () => {
    const deps = fakeDeps({ readRecord: () => ({ pid: 100, startMark: "1000" }) });
    const record = stopRecordedCalWeb(deps);
    assert.throws(
      () =>
        settleCalWebStop({
          address: "127.0.0.1:3000",
          portHeld: true,
          listeners: [555],
          record,
          removePidFile: deps.removePidFile,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /as pid 555, which does not match recorded pid 100, start mark 1000; not killed/);
        return true;
      },
    );
    assert.equal(deps.removed, 0);
  });

  it("pid file is kept when the port is still held by the recorded pid", () => {
    const deps = fakeDeps({});
    assert.throws(
      () =>
        settleCalWebStop({
          address: "127.0.0.1:3000",
          portHeld: true,
          listeners: [100],
          record: { pid: 100, startMark: "1000" },
          removePidFile: deps.removePidFile,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /Pid file kept; run down again/);
        return true;
      },
    );
    assert.equal(deps.removed, 0);
  });

  it("up refuses to proceed unless the listener is the recorded pid", () => {
    const record = { pid: 100, startMark: "1000" };
    assert.doesNotThrow(() => assertListenerIsRecorded({ address: "127.0.0.1:3000", listeners: [100], record }));
    assert.throws(
      () => assertListenerIsRecorded({ address: "127.0.0.1:3000", listeners: [555], record }),
      /listener pid 555 does not match recorded pid 100, start mark 1000/,
    );
    assert.throws(
      () => assertListenerIsRecorded({ address: "127.0.0.1:3000", listeners: [], record }),
      /no listener pid could be read/,
    );
  });
});
