import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIBRECHAT_TOOL_APPROVAL_INVALID,
  parseAllowAlwaysFlag,
  parseToolApprovalFlag,
  parseToolApprovalMode,
  parseToolApprovalRules,
  toolApprovalYamlLines,
} from "./librechat-approval.js";
import { librechatMcpServerFor, librechatYaml } from "./librechat-env.js";

const SERVERS = ["nextcloud", "twenty"];
const FIVE_NAMES = ["nextcloud", "outline", "twenty", "penpot", "mattermost"];

describe("H3 tool approval: flag and mode (off by default)", () => {
  it("is off when unset and on only for exactly 1", () => {
    assert.equal(parseToolApprovalFlag(""), false);
    assert.equal(parseToolApprovalFlag("1"), true);
  });
  it("rejects other flag values without echoing them", () => {
    for (const bad of ["zz-flag", "true", "yes", "zz-1 "]) {
      assert.throws(
        () => parseToolApprovalFlag(bad),
        (err: Error) => err.message.startsWith(LIBRECHAT_TOOL_APPROVAL_INVALID) && !err.message.includes("zz-"),
      );
    }
  });
  it("defaults the mode to default and accepts the three v0.8.9 modes", () => {
    assert.equal(parseToolApprovalMode(""), "default");
    for (const m of ["default", "dontAsk", "bypass"]) assert.equal(parseToolApprovalMode(m), m);
    assert.throws(() => parseToolApprovalMode("always"), /must be one of default, dontAsk, bypass/);
  });
});

describe("H3 tool approval: rules are mcp:<server>:<tool> with a configured server", () => {
  it("accepts globs and the wildcard server", () => {
    assert.deepEqual(parseToolApprovalRules("mcp:nextcloud:nc_mail_*, mcp:*:delete_*", SERVERS), ["mcp:nextcloud:nc_mail_*", "mcp:*:delete_*"]);
    assert.deepEqual(parseToolApprovalRules("", SERVERS), []);
  });
  it("drops duplicates", () => {
    assert.deepEqual(parseToolApprovalRules("mcp:twenty:a,mcp:twenty:a", SERVERS), ["mcp:twenty:a"]);
  });
  it("rejects a rule outside the form, naming the rule", () => {
    for (const bad of ["nextcloud:nc_mail", "mcp:nextcloud", "mcp:a:b:c", "mcp: nextcloud:x", "tool:x:y"]) {
      assert.throws(() => parseToolApprovalRules(bad, SERVERS), (err: Error) => err.message.includes(bad.trim()) && err.message.startsWith(LIBRECHAT_TOOL_APPROVAL_INVALID));
    }
  });
  it("rejects a server that is not in the configured MCP products", () => {
    assert.throws(() => parseToolApprovalRules("mcp:lab:*", SERVERS), /names server "lab", which is not in LIBRECHAT_MCP_PRODUCTS/);
  });
});

describe("H3 tool approval: librechat.yaml", () => {
  const servers = FIVE_NAMES.map((n) => librechatMcpServerFor(n));
  it("is byte-identical to the 0.6.4 YAML when the policy is off", () => {
    const off = librechatYaml({ models: ["p4-stub"], servers });
    assert.equal(librechatYaml({ models: ["p4-stub"], servers, toolApproval: null }), off);
    assert.ok(!off.includes("toolApproval"));
    assert.ok(!off.includes("agents:"));
  });
  it("writes endpoints.agents.toolApproval before endpoints.custom, with every key", () => {
    const y = librechatYaml({
      models: ["p4-stub"],
      servers,
      toolApproval: { mode: "dontAsk", allow: ["mcp:nextcloud:nc_mail_list_*"], deny: ["mcp:*:delete_*"], ask: ["mcp:*:*"] },
    });
    assert.match(y, /^endpoints:\n {2}agents:\n {4}toolApproval:\n {6}enabled: true\n {6}mode: dontAsk\n/m);
    assert.ok(y.includes('      allow: ["mcp:nextcloud:nc_mail_list_*"]'));
    assert.ok(y.includes('      deny: ["mcp:*:delete_*"]'));
    assert.ok(y.includes('      ask: ["mcp:*:*"]'));
    assert.ok(y.indexOf("toolApproval:") < y.indexOf("  custom:"), "toolApproval must come before the custom endpoint");
    assert.match(y, /^ {2}custom:$/m, "the LiteLLM custom endpoint stays");
  });
  it("writes empty lists as []", () => {
    assert.ok(toolApprovalYamlLines({ mode: "default", allow: [], deny: [], ask: [] }).includes("      ask: []"));
  });
});

describe("H3 tool approval: allowAlways (Always allow) is off by default and written only when true", () => {
  const servers = FIVE_NAMES.map((n) => librechatMcpServerFor(n));
  const base = { mode: "default" as const, allow: [], deny: ["mcp:*:delete_*"], ask: ["mcp:nextcloud:nc_contacts_list_addressbooks"] };

  it("parses the env value: unset is off, exactly 1 is on, anything else throws without echoing it", () => {
    assert.equal(parseAllowAlwaysFlag(""), false);
    assert.equal(parseAllowAlwaysFlag("1"), true);
    for (const bad of ["zz-always", "true", "yes", "0", "1 "]) {
      assert.throws(
        () => parseAllowAlwaysFlag(bad),
        (err: Error) => err.message.startsWith(LIBRECHAT_TOOL_APPROVAL_INVALID) && err.message.includes("LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS") && !err.message.includes("zz-"),
      );
    }
  });

  it("emits the same lines as before when allowAlways is absent or false", () => {
    const before = toolApprovalYamlLines(base);
    assert.deepEqual(toolApprovalYamlLines({ ...base, allowAlways: false }), before);
    assert.ok(!before.some((l) => l.includes("allowAlways")));
  });

  it("keeps the whole librechat.yaml byte-identical when allowAlways is false", () => {
    const withoutKey = librechatYaml({ models: ["p4-stub"], servers, toolApproval: base });
    const withFalse = librechatYaml({ models: ["p4-stub"], servers, toolApproval: { ...base, allowAlways: false } });
    assert.equal(withFalse, withoutKey);
    assert.ok(!withFalse.includes("allowAlways"));
  });

  it("emits allowAlways: true as the last key of endpoints.agents.toolApproval", () => {
    const y = librechatYaml({ models: ["p4-stub"], servers, toolApproval: { ...base, allowAlways: true } });
    assert.ok(y.includes("      ask: [\"mcp:nextcloud:nc_contacts_list_addressbooks\"]\n      allowAlways: true\n  custom:\n"), y);
    assert.equal(y.split("allowAlways").length - 1, 1, "the key is written once");
    assert.ok(y.indexOf("allowAlways: true") < y.indexOf("  custom:"), "the key sits inside endpoints, before endpoints.custom");
  });
});
