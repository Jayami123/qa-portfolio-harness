// H6 for LibreChat: the Penpot owner's token reaches LibreChat through its URL. Every value here is a fake sentinel. The tests
// check the placeholder, the yaml, the env wiring, the fail-closed reader, the recorder's query and the redaction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactText as recorderRedact } from "../mcp-recorder/redact.js";
import { EXPAND_ENV_FN, probeArgs, redactText, redactUserTokenQuery, serversFor } from "./librechat-diag.js";
import { librechatMcpServerFor, librechatMcpServerForRun, librechatYaml, PENPOT_MCP_USER_TOKEN_ENV } from "./librechat-env.js";
import { assertPenpotUserTokenShape, librechatMcpEnv } from "./librechat-seed.js";
import { recordedServers, recorderRoutes } from "./librechat-recording.js";
import { ownerTokenForLibreChat, PENPOT_OWNER_TOKEN_MISSING, pluginStateFileName } from "./penpot-plugin.js";

const SENTINEL = "SENTINEL-OWNER-TOKEN-0123456789";
const PLACEHOLDER = "${P4_PENPOT_MCP_USER_TOKEN}";
const noRead = () => ({ mcpAuthorization: null });

describe("librechatMcpServerFor(penpot) with the H6 token URL", () => {
  it("is unchanged when the option is absent or false (single-user default)", () => {
    const plain = { name: "penpot", url: "http://penpot-mcp:4401/mcp", authEnv: null };
    assert.deepEqual(librechatMcpServerFor("penpot"), plain);
    assert.deepEqual(librechatMcpServerForRun("penpot", { penpotPlugin: false }), plain);
  });

  it("carries the placeholder in the URL, never a value, and names the env var", () => {
    const s = librechatMcpServerForRun("penpot", { penpotPlugin: true });
    assert.equal(s?.url, `http://penpot-mcp:4401/mcp?userToken=${PLACEHOLDER}`);
    assert.equal(s?.urlTokenEnv, PENPOT_MCP_USER_TOKEN_ENV);
    assert.equal(s.authEnv, null);
  });

  it("does not change the other products", () => {
    assert.deepEqual(librechatMcpServerForRun("nextcloud", { penpotPlugin: true }), librechatMcpServerFor("nextcloud"));
  });
});

describe("librechatYaml with the H6 token URL", () => {
  it("writes the placeholder, quoted, and no token value", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: [librechatMcpServerForRun("penpot", { penpotPlugin: true })] });
    assert.ok(y.includes(`    url: "http://penpot-mcp:4401/mcp?userToken=${PLACEHOLDER}"`), y);
    assert.doesNotMatch(y, /userToken=(?!\$\{P4_PENPOT_MCP_USER_TOKEN\})/);
    assert.doesNotMatch(y, /headers:/);
    assert.doesNotMatch(y, new RegExp(SENTINEL));
  });

  it("keeps the default penpot entry byte-identical (no quotes, no token)", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: [librechatMcpServerFor("penpot")] });
    assert.ok(y.includes("\n    url: http://penpot-mcp:4401/mcp\n"), y);
    assert.doesNotMatch(y, /userToken/);
  });

  it("allows penpot-mcp in mcpSettings.allowedDomains with the token URL", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers: [librechatMcpServerForRun("penpot", { penpotPlugin: true })] });
    assert.match(y, /allowedDomains:\n {4}- "penpot-mcp"/);
  });

  it("refuses a token declaration whose URL has no placeholder (fail closed, nothing written)", () => {
    const bad = { name: "penpot", url: "http://penpot-mcp:4401/mcp", authEnv: null, urlTokenEnv: "P4_PENPOT_MCP_USER_TOKEN" };
    assert.throws(() => librechatYaml({ models: ["p4-stub"], servers: [bad] }), /LIBRECHAT_URL_TOKEN_MISSING/);
  });
});

describe("librechatMcpEnv with the owner token", () => {
  it("puts the token in the env map and the placeholder in the server", () => {
    const { servers, env } = librechatMcpEnv(["penpot"], noRead, undefined, null, { ownerToken: SENTINEL });
    assert.equal(servers[0]?.url, `http://penpot-mcp:4401/mcp?userToken=${PLACEHOLDER}`);
    assert.deepEqual(env, { [PENPOT_MCP_USER_TOKEN_ENV]: SENTINEL });
    assert.doesNotMatch(servers[0]?.url, new RegExp(SENTINEL));
  });

  it("writes no token when the owner option is absent (default)", () => {
    const { servers, env } = librechatMcpEnv(["penpot"], noRead);
    assert.deepEqual(env, {});
    assert.equal(servers[0]?.url, "http://penpot-mcp:4401/mcp");
  });

  it("refuses a token outside the URL-safe set without echoing it", () => {
    const bad = "bad token/with spaces";
    assert.throws(() => assertPenpotUserTokenShape(bad), (e: Error) => {
      assert.match(e.message, /^harness: LIBRECHAT_PENPOT_TOKEN_SHAPE/);
      assert.doesNotMatch(e.message, /bad token|spaces/);
      return true;
    });
    assert.doesNotThrow(() => assertPenpotUserTokenShape("ab.CD_ef~12-34"));
  });
});

