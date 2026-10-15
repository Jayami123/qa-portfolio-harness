import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  medusaComposeRecordFile,
  parseMedusaComposeRecord,
  resolveMedusaComposeFiles,
  serializeMedusaComposeRecord,
} from "./medusa-compose-record.js";

const NO_REDIS = { redis: false, stripe: false };
const WITH_REDIS = { redis: true, stripe: false };

describe("medusaComposeRecordFile", () => {
  it("records under <root>/.harness/medusa-compose.json", () => {
    assert.equal(
      medusaComposeRecordFile("/repo"),
      path.join("/repo", ".harness", "medusa-compose.json"),
    );
  });
});

describe("serialize / parse medusa compose record", () => {
  it("round-trips the ordered file list", () => {
    const files = ["medusa.compose.yml", "medusa.redis.compose.yml"];
    assert.deepEqual(
      parseMedusaComposeRecord(serializeMedusaComposeRecord(files)),
      files,
    );
  });

  it("returns undefined for missing, unreadable, or malformed records", () => {
    assert.equal(parseMedusaComposeRecord(undefined), undefined);
    assert.equal(parseMedusaComposeRecord("not json"), undefined);
    assert.equal(parseMedusaComposeRecord("null"), undefined);
    assert.equal(parseMedusaComposeRecord('{"files":[]}'), undefined);
    assert.equal(parseMedusaComposeRecord('{"files":["ok.yml",3]}'), undefined);
    assert.equal(parseMedusaComposeRecord('{"other":true}'), undefined);
  });
});

describe("resolveMedusaComposeFiles", () => {
  it("prefers the recorded list over the current env", () => {
    const recorded = serializeMedusaComposeRecord([
      "medusa.compose.yml",
      "medusa.redis.compose.yml",
    ]);
    assert.deepEqual(resolveMedusaComposeFiles(recorded, NO_REDIS), [
      "medusa.compose.yml",
      "medusa.redis.compose.yml",
    ]);
  });

  it("falls back to the current env when there is no record", () => {
    assert.deepEqual(resolveMedusaComposeFiles(undefined, NO_REDIS), [
      "medusa.compose.yml",
    ]);
    assert.deepEqual(resolveMedusaComposeFiles(undefined, WITH_REDIS), [
      "medusa.compose.yml",
      "medusa.redis.compose.yml",
    ]);
  });

  it("falls back to the current env when the record is malformed", () => {
    assert.deepEqual(resolveMedusaComposeFiles("{broken", WITH_REDIS), [
      "medusa.compose.yml",
      "medusa.redis.compose.yml",
    ]);
  });
});
