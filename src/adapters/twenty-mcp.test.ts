import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiKeyExpiry,
  CREATE_API_KEY,
  extractApiKeyToken,
  GENERATE_API_KEY_TOKEN,
  GET_API_KEY_ROLES,
  selectApiKeyRole,
  twentyMcpEnabled,
  twentyMcpUrl,
} from "./twenty-mcp.js";

describe("twentyMcpEnabled", () => {
  it("is on for exactly '1' and off for everything else", () => {
    assert.equal(twentyMcpEnabled({ TWENTY_MCP: "1" }), true);
    for (const value of [undefined, "", "true", "0", " 1", "1 ", "yes"]) {
      assert.equal(twentyMcpEnabled({ TWENTY_MCP: value }), false, JSON.stringify(value));
    }
  });
});

describe("selectApiKeyRole", () => {
  it("prefers a role that cannot change settings or update all records", () => {
    const roles = [
      { id: "a", label: "Admin", canUpdateAllSettings: true, canUpdateAllObjectRecords: true },
      { id: "b", label: "Impersonate-only", canUpdateAllSettings: false, canUpdateAllObjectRecords: false },
    ];
    assert.equal(selectApiKeyRole(roles).id, "b");
  });

  it("falls back to a role without settings access", () => {
    const roles = [
      { id: "a", label: "Admin", canUpdateAllSettings: true },
      { id: "c", label: "Object-restricted", canUpdateAllSettings: false, canUpdateAllObjectRecords: true },
    ];
    assert.equal(selectApiKeyRole(roles).id, "c");
  });

  it("throws, naming the labels and not the ids, when every role can change settings", () => {
    const roles = [{ id: "secret-id-123", label: "Admin", canUpdateAllSettings: true }];
    assert.throws(
      () => selectApiKeyRole(roles),
      (e: Error) => e.message.startsWith("TWENTY_MCP_ROLE_UNAVAILABLE") && e.message.includes("Admin") && !e.message.includes("secret-id-123"),
    );
  });
});

describe("apiKeyExpiry", () => {
  it("is deterministic for a fixed clock", () => {
    assert.equal(apiKeyExpiry(new Date("2026-11-18T00:00:00.000Z")), "2026-11-18T04:00:00.000Z");
    assert.equal(apiKeyExpiry(new Date("2026-11-18T00:00:00.000Z"), 1), "2026-11-18T01:00:00.000Z");
  });
});

describe("extractApiKeyToken", () => {
  it("returns the token from a good reply", () => {
    assert.equal(extractApiKeyToken({ data: { generateApiKeyToken: { token: "eyJ.abc" } } }), "eyJ.abc");
  });

  it("throws on a missing token or GraphQL errors, without echoing the body", () => {
    assert.throws(
      () => extractApiKeyToken({ data: null, errors: [{ message: "SHOULD_NOT_APPEAR" }] }),
      (e: Error) => e.message.startsWith("TWENTY_MCP_TOKEN_MISSING") && !e.message.includes("SHOULD_NOT_APPEAR"),
    );
    assert.throws(() => extractApiKeyToken({ data: { generateApiKeyToken: { token: "" } } }), /TWENTY_MCP_TOKEN_MISSING/);
  });
});

describe("twenty-mcp documents and url", () => {
  it("builds the /mcp url from the base url", () => {
    assert.equal(twentyMcpUrl("http://127.0.0.1:3002"), "http://127.0.0.1:3002/mcp");
  });

  it("are non-empty GraphQL documents", () => {
    for (const doc of [GET_API_KEY_ROLES, CREATE_API_KEY, GENERATE_API_KEY_TOKEN]) {
      assert.match(doc, /^(query|mutation) /);
    }
  });
});
