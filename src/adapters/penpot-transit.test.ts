import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeTransit } from "./penpot-transit.js";

describe("decodeTransit", () => {
  it("decodes a map with keyword keys and a uuid value", () => {
    const wire = ["^ ", "~:id", "~u00000000-0000-0000-0000-000000000000", "~:email", "qa-owner@p4.test"];
    assert.deepEqual(decodeTransit(wire), { id: "00000000-0000-0000-0000-000000000000", email: "qa-owner@p4.test" });
  });

  it("decodes a list of maps", () => {
    const wire = [["^ ", "~:id", "~ua"], ["^ ", "~:id", "~ub"]];
    assert.deepEqual(decodeTransit(wire), [{ id: "a" }, { id: "b" }]);
  });

  it("returns plain values unchanged and unescapes a leading tilde", () => {
    assert.equal(decodeTransit("plain"), "plain");
    assert.equal(decodeTransit("~~literal"), "~literal");
    assert.equal(decodeTransit(42), 42);
  });
});
