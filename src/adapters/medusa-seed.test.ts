import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import {
  ensureCustomer,
  ensureFeaturedCollection,
  ensureGermanWarehouse,
  type MedusaSeedContext,
} from "./medusa-seed.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const PUBLISHABLE_KEY = "pk_test_do_not_log";
const PASSWORD = "seed-pass-do-not-log";

function ctxFor(): MedusaSeedContext {
  return {
    cfg: { baseUrl: "http://localhost:9000" } as MedusaConfig,
    switches: { redis: false, stripe: false },
    authorizationHeader: "Bearer admin-jwt",
    backendDir: "unused",
    processEnv: {},
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(responses: Array<() => Response>): Call[] {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses[index++];
    if (next === undefined) {
      throw new Error(`unexpected fetch ${String(input)}`);
    }
    return next();
  }) as typeof fetch;
  return calls;
}

function jwtWithActor(actorId: string): string {
  const payload = Buffer.from(JSON.stringify({ actor_id: actorId })).toString(
    "base64url",
  );
  return `header.${payload}.signature`;
}

function mockRouter(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: {},
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

const BASE = "http://localhost:9000/admin";

describe("ensureGermanWarehouse (existing warehouse)", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;

  beforeEach(() => {
    console.log = () => {};
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
  });

  function handler(
    salesChannels: Array<{ id: string }>,
    items: Array<Record<string, unknown>>,
  ) {
    return (call: Call): Response => {
      if (call.url === `${BASE}/stock-locations?limit=50`) {
        return jsonResponse(200, {
          stock_locations: [{ id: "loc_1", name: "German Warehouse" }],
        });
      }
      if (call.url === `${BASE}/sales-channels?limit=20`) {
        return jsonResponse(200, { sales_channels: [{ id: "sc_1" }] });
      }
      if (call.url === `${BASE}/stock-locations/loc_1?fields=*sales_channels`) {
        return jsonResponse(200, {
          stock_location: { id: "loc_1", sales_channels: salesChannels },
        });
      }
      if (call.url.startsWith(`${BASE}/inventory-items?`)) {
        return jsonResponse(200, { inventory_items: items });
      }
      return jsonResponse(200, {});
    };
  }

  it("attaches the missing sales-channel link and only the missing inventory levels", async () => {
    const notes: string[] = [];
    const calls = mockRouter(
      handler(
        [],
        [
          { id: "iitem_1", location_levels: [{ location_id: "loc_1" }] },
          { id: "iitem_2", location_levels: [] },
          { id: "iitem_3" },
        ],
      ),
    );

    await ensureGermanWarehouse(ctxFor(), notes);

    const posts = calls.filter((call) => call.method === "POST");
    assert.deepEqual(
      posts.map((call) => call.url),
      [
        `${BASE}/stock-locations/loc_1/sales-channels`,
        `${BASE}/inventory-items/iitem_2/location-levels`,
        `${BASE}/inventory-items/iitem_3/location-levels`,
      ],
    );
    assert.deepEqual(posts[0]?.body, { add: ["sc_1"] });
    assert.deepEqual(posts[1]?.body, {
      location_id: "loc_1",
      stocked_quantity: 1_000_000,
    });
    assert.deepEqual(notes, [
      "German Warehouse sales channel linked.",
      "German Warehouse inventory levels linked.",
    ]);
  });

  it("skips everything when the warehouse is already fully linked", async () => {
    const notes: string[] = [];
    const calls = mockRouter(
      handler(
        [{ id: "sc_1" }],
        [{ id: "iitem_1", location_levels: [{ location_id: "loc_1" }] }],
      ),
    );

    await ensureGermanWarehouse(ctxFor(), notes);

    assert.deepEqual(
      calls.filter((call) => call.method === "POST"),
      [],
    );
    assert.deepEqual(notes, []);
  });
});

