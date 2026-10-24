import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listenerPids } from "./cal-web-process.js";
import {
  ProcNetUnavailableError,
  type ProcFs,
  parseProcNetListenInodes,
  readLinuxListenerPids,
} from "./proc-net-listeners.js";

// Port 3000 is 0x0BB8, port 3001 is 0x0BB9.
const TCP = [
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 111111 1 0000000000000000 100 0 0 10 0",
  "   1: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1001        0 222222 1 0000000000000000 20 4 30 10 -1",
  "   2: 0100007F:0BB9 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 333333 1 0000000000000000 100 0 0 10 0",
  "   3: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1 0000000000000000 100 0 0 10 0",
].join("\n");
const TCP6 = [
  "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 444444 1 0000000000000000 100 0 0 10 0",
].join("\n");

/** A fake /proc: a map from path to file text, directory listing, or a thrown error code. */
function fakeProc(files: Record<string, string | string[] | Error>, links: Record<string, string> = {}): ProcFs {
  const lookup = (path: string): string | string[] => {
    const hit = files[path];
    if (hit === undefined) {
      const error = Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      throw error;
    }
    if (hit instanceof Error) {
      throw hit;
    }
    return hit;
  };
  return {
    readFile: (path) => {
      const value = lookup(path);
      if (Array.isArray(value)) {
        throw new Error(`EISDIR: ${path}`);
      }
      return value;
    },
    readdir: (path) => {
      const value = lookup(path);
      if (!Array.isArray(value)) {
        throw new Error(`ENOTDIR: ${path}`);
      }
      return value;
    },
    readlink: (path) => {
      const target = links[path];
      if (target === undefined) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      return target;
    },
  };
}

const eacces = () => Object.assign(new Error("EACCES"), { code: "EACCES" });

describe("proc-net-listeners", () => {
  it("parses an IPv4 LISTEN row on the port", () => {
    assert.ok(parseProcNetListenInodes(TCP, 3000).includes("111111"));
  });

  it("parses an IPv6 LISTEN row on the port", () => {
    assert.deepEqual(parseProcNetListenInodes(TCP6, 3000), ["444444"]);
  });

  it("ignores a row that is not LISTEN", () => {
    assert.equal(parseProcNetListenInodes(TCP, 3000).includes("222222"), false);
  });

  it("ignores a row on another port", () => {
    assert.equal(parseProcNetListenInodes(TCP, 3000).includes("333333"), false);
    assert.deepEqual(parseProcNetListenInodes(TCP, 3001), ["333333"]);
  });

  it("ignores inode 0 (no owner)", () => {
    assert.deepEqual(parseProcNetListenInodes(TCP, 3000), ["111111"]);
  });

  it("maps the listen inode to its owner and skips unreadable processes", () => {
    const procFs = fakeProc(
      {
        "/proc/net/tcp": TCP,
        "/proc/net/tcp6": TCP6,
        "/proc": ["1", "4242", "5000", "self", "net"],
        "/proc/1/fd": eacces(),
        "/proc/4242/fd": ["0", "21"],
        "/proc/5000/fd": ["3"],
      },
      {
        "/proc/4242/fd/21": "socket:[111111]",
        "/proc/5000/fd/3": "socket:[444444]",
      },
    );
    assert.deepEqual(readLinuxListenerPids(3000, procFs), [4242, 5000]);
  });

  it("still finds the IPv4 owner when /proc/net/tcp6 is missing", () => {
    const procFs = fakeProc(
      {
        "/proc/net/tcp": TCP,
        "/proc": ["4242"],
        "/proc/4242/fd": ["21"],
      },
      { "/proc/4242/fd/21": "socket:[111111]" },
    );
    assert.deepEqual(readLinuxListenerPids(3000, procFs), [4242]);
  });

  it("throws ProcNetUnavailableError when /proc/net/tcp cannot be read", () => {
    const procFs = fakeProc({ "/proc/net/tcp": eacces() });
    assert.throws(() => readLinuxListenerPids(3000, procFs), ProcNetUnavailableError);
  });

  it("falls back to lsof when /proc/net/tcp is unreadable, and skips lsof when /proc works", () => {
    const lsofCalls: string[] = [];
    const exec = (command: string) => {
      lsofCalls.push(command);
      return "4242\n";
    };
    const unreadable = fakeProc({ "/proc/net/tcp": eacces() });
    assert.deepEqual(listenerPids(3000, "linux", { procFs: unreadable, execFile: exec }), [4242]);
    assert.deepEqual(lsofCalls, ["lsof"]);

    lsofCalls.length = 0;
    const working = fakeProc({
      "/proc/net/tcp": TCP,
      "/proc": ["4242"],
      "/proc/4242/fd": ["21"],
    }, { "/proc/4242/fd/21": "socket:[111111]" });
    assert.deepEqual(listenerPids(3000, "linux", { procFs: working, execFile: exec }), [4242]);
    assert.deepEqual(lsofCalls, []);
  });

  it("uses lsof on darwin and never reads /proc", () => {
    const untouched = fakeProc({});
    const exec = (command: string) => {
      assert.equal(command, "lsof");
      return "5151\n";
    };
    const procFs: ProcFs = {
      readFile: () => {
        throw new Error("darwin must not read /proc");
      },
      readdir: untouched.readdir,
      readlink: untouched.readlink,
    };
    assert.deepEqual(listenerPids(3000, "darwin", { procFs, execFile: exec }), [5151]);
  });

  it("returns no pid when the listen inode has no owner, so the caller still fails closed", () => {
    const lsofCalls: string[] = [];
    const procFs = fakeProc({ "/proc/net/tcp": TCP, "/proc": ["1"], "/proc/1/fd": ["0"] }, { "/proc/1/fd/0": "pipe:[9]" });
    const pids = listenerPids(3000, "linux", {
      procFs,
      execFile: (command) => {
        lsofCalls.push(command);
        return "";
      },
    });
    assert.deepEqual(pids, []);
    assert.deepEqual(lsofCalls, [], "a readable /proc with no owner must not fall back to lsof");
  });
});
