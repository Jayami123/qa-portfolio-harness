import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  ContainerExitedError,
  captureContainerLogs,
  failIfContainerExited,
  inspectContainerState,
  readinessDiagnosticCommands,
  redactSecrets,
  type DockerRunner,
} from "./readiness-diagnostics.js";

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

describe("redactSecrets", () => {
  it("hides secret-looking values and keeps the names", () => {
    const out = redactSecrets(
      [
        "APP_SECRET=abc123",
        "DATABASE_PASSWORD='hunter2 x'",
        '{"api_key": "sk-live-1", "port": 3000}',
        "Authorization: Bearer abcdef123456",
        "postgres://user:pw@db:5432/app",
        "token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig123",
        "listening on port 3000",
      ].join("\n"),
    );
    for (const leaked of ["abc123", "hunter2", "sk-live-1", "abcdef123456", ":pw@", "eyJhbGci"]) {
      assert.ok(!out.includes(leaked), `leaked ${leaked}`);
    }
    assert.match(out, /APP_SECRET=\*\*\*/);
    assert.match(out, /"port": 3000/);
    assert.match(out, /listening on port 3000/);
  });
});

describe("captureContainerLogs", () => {
  it("runs docker logs --tail 200 and redacts the output", () => {
    const calls: string[][] = [];
    const docker: DockerRunner = (args) => {
      calls.push(args);
      return { status: 0, stdout: "boot ok\nJWT_SECRET=topsecret\n", stderr: "ERR token=zzz999\n" };
    };
    const text = captureContainerLogs("qa-harness-x-1", docker);
    assert.deepEqual(calls, [["logs", "--tail", "200", "qa-harness-x-1"]]);
    assert.match(text, /boot ok/);
    assert.ok(!text.includes("topsecret") && !text.includes("zzz999"));
  });

  it("says so when there is no output", () => {
    assert.match(captureContainerLogs("c", () => ({ status: 1, stdout: "", stderr: "" })), /no log output/);
  });
});

describe("inspectContainerState", () => {
  it("parses ExitCode and OOMKilled of an exited container", () => {
    const calls: string[][] = [];
    const state = inspectContainerState("c1", (args) => {
      calls.push(args);
      return { status: 0, stdout: "exited 137 true\n", stderr: "" };
    });
    assert.deepEqual(state, { container: "c1", status: "exited", exited: true, exitCode: 137, oomKilled: true });
    assert.equal(calls[0]?.[0], "inspect");
    assert.match(calls[0]?.join(" ") ?? "", /ExitCode/);
    assert.match(calls[0]?.join(" ") ?? "", /OOMKilled/);
  });

  it("returns undefined when docker inspect fails", () => {
    assert.equal(inspectContainerState("gone", () => ({ status: 1, stdout: "", stderr: "No such object" })), undefined);
  });
});

describe("failIfContainerExited", () => {
  const stub =
    (inspect: string): DockerRunner =>
    (args) =>
      args[0] === "inspect"
        ? { status: 0, stdout: inspect, stderr: "" }
        : { status: 0, stdout: "last line PASSWORD=pw1\n", stderr: "" };

  it("throws with name, exit code and OOMKilled when the container exited", () => {
    const logs = mock.method(console, "log", () => undefined);
    try {
      assert.throws(
        () => failIfContainerExited("qa-harness-app-1", "http://127.0.0.1:1/", stub("exited 137 true")),
        (error: unknown) =>
          error instanceof ContainerExitedError &&
          /qa-harness-app-1/.test(error.message) &&
          /exit code 137/.test(error.message) &&
          /OOMKilled true/.test(error.message),
      );
      const printed = logs.mock.calls.map((c) => String(c.arguments[0])).join("\n");
      assert.match(printed, /last line PASSWORD=\*\*\*/);
      assert.ok(!printed.includes("pw1"));
    } finally {
      logs.mock.restore();
    }
  });

  it("does nothing while the container runs or cannot be inspected", () => {
    failIfContainerExited("c", "http://x/", stub("running 0 false"));
    failIfContainerExited("c", "http://x/", () => ({ status: 1, stdout: "", stderr: "" }));
  });
});
