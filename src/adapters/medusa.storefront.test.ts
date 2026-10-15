import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import { MedusaAdapter } from "./medusa.adapter.js";

type StorefrontProbe = { maybeStartStorefront: () => Promise<void> };

describe("MedusaAdapter storefront probe", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const savedSkip = process.env.MEDUSA_SKIP_STOREFRONT;
  let logs: string[];

  function adapterWithSpies(storefrontUrl = "http://127.0.0.1:8000") {
    const adapter = new MedusaAdapter({
      baseUrl: "http://127.0.0.1:9000",
      storefrontUrl,
    } as MedusaConfig);
    const calls = { build: 0, start: 0, key: 0, wait: 0 };
    const hooks = adapter as unknown as StorefrontProbe &
      Record<string, unknown>;
    hooks.ensureStorefrontBuild = async () => {
      calls.build += 1;
    };
    hooks.startStorefront = () => {
      calls.start += 1;
    };
    hooks.resolvePublishableKeyForStorefront = async () => {
      calls.key += 1;
      return "pk_test_fixture";
    };
    hooks.waitForStorefrontReady = async () => {
      calls.wait += 1;
    };
    return { adapter, calls };
  }

  beforeEach(() => {
    delete process.env.MEDUSA_SKIP_STOREFRONT;
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    if (savedSkip === undefined) delete process.env.MEDUSA_SKIP_STOREFRONT;
    else process.env.MEDUSA_SKIP_STOREFRONT = savedSkip;
  });

  it("skips next build and start when /dk already answers 200", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), "http://127.0.0.1:8000/dk");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { adapter, calls } = adapterWithSpies();

    await (adapter as unknown as StorefrontProbe).maybeStartStorefront();

    assert.equal(calls.build, 0);
    assert.equal(calls.start, 0);
    assert.equal(calls.key, 0);
    assert.equal(calls.wait, 0);
    assert.ok(logs.some((line) => line.includes("storefront already running")));
  });

  it("rejects an invalid storefront listen URL before probing, even if /dk would answer 200", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { adapter, calls } = adapterWithSpies("http://localhost:8000");

    await assert.rejects(
      (adapter as unknown as StorefrontProbe).maybeStartStorefront(),
      /127\.0\.0\.1/,
    );

    assert.equal(fetched, 0);
    assert.equal(calls.build, 0);
    assert.equal(calls.start, 0);
  });

  it("builds and starts when /dk is not answering", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { adapter, calls } = adapterWithSpies();
    const storefront = adapter as unknown as {
      isPortOpen: () => Promise<boolean>;
    };
    storefront.isPortOpen = async () => false;

    await (adapter as unknown as StorefrontProbe).maybeStartStorefront();

    assert.equal(calls.build, 1);
    assert.equal(calls.start, 1);
    assert.equal(calls.wait, 1);
    assert.equal(
      logs.some((line) => line.includes("already running")),
      false,
    );
  });
});
