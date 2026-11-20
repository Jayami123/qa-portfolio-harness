import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { librechatComposeFiles, librechatMcpServerFor, librechatYaml } from "./librechat-env.js";
import { LIBRECHAT_MCP_RECORDING_INVALID, MCP_RECORDER_ALIAS, MCP_RECORDER_PORT, parseMcpRecordingFlag, recordedServers, recorderRoutes } from "./librechat-recording.js";

const SERVERS = [librechatMcpServerFor("nextcloud"), librechatMcpServerFor("penpot")];

describe("H9 recording: flag (off by default)", () => {
  it("is off when unset and on only for exactly 1", () => {
    assert.equal(parseMcpRecordingFlag(""), false);
    assert.equal(parseMcpRecordingFlag("1"), true);
  });
  it("refuses other values without echoing them", () => {
    for (const bad of ["zz-rec", "true", "yes", "0", "1 "]) {
      assert.throws(
        () => parseMcpRecordingFlag(bad),
        (err: Error) => err.message.startsWith(LIBRECHAT_MCP_RECORDING_INVALID) && !err.message.includes("zz-"),
      );
    }
  });
});

describe("H9 recording: default-off output is unchanged", () => {
  it("the compose file list is the one file it was before H9", () => {
    assert.deepEqual(librechatComposeFiles(), [librechatComposeFiles(false)[0]]);
    assert.equal(librechatComposeFiles().length, 1);
    assert.match(librechatComposeFiles()[0] ?? "", /librechat\.compose\.yml$/);
  });
  it("the YAML written from the unrecorded servers names the servers' own hosts", () => {
    const yaml = librechatYaml({ models: ["p4-stub"], servers: SERVERS });
    assert.match(yaml, /url: http:\/\/nextcloud-mcp:8000\/mcp/);
    assert.match(yaml, /- "nextcloud-mcp"/);
    assert.equal(yaml.includes(MCP_RECORDER_ALIAS), false);
  });
});

describe("H9 recording: on", () => {
  it("adds the recorder compose file after the base file", () => {
    const files = librechatComposeFiles(true);
    assert.equal(files.length, 2);
    assert.match(files[1] ?? "", /librechat\.recording\.compose\.yml$/);
  });
  it("points each server at the recorder, keeping the server name and the original path", () => {
    const recorded = recordedServers(SERVERS);
    assert.deepEqual(
      recorded.map((s) => s.url),
      [`http://${MCP_RECORDER_ALIAS}:${MCP_RECORDER_PORT}/nextcloud/mcp`, `http://${MCP_RECORDER_ALIAS}:${MCP_RECORDER_PORT}/penpot/mcp`],
    );
    assert.deepEqual(recorded.map((s) => s.name), ["nextcloud", "penpot"]);
    assert.equal(recorded[0]?.authEnv, SERVERS[0]?.authEnv, "the credential variable is kept, so LibreChat still sends it");
  });
  it("the YAML then names only the recorder host in allowedDomains and the URLs", () => {
    const yaml = librechatYaml({ models: ["p4-stub"], servers: recordedServers(SERVERS) });
    assert.match(yaml, /url: http:\/\/mcp-recorder:9100\/nextcloud\/mcp/);
    assert.match(yaml, /- "mcp-recorder"/);
    assert.equal(yaml.includes("nextcloud-mcp:8000"), false);
  });
  it("builds the route list from the unrecorded origins", () => {
    assert.equal(recorderRoutes(SERVERS), "nextcloud=http://nextcloud-mcp:8000,penpot=http://penpot-mcp:4401");
  });
});
