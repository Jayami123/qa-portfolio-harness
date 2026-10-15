import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commandLineMatchesProductRoot,
  parseLsofPids,
  parseNetstatListeningPids,
} from "./medusa-listeners.js";

const NETSTAT = [
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       25860",
  "  TCP    [::]:8000              [::]:0                 LISTENING       25860",
  "  TCP    127.0.0.1:9000         0.0.0.0:0              LISTENING       4411",
  "  TCP    127.0.0.1:60378        127.0.0.1:8000         TIME_WAIT       0",
  "  TCP    127.0.0.1:8000         127.0.0.1:50001        ESTABLISHED     25860",
  "  TCP    0.0.0.0:18000          0.0.0.0:0              LISTENING       9999",
].join("\r\n");

describe("parseNetstatListeningPids", () => {
  it("returns the LISTENING pid on the port, deduplicated across IPv4 and IPv6", () => {
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 8000), [25860]);
  });

  it("finds a different port without matching ports that only end in the same digits", () => {
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 9000), [4411]);
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 3000), []);
  });

  it("ignores ESTABLISHED and TIME_WAIT rows", () => {
    assert.deepEqual(
      parseNetstatListeningPids(
        "  TCP    127.0.0.1:8000  127.0.0.1:1  ESTABLISHED  77",
        8000,
      ),
      [],
    );
  });
});

describe("parseLsofPids", () => {
  it("parses one pid per line and drops blanks and junk", () => {
    assert.deepEqual(parseLsofPids("123\n456\n\n456\nnot-a-pid\n"), [123, 456]);
  });

  it("returns an empty list when nothing listens", () => {
    assert.deepEqual(parseLsofPids(""), []);
  });
});

describe("commandLineMatchesProductRoot", () => {
  const root = "D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter";

  it("matches a Windows command line that runs from the product", () => {
    assert.equal(
      commandLineMatchesProductRoot(
        "C:\\nvm4w\\nodejs\\node.exe D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\apps\\storefront\\node_modules\\next\\dist\\bin\\next start -p 8000",
        root,
      ),
      true,
    );
  });

  it("matches across slash styles and case", () => {
    assert.equal(
      commandLineMatchesProductRoot(
        "node D:/Jayami/Portfolio/products/Medusa-DTC-Starter/apps/backend/x.js",
        "d:\\jayami\\portfolio\\products\\medusa-dtc-starter",
      ),
      true,
    );
  });

  it("does not match a sibling folder that only shares the prefix", () => {
    assert.equal(
      commandLineMatchesProductRoot(
        "node D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter-old\\server.js",
        root,
      ),
      false,
    );
  });

  it("does not match an unrelated process (no match = do not kill)", () => {
    assert.equal(
      commandLineMatchesProductRoot("node D:\\other\\server.js", root),
      false,
    );
  });

  it("never matches when the command line or root is missing or empty", () => {
    assert.equal(commandLineMatchesProductRoot(undefined, root), false);
    assert.equal(commandLineMatchesProductRoot("", root), false);
    assert.equal(commandLineMatchesProductRoot("node server.js", ""), false);
  });
});
