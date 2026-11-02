import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { HARNESS_ROOT } from "../paths.js";
import { twentyServerReplicas } from "./twenty-replicas.js";

describe("twentyServerReplicas", () => {
  it("is one when unset, blank or exactly 1", () => {
    assert.equal(twentyServerReplicas({}), 1);
    assert.equal(twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "" }), 1);
    assert.equal(twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "  " }), 1);
    assert.equal(twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "1" }), 1);
  });

  it("is two only for exactly 2", () => {
    assert.equal(twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "2" }), 2);
  });

  it("rejects any other value, naming the variable", () => {
    assert.throws(() => twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "3" }), /TWENTY_SERVER_REPLICAS must be 1 or 2/);
    assert.throws(() => twentyServerReplicas({ TWENTY_SERVER_REPLICAS: "two" }), /TWENTY_SERVER_REPLICAS/);
  });
});

describe("docker/twenty.replicas.compose.yml", () => {
  const overlay = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "twenty.replicas.compose.yml"), "utf8");

  it("defines server-2 with migrations disabled and publishes on 127.0.0.1 only", () => {
    assert.match(overlay, /^ {2}server-2:$/m);
    assert.match(overlay, /DISABLE_DB_MIGRATIONS: "true"/);
    assert.match(overlay, /"127\.0\.0\.1:3003:3000"/);
    assert.doesNotMatch(overlay, /"3003:3000"/);
  });
});
