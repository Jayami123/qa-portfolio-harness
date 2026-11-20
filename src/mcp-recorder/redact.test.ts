import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countLeakedValues, redactBody, redactHeaders, redactJson, redactText, REDACTED, sessionDigest } from "./redact.js";

// Fake secrets, planted in every place the recorder reads. None is a real credential.
const FAKE = {
  bearer: "fakebearer-abc123XYZ",
  basic: "dXNlcjpmYWtlLXBhc3M=",
  cookie: "sessfake-cookie-9876",
  apiKey: "fakeapikey-000111222",
  password: "fakepass-hunter2-zz",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fakesig_0123456789",
  session: "fakesession-idvalue-42",
  query: "fakequery-tok-7777",
};
const ALL_SECRETS = Object.values(FAKE);

describe("redactHeaders", () => {
  it("replaces credential headers and keeps ordinary ones", () => {
    const out = redactHeaders({
      authorization: `Bearer ${FAKE.bearer}`,
      cookie: `session=${FAKE.cookie}`,
      "set-cookie": `session=${FAKE.cookie}; Path=/`,
      "x-api-key": FAKE.apiKey,
      "x-auth-token": FAKE.bearer,
      "proxy-authorization": `Basic ${FAKE.basic}`,
      "content-type": "application/json",
      "user-agent": "undici",
    });
    assert.equal(out.authorization, REDACTED);
    assert.equal(out.cookie, REDACTED);
    assert.equal(out["set-cookie"], REDACTED);
    assert.equal(out["x-api-key"], REDACTED);
    assert.equal(out["x-auth-token"], REDACTED);
    assert.equal(out["proxy-authorization"], REDACTED);
    assert.equal(out["content-type"], "application/json");
    assert.equal(out["user-agent"], "undici");
  });
  it("replaces the MCP session id with a digest that is not the id", () => {
    const out = redactHeaders({ "mcp-session-id": FAKE.session });
    assert.equal(out["mcp-session-id"], sessionDigest(FAKE.session));
    assert.match(out["mcp-session-id"] ?? "", /^sha256:[0-9a-f]{8}$/);
    assert.equal(out["mcp-session-id"]?.includes(FAKE.session), false);
  });
  it("gives the same digest for the same session id, so requests can be matched", () => {
    assert.equal(sessionDigest("abc"), sessionDigest("abc"));
    assert.notEqual(sessionDigest("abc"), sessionDigest("abd"));
  });
  it("joins repeated header values and skips missing ones", () => {
    const out = redactHeaders({ accept: ["text/event-stream", "application/json"], "x-missing": undefined });
    assert.equal(out.accept, "text/event-stream, application/json");
    assert.equal("x-missing" in out, false);
  });
});

describe("redactText", () => {
  it("replaces Bearer, Basic and Token credentials", () => {
    assert.equal(redactText(`Bearer ${FAKE.bearer}`), `Bearer ${REDACTED}`);
    assert.equal(redactText(`Basic ${FAKE.basic}`), `Basic ${REDACTED}`);
    assert.equal(redactText(`Token ${FAKE.apiKey}`), `Token ${REDACTED}`);
  });
  it("replaces JWT-shaped strings", () => {
    assert.equal(redactText(`token is ${FAKE.jwt} done`), `token is ${REDACTED} done`);
  });
  it("replaces credential query parameters and keeps the rest of the path", () => {
    const out = redactText(`/mcp?token=${FAKE.query}&page=2`);
    assert.equal(out.includes(FAKE.query), false);
    assert.match(out, /page=2/);
  });
  it("replaces a Cookie or Authorization line", () => {
    assert.equal(redactText(`Cookie: session=${FAKE.cookie}; other=1`), `Cookie: ${REDACTED}`);
    assert.equal(redactText(`authorization: ${FAKE.bearer}`), `authorization: ${REDACTED}`);
  });
  it("replaces an unterminated quoted value to the end of the text", () => {
    const out = redactText(`{"password":"${FAKE.password.slice(0, 6)}`);
    assert.equal(out.includes(FAKE.password.slice(0, 6)), false);
  });
  it("leaves text without credentials unchanged", () => {
    const text = "tools/list returned 42 tools for the nc_webdav group";
    assert.equal(redactText(text), text);
  });
});

describe("redactJson and redactBody", () => {
  it("replaces values under credential-like keys at any depth", () => {
    const value = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "nc_mail_send", arguments: { password: FAKE.password, to: "a@example.test" }, apiKey: FAKE.apiKey },
      nested: [{ access_token: FAKE.bearer }],
    };
    const out = JSON.stringify(redactJson(value));
    assert.equal(out.includes(FAKE.password), false);
    assert.equal(out.includes(FAKE.apiKey), false);
    assert.equal(out.includes(FAKE.bearer), false);
    assert.match(out, /"method":"tools\/call"/);
    assert.match(out, /"to":"a@example.test"/);
  });
  it("redacts each data line of a server-sent event body", () => {
    const sse = `event: message\ndata: ${JSON.stringify({ result: { password: FAKE.password } })}\n\n`;
    const out = redactBody(sse, "text/event-stream");
    assert.equal(out.includes(FAKE.password), false);
    assert.match(out, /^event: message$/m);
  });
  it("redacts a JSON body by key, and a plain body by pattern", () => {
    const json = redactBody(JSON.stringify({ auth: { token: FAKE.bearer } }), "application/json");
    assert.equal(json.includes(FAKE.bearer), false);
    const text = redactBody(`note: Bearer ${FAKE.bearer}`, "text/plain");
    assert.equal(text.includes(FAKE.bearer), false);
  });
});

describe("leak check: fake secrets never survive redaction", () => {
  it("a recording built from requests and responses carrying every fake secret has zero leaks", () => {
    const headers = redactHeaders({
      authorization: `Bearer ${FAKE.bearer}`,
      cookie: `session=${FAKE.cookie}`,
      "x-api-key": FAKE.apiKey,
      "mcp-session-id": FAKE.session,
    });
    const body = redactBody(
      JSON.stringify({ params: { arguments: { password: FAKE.password, note: `Basic ${FAKE.basic}`, jwt: FAKE.jwt } } }),
      "application/json",
    );
    const path = redactText(`/mcp?token=${FAKE.query}`);
    const sse = redactBody(`event: message\ndata: {"result":{"api_key":"${FAKE.apiKey}"}}\n`, "text/event-stream");
    const line = JSON.stringify({ kind: "request", headers, body, path });
    const output = [line, sse].join("\n");
    assert.equal(countLeakedValues(output, ALL_SECRETS), 0);
  });
  it("countLeakedValues finds a planted value, and ignores values shorter than the minimum", () => {
    assert.equal(countLeakedValues(`x ${FAKE.bearer} y`, [FAKE.bearer]), 1);
    assert.equal(countLeakedValues("short abc value", ["abc"]), 0);
  });
});
