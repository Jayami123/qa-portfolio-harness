import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertApiListenerIsRecorded,
  calApiPidFile,
  classifyCalApiState,
  calApiSpawnSpec,
  describeCalApiRecord,
  settleCalApiStop,
} from "./cal-api-pid.js";
import { CalWebStopError, parseCalWebPidFileText } from "./cal-web-pid.js";

describe("calApiPidFile", () => {
  it("lives under .harness with its own basename, never the web's", () => {
    const file = calApiPidFile("/root");
    assert.equal(path.basename(file), "cal-api.pid");
    assert.equal(path.basename(path.dirname(file)), ".harness");
  });
});

describe("parseCalWebPidFileText (shared record format)", () => {
  it("round-trips a JSON record with a start mark", () => {
    assert.deepEqual(parseCalWebPidFileText('{"pid":4242,"startMark":"abc"}\n'), { pid: 4242, startMark: "abc" });
  });

  it("returns undefined for corrupt text", () => {
    assert.equal(parseCalWebPidFileText("{broken"), undefined);
  });
});

describe("calApiSpawnSpec", () => {
  it("runs node on the built main.js, with no shell, detached", () => {
    assert.deepEqual(calApiSpawnSpec({ execPath: "/usr/bin/node", mainJs: "/x/main.js" }), {
      command: "/usr/bin/node",
      args: ["/x/main.js"],
      shell: false,
      detached: true,
    });
  });
});

describe("describeCalApiRecord", () => {
  it("names the pid and start mark, or says there is none", () => {
    assert.equal(describeCalApiRecord(undefined), "no pid record");
    assert.equal(describeCalApiRecord({ pid: 7 }), "recorded pid 7, start mark none");
  });
});

describe("assertApiListenerIsRecorded", () => {
  it("passes when the recorded pid listens", () => {
    assert.doesNotThrow(() =>
      assertApiListenerIsRecorded({ address: "127.0.0.1:5555", listeners: [9, 7], record: { pid: 7 } }),
    );
  });

  it("names the foreign pid when another process listens", () => {
    assert.throws(
      () => assertApiListenerIsRecorded({ address: "127.0.0.1:5555", listeners: [99], record: { pid: 7 } }),
      /listener pid 99 does not match recorded pid 7/,
    );
  });

  it("says no pid could be read when the listener list is empty", () => {
    assert.throws(
      () => assertApiListenerIsRecorded({ address: "127.0.0.1:5555", listeners: [], record: undefined }),
      /no listener pid could be read/,
    );
  });
});

describe("settleCalApiStop", () => {
  it("removes the pid file when the port is free", () => {
    let removed = false;
    settleCalApiStop({
      address: "127.0.0.1:5555",
      portHeld: false,
      listeners: [],
      record: { pid: 7 },
      removePidFile: () => {
        removed = true;
      },
    });
    assert.equal(removed, true);
  });

  it("keeps the pid file and throws when a foreign pid holds the port", () => {
    let removed = false;
    assert.throws(
      () =>
        settleCalApiStop({
          address: "127.0.0.1:5555",
          portHeld: true,
          listeners: [99],
          record: { pid: 7 },
          removePidFile: () => {
            removed = true;
          },
        }),
      (error: unknown) => error instanceof CalWebStopError && /pid 99, which does not match/.test(String(error.message)),
    );
    assert.equal(removed, false);
  });
});

describe("classifyCalApiState", () => {
  const base = { portOpen: true, listeners: [7], record: { pid: 7 }, recordLive: true, port: 5555, healthUrl: "http://127.0.0.1:5555/health" };

  it("is ok when health answers, whatever holds the port", () => {
    assert.equal(classifyCalApiState({ ...base, healthy: true, listeners: [99], record: undefined }), "ok");
  });

  it("is down when nothing listens", () => {
    assert.equal(classifyCalApiState({ ...base, healthy: false, portOpen: false, listeners: [] }), "down");
  });

  it("is starting when the recorded live pid listens but is not healthy yet", () => {
    assert.equal(classifyCalApiState({ ...base, healthy: false }), "starting");
  });

  it("throws and names a foreign pid on the port", () => {
    assert.throws(
      () => classifyCalApiState({ ...base, healthy: false, listeners: [99], record: undefined, recordLive: false }),
      /Port 5555 is held by pid 99, which is not the recorded Cal API v2 process/,
    );
  });

  it("throws when the holder is unknown and no record exists", () => {
    assert.throws(
      () => classifyCalApiState({ ...base, healthy: false, listeners: [], record: undefined, recordLive: false }),
      /held by a process whose pid could not be read/,
    );
  });

  it("does not treat a stale record (live=false) as ours", () => {
    assert.throws(
      () => classifyCalApiState({ ...base, healthy: false, recordLive: false }),
      /Port 5555 is held by pid 7/,
    );
  });
});
