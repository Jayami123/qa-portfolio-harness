import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MedusaConfig } from "../config.js";
import { ensureCustomer, type MedusaSeedContext } from "./medusa-seed.js";

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

  it("treats register 'already exists' as a skip and does not call the store customer route", async () => {
    const notes: string[] = [];
    const calls = mockFetch([
      () => jsonResponse(200, { customers: [] }),
      () =>
        jsonResponse(400, {
          type: "invalid_data",
          message: "Identity with email already exists",
        }),
    ]);

    await ensureCustomer(ctxFor(), notes, PUBLISHABLE_KEY);

    assert.equal(calls.length, 2);
    assert.equal(
      calls.some((call) => call.url.endsWith("/store/customers")),
      false,
    );
    assert.deepEqual(notes, []);
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
