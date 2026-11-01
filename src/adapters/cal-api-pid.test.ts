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
  const ours = { portOpen: true, listeners: [7], record: { pid: 7 }, recordLive: true, port: 5555, healthUrl: "http://127.0.0.1:5555/health" };

  it("is ok only when the health answer is OK and the recorded live pid listens", () => {
    assert.equal(classifyCalApiState({ ...ours, healthy: true }), "ok");
  });

  it("throws when a foreign process answers OK on the port (the N1 case)", () => {
    assert.throws(
      () => classifyCalApiState({ ...ours, healthy: true, listeners: [99], record: undefined, recordLive: false }),
      /Port 5555 is held by pid 99, which is not the recorded Cal API v2 process .* answers OK/,
    );
  });

  it("throws when the recorded pid answers OK but another pid holds the port", () => {
    assert.throws(() => classifyCalApiState({ ...ours, healthy: true, listeners: [99] }), /held by pid 99/);
  });

  it("is down when nothing listens and nothing answers", () => {
    assert.equal(classifyCalApiState({ ...ours, healthy: false, portOpen: false, listeners: [] }), "down");
  });

  it("is starting when the recorded live pid listens but is not healthy yet", () => {
    assert.equal(classifyCalApiState({ ...ours, healthy: false }), "starting");
  });

  it("throws for a foreign listener that does not answer OK", () => {
    assert.throws(
      () => classifyCalApiState({ ...ours, healthy: false, listeners: [99], record: undefined, recordLive: false }),
      /Port 5555 is held by pid 99.*does not answer OK/,
    );
  });

  it("throws when the holder is unknown and no record exists", () => {
    assert.throws(
      () => classifyCalApiState({ ...ours, healthy: false, listeners: [], record: undefined, recordLive: false }),
      /held by a process whose pid could not be read/,
    );
  });

  it("does not treat a stale record (live=false) as ours", () => {
    assert.throws(() => classifyCalApiState({ ...ours, healthy: false, recordLive: false }), /held by pid 7/);
  });
});
