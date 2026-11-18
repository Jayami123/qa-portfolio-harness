import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readinessDiagnosticCommands } from "./readiness-diagnostics.js";

describe("readinessDiagnosticCommands", () => {
  const cmds = readinessDiagnosticCommands({
    url: "http://127.0.0.1:8080/status.php",
    container: "qa-harness-nextcloud-app-1",
  });

  it("prints docker ps for the run, the app port map, the listener and the runner's HTTP status", () => {
    assert.equal(cmds.length, 4);
    assert.deepEqual(cmds[0]?.argv.slice(0, 3), ["docker", "ps", "-a"]);
    assert.deepEqual(cmds[1]?.argv, ["docker", "port", "qa-harness-nextcloud-app-1"]);
    assert.match(cmds[2]?.argv.join(" ") ?? "", /ss -ltnp \| grep 8080/);
    assert.ok(cmds[3]?.argv.includes("%{http_code}"));
    assert.equal(cmds[3]?.argv.at(-1), "http://127.0.0.1:8080/status.php");
  });

  it("uses the port from the URL, not a fixed one", () => {
    const other = readinessDiagnosticCommands({ url: "http://127.0.0.1:9001/x", container: "c" });
    assert.match(other[2]?.argv.join(" ") ?? "", /grep 9001/);
  });
});