describe("ensureFeaturedCollection (existing collection)", () => {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const seeded = ["prod_1", "prod_2", "prod_3", "prod_4"];

  beforeEach(() => {
    console.log = () => {};
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
  });

  function handler(linked: string[]) {
    return (call: Call): Response => {
      if (call.url === `${BASE}/collections?limit=50`) {
        return jsonResponse(200, {
          collections: [{ id: "col_1", title: "Featured" }],
        });
      }
      if (call.url === `${BASE}/products?limit=20`) {
        return jsonResponse(200, { products: seeded.map((id) => ({ id })) });
      }
      if (call.url.startsWith(`${BASE}/products?collection_id=col_1`)) {
        return jsonResponse(200, { products: linked.map((id) => ({ id })) });
      }
      return jsonResponse(200, {});
    };
  }

  it("ends with all four products when the existing collection has none linked", async () => {
    const notes: string[] = [];
    const calls = mockRouter(handler([]));

    await ensureFeaturedCollection(ctxFor(), notes);

    const posts = calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, `${BASE}/collections/col_1/products`);
    assert.deepEqual(posts[0]?.body, { add: seeded });
    assert.deepEqual(notes, [
      "Collection Featured linked 4 missing product(s).",
    ]);
  });

  it("attaches only the products that are missing", async () => {
    const calls = mockRouter(handler(["prod_1", "prod_3"]));

    await ensureFeaturedCollection(ctxFor(), []);

    const posts = calls.filter((call) => call.method === "POST");
    assert.deepEqual(posts[0]?.body, { add: ["prod_2", "prod_4"] });
  });

  it("does nothing when all four are already linked", async () => {
    const notes: string[] = [];
    const calls = mockRouter(handler(seeded));

    await ensureFeaturedCollection(ctxFor(), notes);

    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
    assert.deepEqual(notes, []);
  });
});

