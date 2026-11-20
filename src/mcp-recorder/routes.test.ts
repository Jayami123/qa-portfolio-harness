import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchRoute, MCP_RECORDER_CONFIG, parseRecorderRoutes } from "./routes.js";

describe("parseRecorderRoutes", () => {
  it("parses name=origin pairs", () => {
    const routes = parseRecorderRoutes("nextcloud=http://nextcloud-mcp:8000, lab2=http://p4-attack-lab-2:9011");
    assert.deepEqual(
      routes.map((r) => [r.name, r.origin, r.hostname, r.port]),
      [
        ["nextcloud", "http://nextcloud-mcp:8000", "nextcloud-mcp", 8000],
        ["lab2", "http://p4-attack-lab-2:9011", "p4-attack-lab-2", 9011],
      ],
    );
  });
  it("uses the default port for http and https", () => {
    const [a, b] = parseRecorderRoutes("a=http://x.test,b=https://y.test");
    assert.equal(a?.port, 80);
    assert.equal(b?.port, 443);
  });
  it("refuses an empty list", () => {
    assert.throws(() => parseRecorderRoutes("  , "), new RegExp(MCP_RECORDER_CONFIG));
  });
  it("refuses a bad route name, a duplicate and a missing name", () => {
    assert.throws(() => parseRecorderRoutes("Bad_Name=http://x.test"), /must be lowercase/);
    assert.throws(() => parseRecorderRoutes("a=http://x.test,a=http://y.test"), /listed twice/);
    assert.throws(() => parseRecorderRoutes("=http://x.test"), /name=origin/);
  });
  it("refuses an upstream with credentials, and never prints it", () => {
    const secretish = "fakeuser:fakepass-hunter2-zz";
    assert.throws(
      () => parseRecorderRoutes(`a=http://${secretish}@x.test:8000`),
      (err: Error) => {
        assert.match(err.message, /must not carry credentials/);
        assert.equal(err.message.includes("hunter2"), false);
        return true;
      },
    );
  });
  it("refuses a path, a query, a fragment and a non-http scheme", () => {
    assert.throws(() => parseRecorderRoutes("a=http://x.test/mcp"), /origin only/);
    assert.throws(() => parseRecorderRoutes("a=http://x.test?t=1"), /origin only/);
    assert.throws(() => parseRecorderRoutes("a=ftp://x.test"), /http or https/);
  });
  it("refuses an invalid URL without echoing it", () => {
    assert.throws(
      () => parseRecorderRoutes("a=not a url fakepass-hunter2"),
      (err: Error) => {
        assert.match(err.message, /invalid upstream URL/);
        assert.equal(err.message.includes("hunter2"), false);
        return true;
      },
    );
  });
});

describe("matchRoute", () => {
  const routes = parseRecorderRoutes("nextcloud=http://nextcloud-mcp:8000,outline=http://outline:3000");
  it("strips the route name and keeps the rest of the path", () => {
    const m = matchRoute(routes, "/nextcloud/mcp");
    assert.equal(m?.route.name, "nextcloud");
    assert.equal(m?.upstreamPath, "/mcp");
  });
  it("maps the bare route to /", () => {
    assert.equal(matchRoute(routes, "/outline")?.upstreamPath, "/");
  });
  it("does not match a name that is only a prefix of another", () => {
    assert.equal(matchRoute(routes, "/nextcloud-mcp/mcp"), null);
  });
  it("returns null for an unknown route", () => {
    assert.equal(matchRoute(routes, "/unknown/mcp"), null);
  });
});
