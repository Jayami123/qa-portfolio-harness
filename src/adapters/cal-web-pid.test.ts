import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CalWebStopError,
  type CalWebStopDeps,
  type CalWebSignal,
  type ProcessRow,
  calWebPidFile,
  calWebSpawnSpec,
  matchCalWebTree,
  parseCalWebPidFileText,
  readCalWebPidRecord,
  settleCalWebStop,
  stopCalWebTree,
  writeCalWebPid,
} from "./cal-web-pid.js";
import { parsePositiveSafeInteger } from "./documenso-web-pid.js";

interface Recorder {
  signaled: Array<{ pid: number; signal: CalWebSignal }>;
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
    listProcesses: () => [],
    killRootTree: (pid, signal) => {
      deps.rootSignaled.push({ pid, signal });
    },
    killProcess: (pid, signal) => {
      deps.signaled.push({ pid, signal });
    },
    signaled: [],
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
    assert.equal(stopCalWebTree(deps).size, 0);
    assert.deepEqual(deps.signaled, []);
    assert.equal(deps.rootSignaled.length, 0);
  });

  it("stop with a dead root does not signal the stale pid, and the settle removes the file", () => {
    const deps = fakeDeps({ readRecord: () => ({ pid: 999_999_999 }) });
    const tree = stopCalWebTree(deps);
    assert.equal(tree.size, 0);
    assert.equal(deps.rootSignaled.length, 0);
    settleCalWebStop({ address: "127.0.0.1:3000", portHeld: false, listeners: [], tree, removePidFile: deps.removePidFile });
    assert.equal(deps.removed, 1);
  });

  it("stop with a running pid kills the tree and removes the file", () => {
    const deps = fakeDeps({
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
      isPidRunning: (pid) => pid === 1234,
      captureStartMark: () => "mark",
    });
    const tree = stopCalWebTree(deps);
    assert.deepEqual(deps.rootSignaled, [{ pid: 1234, signal: "SIGTERM" }]);
    assert.deepEqual([...tree], [1234]);
    settleCalWebStop({ address: "127.0.0.1:3000", portHeld: false, listeners: [], tree, removePidFile: deps.removePidFile });
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
      () => stopCalWebTree(deps),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /taskkill failed/);
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
    assert.throws(() => stopCalWebTree(deps), CalWebStopError);
    assert.equal(deps.rootSignaled.length, 0);
    assert.equal(deps.removed, 0);
  });

  it("stop with corrupt pid file removes the file without throwing", () => {
    const deps = fakeDeps({ hasPidFile: () => true });
    const tree = stopCalWebTree(deps);
    assert.equal(tree.size, 0);
    assert.equal(deps.removed, 1);
    assert.deepEqual(deps.signaled, []);
  });
});

describe("calWebSpawnSpec (no shell)", () => {
  it("starts yarn directly on POSIX, detached so the web leads its own process group", () => {
    const spec = calWebSpawnSpec({
      platform: "linux",
      execPath: "/usr/bin/node",
      yarn: "yarn",
      args: ["workspace", "@calcom/web", "exec", "next", "start"],
    });
    assert.deepEqual(spec, {
      command: "yarn",
      args: ["workspace", "@calcom/web", "exec", "next", "start"],
      shell: false,
      detached: true,
    });
  });

  it("runs yarn's JS entry under node on Windows with no shell, and refuses without that entry", () => {
    const spec = calWebSpawnSpec({
      platform: "win32",
      execPath: "C:\\nvm4w\\nodejs\\node.exe",
      yarn: "C:\\nvm4w\\nodejs\\yarn.cmd",
      yarnScript: "C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\yarn.js",
      args: ["workspace", "@calcom/web", "exec", "next", "start"],
    });
    assert.equal(spec.command, "C:\\nvm4w\\nodejs\\node.exe");
    assert.equal(spec.args[0], "C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\yarn.js");
    assert.equal(spec.shell, false);
    assert.equal(spec.detached, false);
    assert.throws(
      () =>
        calWebSpawnSpec({
          platform: "win32",
          execPath: "C:\\nvm4w\\nodejs\\node.exe",
          yarn: "yarn.cmd",
          args: [],
        }),
      /Refusing to start through cmd\.exe/,
    );
  });
});

describe("dead root and the port", () => {
  const rows: ProcessRow[] = [
    { pid: 100, ppid: 1, pgid: 100, start: "1000" },
    { pid: 101, ppid: 100, pgid: 100, start: "2000" },
    { pid: 102, ppid: 101, pgid: 100, start: "2100" },
    { pid: 103, ppid: 100, pgid: 999, start: "500" },
    { pid: 200, ppid: 1, pgid: 200, start: "3000" },
  ];

  it("dead root with live matched children stops only the matched descendants", () => {
    const deps = fakeDeps(
      {
        readRecord: () => ({ pid: 100, startMark: "1000" }),
        isPidRunning: (pid) => pid !== 100 && pid !== 103,
        listProcesses: () => rows,
      },
      "linux",
    );
    const tree = stopCalWebTree(deps);
    assert.deepEqual(deps.signaled, [
      { pid: 101, signal: "SIGTERM" },
      { pid: 102, signal: "SIGTERM" },
    ]);
    assert.deepEqual([...tree].sort(), [101, 102]);
  });

  it("dead root with an unmatched listener is refused and the pid file is kept", () => {
    const deps = fakeDeps({ readRecord: () => ({ pid: 100, startMark: "1000" }), listProcesses: () => [] });
    const tree = stopCalWebTree(deps);
    assert.equal(tree.size, 0);
    assert.throws(
      () =>
        settleCalWebStop({
          address: "127.0.0.1:3000",
          portHeld: true,
          listeners: [555],
          tree,
          removePidFile: deps.removePidFile,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CalWebStopError);
        assert.match(error.message, /does not match the harness record; not killed/);
        return true;
      },
    );
    assert.equal(deps.removed, 0);
  });

  it("pid file is kept when the port is still held by a recorded process", () => {
    const deps = fakeDeps({});
    const tree = new Set([101]);
    assert.throws(
      () =>
        settleCalWebStop({
          address: "127.0.0.1:3000",
          portHeld: true,
          listeners: [101],
          tree,
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

  it("does not match descendants when the root has no start mark", () => {
    assert.deepEqual(matchCalWebTree(rows, 100, undefined, true), []);
  });
});