describe("ensureCustomer", () => {
  const realFetch = globalThis.fetch;
  const savedEnv = {
    email: process.env.MEDUSA_SEED_CUSTOMER_EMAIL,
    password: process.env.MEDUSA_SEED_CUSTOMER_PASSWORD,
  };
  let logs: string[];
  const realLog = console.log;

  beforeEach(() => {
    delete process.env.MEDUSA_SEED_CUSTOMER_EMAIL;
    process.env.MEDUSA_SEED_CUSTOMER_PASSWORD = PASSWORD;
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    if (savedEnv.email === undefined)
      delete process.env.MEDUSA_SEED_CUSTOMER_EMAIL;
    else process.env.MEDUSA_SEED_CUSTOMER_EMAIL = savedEnv.email;
    if (savedEnv.password === undefined)
      delete process.env.MEDUSA_SEED_CUSTOMER_PASSWORD;
    else process.env.MEDUSA_SEED_CUSTOMER_PASSWORD = savedEnv.password;
  });

  it("registers through the store auth flow, then creates the store customer with the token", async () => {
    const notes: string[] = [];
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [] }),
      () => jsonResponse(200, { token: "register-token" }),
      () => jsonResponse(200, { customer: { id: "cus_1" } }),
    ]);

    await ensureCustomer(ctxFor(), notes, PUBLISHABLE_KEY);

    assert.equal(calls.length, 3);
    assert.equal(
      calls[0]?.url,
      "http://localhost:9000/admin/customers?limit=50",
    );
    assert.equal(calls[0]?.method, "GET");

    assert.equal(
      calls[1]?.url,
      "http://localhost:9000/auth/customer/emailpass/register",
    );
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(calls[1]?.body, {
      email: "customer@test.com",
      password: PASSWORD,
    });

    assert.equal(calls[2]?.url, "http://localhost:9000/store/customers");
    assert.equal(calls[2]?.method, "POST");
    assert.equal(calls[2]?.headers.Authorization, "Bearer register-token");
    assert.equal(calls[2]?.headers["x-publishable-api-key"], PUBLISHABLE_KEY);
    assert.deepEqual(calls[2]?.body, {
      email: "customer@test.com",
      first_name: "QA",
      last_name: "Customer",
    });

    assert.deepEqual(notes, ["Customer customer@test.com created."]);
  });

  it("never logs the password or the publishable key", async () => {
    mockFetch([
      () => jsonResponse(200, { customers: [] }),
      () => jsonResponse(200, { token: "register-token" }),
      () => jsonResponse(200, { customer: { id: "cus_1" } }),
    ]);

    await ensureCustomer(ctxFor(), [], PUBLISHABLE_KEY);

    const output = logs.join("\n");
    assert.equal(output.includes(PASSWORD), false);
    assert.equal(output.includes(PUBLISHABLE_KEY), false);
  });

  it("skips without creating when the customer already exists in admin", async () => {
    const notes: string[] = [];
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [{ email: "customer@test.com" }] }),
    ]);

    await ensureCustomer(ctxFor(), notes, PUBLISHABLE_KEY);

    assert.equal(calls.length, 1);
    assert.deepEqual(notes, []);
  });

  const alreadyExists = () =>
    jsonResponse(400, {
      type: "invalid_data",
      message: "Identity with email already exists",
    });

  it("logs in when the identity already exists and skips when the customer profile exists", async () => {
    const notes: string[] = [];
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [] }),
      alreadyExists,
      () => jsonResponse(200, { token: jwtWithActor("cus_existing") }),
    ]);

    await ensureCustomer(ctxFor(), notes, PUBLISHABLE_KEY);

    assert.equal(calls.length, 3);
    assert.equal(
      calls[2]?.url,
      "http://localhost:9000/auth/customer/emailpass",
    );
    assert.deepEqual(calls[2]?.body, {
      email: "customer@test.com",
      password: PASSWORD,
    });
    assert.equal(
      calls.some((call) => call.url.endsWith("/store/customers")),
      false,
    );
    assert.deepEqual(notes, []);
  });

  it("creates the customer profile with the login token when the identity exists without one", async () => {
    const notes: string[] = [];
    const loginToken = jwtWithActor("");
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [] }),
      alreadyExists,
      () => jsonResponse(200, { token: loginToken }),
      () => jsonResponse(200, { customer: { id: "cus_1" } }),
    ]);

    await ensureCustomer(ctxFor(), notes, PUBLISHABLE_KEY);

    assert.equal(calls.length, 4);
    assert.equal(calls[3]?.url, "http://localhost:9000/store/customers");
    assert.equal(calls[3]?.headers.Authorization, `Bearer ${loginToken}`);
    assert.equal(calls[3]?.headers["x-publishable-api-key"], PUBLISHABLE_KEY);
    assert.deepEqual(notes, ["Customer customer@test.com created."]);

    const output = logs.join("\n");
    assert.equal(output.includes(PASSWORD), false);
    assert.equal(output.includes(loginToken), false);
  });

  it("fails clearly, without leaking the password, when the existing identity rejects the login", async () => {
    mockFetch([
      () => jsonResponse(200, { customers: [] }),
      alreadyExists,
      () => jsonResponse(401, { message: "Invalid email or password" }),
    ]);

    await assert.rejects(
      ensureCustomer(ctxFor(), [], PUBLISHABLE_KEY),
      (error: Error) => {
        assert.match(error.message, /emailpass failed \(HTTP 401\)/);
        assert.equal(error.message.includes(PASSWORD), false);
        return true;
      },
    );
  });

  it("throws when register fails for a reason other than 'already exists'", async () => {
    mockFetch([
      () => jsonResponse(200, { customers: [] }),
      () => jsonResponse(500, { message: "boom" }),
    ]);

    await assert.rejects(
      ensureCustomer(ctxFor(), [], PUBLISHABLE_KEY),
      /register failed \(HTTP 500\)/,
    );
  });

  it("falls back to the default password when MEDUSA_SEED_CUSTOMER_PASSWORD is unset", async () => {
    delete process.env.MEDUSA_SEED_CUSTOMER_PASSWORD;
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [] }),
      () => jsonResponse(200, { token: "register-token" }),
      () => jsonResponse(200, { customer: { id: "cus_1" } }),
    ]);

    await ensureCustomer(ctxFor(), [], PUBLISHABLE_KEY);

    assert.deepEqual(calls[1]?.body, {
      email: "customer@test.com",
      password: "customer123",
    });
  });
});
