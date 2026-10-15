import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import { MedusaAdapter } from "./medusa.adapter.js";

describe("MedusaAdapter already-healthy branch", () => {
  const realLog = console.log;
  const realWarn = console.warn;
  let logs: string[];
  let warns: string[];

  beforeEach(() => {
    logs = [];
    warns = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  it("starts the storefront and warns that Redis/Stripe changes need down first", async () => {
    const adapter = new MedusaAdapter({
      baseUrl: "http://localhost:9000",
    } as MedusaConfig);
    let storefrontStarts = 0;
    (
      adapter as unknown as { maybeStartStorefront: () => Promise<void> }
    ).maybeStartStorefront = async () => {
      storefrontStarts += 1;
    };

    await (
      adapter as unknown as {
        onAlreadyHealthy: (probe: {
          verdict: "healthy";
          status: { ok: true; url: string };
        }) => Promise<void>;
      }
    ).onAlreadyHealthy({
      verdict: "healthy",
      status: { ok: true, url: "http://127.0.0.1:9000/health" },
    });

    assert.equal(storefrontStarts, 1);
    assert.deepEqual(warns, [
      "Medusa already running; MEDUSA_REDIS/MEDUSA_STRIPE changes need `npm run down -- medusa` first.",
    ]);
    assert.ok(
      logs.some((line) =>
        line.startsWith(
          "Medusa already healthy at http://127.0.0.1:9000/health",
        ),
      ),
    );
  });
});
