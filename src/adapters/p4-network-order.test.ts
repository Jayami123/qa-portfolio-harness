import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Regression guard for the CI failure "network qa-harness-p4 declared as external, but could not be found". Every Part A
 * adapter whose compose declares the external network must create it first, inside up(), before any compose call. The
 * test reads the source, so a future adapter that skips the call fails here.
 */
const ADAPTERS = ["nextcloud", "outline", "twenty", "penpot", "mattermost", "litellm", "librechat", "openclaw"];

describe("ensureP4Network runs before any compose call in up()", () => {
  for (const name of ADAPTERS) {
    it(`${name}.adapter.ts calls ensureP4Network() before its first composeUp()`, () => {
      const src = fs.readFileSync(path.resolve("src", "adapters", `${name}.adapter.ts`), "utf8");
      const upStart = src.indexOf("async up()");
      assert.ok(upStart >= 0, `${name}: up() not found`);
      const ensure = src.indexOf("await ensureP4Network()", upStart);
      const compose = src.indexOf("composeUp(", upStart);
      assert.ok(ensure >= 0, `${name}: up() does not call ensureP4Network()`);
      assert.ok(compose < 0 || ensure < compose, `${name}: composeUp runs before ensureP4Network`);
    });
  }
});
