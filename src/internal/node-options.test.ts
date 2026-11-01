import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withHeapDefault } from "./node-options.js";

describe("withHeapDefault", () => {
  it("returns the default alone for unset, empty and blank input", () => {
    assert.equal(withHeapDefault(undefined, 8192), "--max-old-space-size=8192");
    assert.equal(withHeapDefault("", 8192), "--max-old-space-size=8192");
    assert.equal(withHeapDefault("   ", 8192), "--max-old-space-size=8192");
  });

  it("appends the default after the caller's flags", () => {
    assert.equal(withHeapDefault("--use-openssl-ca", 8192), "--use-openssl-ca --max-old-space-size=8192");
    assert.equal(withHeapDefault("  --use-openssl-ca  ", 7168), "--use-openssl-ca --max-old-space-size=7168");
  });

  it("keeps the caller's heap limit unchanged, with no second flag", () => {
    assert.equal(
      withHeapDefault("--use-openssl-ca --max-old-space-size=4096", 8192),
      "--use-openssl-ca --max-old-space-size=4096",
    );
    assert.equal(withHeapDefault("--max-old-space-size=4096", 8192), "--max-old-space-size=4096");
    assert.equal(withHeapDefault("--max_old_space_size=4096", 8192), "--max_old_space_size=4096");
  });

  it("does not mistake a longer flag name for the heap flag", () => {
    assert.equal(
      withHeapDefault("--max-old-space-size-foo", 8192),
      "--max-old-space-size-foo --max-old-space-size=8192",
    );
  });

  it("adds exactly one heap flag to any input without one", () => {
    for (const input of [undefined, "", "--use-openssl-ca", "--trace-warnings --use-openssl-ca"]) {
      const out = withHeapDefault(input, 8192);
      assert.equal(out.match(/--max-old-space-size=/g)?.length, 1, `input ${String(input)}`);
    }
  });
});
