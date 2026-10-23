import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  MEDUSA_BACKEND_2_PID_BASENAME,
  MedusaBackendStopError,
  medusaBackendPidFile,
  medusaHarnessPidFile,
  parseMedusaBackendPidFileText,
  parsePositiveSafeInteger,
  readMedusaBackend2Record,
  stopMedusaBackend2FromPidFile,
  stopMedusaBackendFromPidFile,
  writeMedusaBackend2Pid,
  writeMedusaBackendPid,
} from "./medusa-backend-pid.js";

describe("parsePositiveSafeInteger", () => {
  it("accepts only a full positive safe integer string", () => {
    assert.equal(parsePositiveSafeInteger("4242"), 4242);
    assert.equal(parsePositiveSafeInteger(" 4242 "), 4242);
    assert.equal(parsePositiveSafeInteger("0"), undefined);
    assert.equal(parsePositiveSafeInteger("4242abc"), undefined);
    assert.equal(parsePositiveSafeInteger(""), undefined);
  });
});

describe("parseMedusaBackendPidFileText", () => {
  it("parses a legacy pid and JSON with a start mark", () => {
    assert.deepEqual(parseMedusaBackendPidFileText("4242\n"), { pid: 4242 });
    assert.deepEqual(parseMedusaBackendPidFileText('{"pid":4242,"startMark":"abc"}\n'), {
      pid: 4242,
      startMark: "abc",
    });
  });

  it("rejects trailing junk and a non-numeric pid", () => {
    assert.equal(parseMedusaBackendPidFileText("4242x"), undefined);
    assert.equal(parseMedusaBackendPidFileText('{"pid":"4242"}'), undefined);
    assert.equal(parseMedusaBackendPidFileText("not-a-pid"), undefined);
  });
});

describe("medusa backend pid file", () => {
  let tmpRoot = "";

  afterEach(() => {
    if (tmpRoot !== "") {
      fs.rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = "";
    }
  });

  function freshHarnessRoot(): string {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-medusa-pid-"));
    return tmpRoot;
  }

  it("stop with a missing pid file does not throw", () => {
    const root = freshHarnessRoot();
    assert.doesNotThrow(() => stopMedusaBackendFromPidFile(root));
  });

  it("stop with a corrupt pid file removes it and does not signal", () => {
    const root = freshHarnessRoot();
    const file = medusaBackendPidFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-a-pid\n", "utf8");
    const killed: number[] = [];
    stopMedusaBackendFromPidFile(root, {
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, []);
    assert.equal(fs.existsSync(file), false);
  });

  it("stop signals only the recorded pid", () => {
    const root = freshHarnessRoot();
    writeMedusaBackendPid(1234, root);
    const killed: number[] = [];
    stopMedusaBackendFromPidFile(root, {
      isPidRunning: (pid) => pid === 1234,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
      captureStartMark: () => "mark",
      readRecord: () => ({ pid: 1234, startMark: "mark" }),
    });
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(medusaBackendPidFile(root)), false);
  });

  it("stop skips signaling when the start mark of a live pid does not match", () => {
    const root = freshHarnessRoot();
    writeMedusaBackendPid(1234, root);
    const killed: number[] = [];
    assert.throws(
      () =>
        stopMedusaBackendFromPidFile(root, {
          isPidRunning: () => true,
          captureStartMark: () => "current",
          readRecord: () => ({ pid: 1234, startMark: "recorded" }),
          killProcessTree: (pid) => {
            killed.push(pid);
          },
        }),
      MedusaBackendStopError,
    );
    assert.deepEqual(killed, []);
  });
});

describe("second backend pid record", () => {
  let tmpRoot = "";

  afterEach(() => {
    if (tmpRoot !== "") {
      fs.rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = "";
    }
  });

  function freshHarnessRoot(): string {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-medusa-pid2-"));
    return tmpRoot;
  }

  it("parses the legacy record shape without a baseUrl", () => {
    assert.deepEqual(parseMedusaBackendPidFileText('{"pid":4242}'), { pid: 4242 });
  });

  it("keeps baseUrl through a parse round-trip", () => {
    assert.deepEqual(
      parseMedusaBackendPidFileText('{"pid":4242,"startMark":"abc","baseUrl":"http://127.0.0.1:9001"}'),
      { pid: 4242, startMark: "abc", baseUrl: "http://127.0.0.1:9001" },
    );
  });

  it("round-trips baseUrl through writeMedusaBackend2Pid and readMedusaBackend2Record", () => {
    const root = freshHarnessRoot();
    writeMedusaBackend2Pid(4242, "http://127.0.0.1:9001", root);
    const record = readMedusaBackend2Record(root);
    assert.equal(record?.pid, 4242);
    assert.equal(record?.baseUrl, "http://127.0.0.1:9001");
    assert.equal(fs.existsSync(medusaHarnessPidFile(MEDUSA_BACKEND_2_PID_BASENAME, root)), true);
  });

  it("returns undefined when there is no second backend record", () => {
    assert.equal(readMedusaBackend2Record(freshHarnessRoot()), undefined);
  });

  it("stopMedusaBackend2FromPidFile signals only the recorded pid, through the injected deps", () => {
    const root = freshHarnessRoot();
    const file = medusaHarnessPidFile(MEDUSA_BACKEND_2_PID_BASENAME, root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"pid":1234,"baseUrl":"http://127.0.0.1:9001"}\n', "utf8");
    const killed: number[] = [];
    stopMedusaBackend2FromPidFile(root, {
      isPidRunning: (pid) => pid === 1234,
      captureStartMark: () => undefined,
      killProcessTree: (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, [1234]);
    assert.equal(fs.existsSync(file), false);
  });
});