describe("ownerTokenForLibreChat (fail closed)", () => {
  const state = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ version: 1, role: "owner", email: "x", fileName: "h6-owner-file", mcpToken: SENTINEL, ...overrides });

  it("returns the owner's token when the tabs are ready and the state is valid", () => {
    assert.equal(ownerTokenForLibreChat(true, true, state()), SENTINEL);
  });

  it("fails with a harness: error when the tabs are not ready", () => {
    assert.throws(() => ownerTokenForLibreChat(false, true, state()), (e: Error) => {
      assert.match(e.message, new RegExp(`^harness: ${PENPOT_OWNER_TOKEN_MISSING}: the Penpot tabs are not ready`));
      assert.doesNotMatch(e.message, new RegExp(SENTINEL));
      return true;
    });
  });

  it("fails with a harness: error when the owner's state file is missing", () => {
    assert.throws(() => ownerTokenForLibreChat(true, true, undefined), /^Error: harness: LIBRECHAT_PENPOT_TOKEN_MISSING: the owner's Penpot tab state is missing/);
  });

  it("fails without echoing the file when its token is empty or the shape is wrong", () => {
    for (const text of [state({ mcpToken: "" }), state({ role: "second" }), "not json " + SENTINEL]) {
      assert.throws(() => ownerTokenForLibreChat(true, true, text), (e: Error) => {
        assert.match(e.message, /^harness: LIBRECHAT_PENPOT_TOKEN_MISSING: the owner's Penpot tab state is unreadable \(content not printed\)/);
        assert.doesNotMatch(e.message, new RegExp(SENTINEL));
        return true;
      });
    }
  });

  it("names the owner's state file by its role", () => {
    assert.equal(pluginStateFileName("owner"), "penpot-plugin-owner.json");
  });
});

describe("token redaction in diag output", () => {
  it("hides a userToken query value even when it is not in the env values", () => {
    const line = `GET http://penpot-mcp:4401/mcp?userToken=${SENTINEL} failed`;
    const out = redactText(line, []);
    assert.doesNotMatch(out, new RegExp(SENTINEL));
    assert.match(out, /\?userToken=\[REDACTED\] failed/);
  });

  it("hides a token in the middle of a query, and leaves the rest of the line", () => {
    assert.equal(redactUserTokenQuery(`x?a=1&userToken=${SENTINEL}&b=2`), "x?a=1&userToken=[REDACTED]&b=2");
  });

  it("still applies the env-value redaction", () => {
    assert.equal(redactText(`value ${SENTINEL} here`, [SENTINEL]), "value *** here");
  });

  it("the recorder redacts the same query in its path log", () => {
    const out = recorderRedact(`/mcp?userToken=${SENTINEL}`);
    assert.doesNotMatch(out, new RegExp(SENTINEL));
  });
});

describe("the probe never receives a token value", () => {
  it("passes only the placeholder and the env var name in its argv", () => {
    const args = probeArgs(serversFor(["penpot"], { penpotPlugin: true }));
    const argv = args.join("\n");
    assert.ok(argv.includes(PLACEHOLDER));
    assert.ok(argv.includes(PENPOT_MCP_USER_TOKEN_ENV));
    assert.doesNotMatch(argv, new RegExp(SENTINEL));
  });

  it("expands the placeholder from the environment, and leaves an unset name as written", () => {
    const expandEnv = new Function(`${EXPAND_ENV_FN}\nreturn expandEnv;`)() as (text: string) => string;
    const name = "P4_TEST_PROBE_TOKEN_XYZ";
    process.env[name] = SENTINEL;
    try {
      assert.equal(expandEnv(`http://h/mcp?userToken=\${${name}}`), `http://h/mcp?userToken=${SENTINEL}`);
    } finally {
      delete process.env[name];
    }
    assert.equal(expandEnv("http://h/mcp?userToken=${P4_TEST_PROBE_UNSET_XYZ}"), "http://h/mcp?userToken=${P4_TEST_PROBE_UNSET_XYZ}");
  });
});

describe("recorder routes keep the token query (H6)", () => {
  it("keeps the placeholder query on the recorded URL", () => {
    const s = recordedServers([librechatMcpServerForRun("penpot", { penpotPlugin: true })])[0];
    assert.equal(s?.url, `http://mcp-recorder:9100/penpot/mcp?userToken=${PLACEHOLDER}`);
    assert.equal(s?.urlTokenEnv, PENPOT_MCP_USER_TOKEN_ENV);
  });

  it("leaves the default penpot route as before (no query)", () => {
    const s = recordedServers([librechatMcpServerFor("penpot")])[0];
    assert.equal(s?.url, "http://mcp-recorder:9100/penpot/mcp");
  });

  it("MCP_RECORDER_ROUTES holds origins only, never a query or a token", () => {
    const routes = recorderRoutes([librechatMcpServerForRun("penpot", { penpotPlugin: true })]);
    assert.equal(routes, "penpot=http://penpot-mcp:4401");
    assert.doesNotMatch(routes, /userToken|\$\{/);
  });
});

describe("ownerTokenForLibreChat when the tab host is gone", () => {
  it("refuses a token left on disk by a host that is no longer running", () => {
    const text = JSON.stringify({ version: 1, role: "owner", fileName: "h6-owner-file", mcpToken: SENTINEL });
    assert.throws(() => ownerTokenForLibreChat(true, false, text), (e: Error) => {
      assert.match(e.message, /^harness: LIBRECHAT_PENPOT_TOKEN_MISSING: the Penpot tab host is not running/);
      assert.doesNotMatch(e.message, new RegExp(SENTINEL));
      return true;
    });
  });
});
