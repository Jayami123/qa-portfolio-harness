import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openClawWriteConfigArgs, readyzIsReady } from "./openclaw-seed.js";

const IMAGE = "ghcr.io/openclaw/openclaw:2026.10.33-slim@sha256:" + "a".repeat(64);

describe("openclaw-seed (review answer 0.5)", () => {
  it("writes the config as uid 1000 with no network, and never passes the config as an argument", () => {
    const args = openClawWriteConfigArgs(IMAGE, "qa-harness-openclaw-state");
    assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.ok(args.includes("-i"), "stdin is the config");
    assert.ok(args.includes("qa-harness-openclaw-state:/home/node/.openclaw"));
    assert.ok(!args.some((a) => a.includes("chown")), "no chown: the volume is already owned by uid 1000");
    assert.ok(!args.some((a) => a === "root" || a === "0:0" || a === "0"), "never root");
    assert.ok(!args.some((a) => a.includes("gatewayToken") || a.includes("apiKey")), "no secret or config in argv");
  });

  it("reads /readyz only when ready is true", () => {
    assert.equal(readyzIsReady({ ready: true, coreReady: true }), true);
    assert.equal(readyzIsReady({ ready: false }), false);
    assert.equal(readyzIsReady(null), false);
  });
});
