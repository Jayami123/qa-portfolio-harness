import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MAIL_ACCOUNTS_ROUTE, waitForMailAccountsRoute } from "./nextcloud-mail-seed.js";

const BASE_URL = "http://127.0.0.1:8080";
const IDENTITY = { uid: "qa-owner", authorization: "Basic cWE6c2VjcmV0" };

/** Replaces global fetch with a script of answers: a number is an HTTP status, an Error is a connection failure. */
function scriptFetch(answers: (number | Error)[]): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const answer = answers[Math.min(state.calls, answers.length - 1)];
    state.calls += 1;
    if (answer instanceof Error) throw answer;
    return new Response("{}", { status: answer });
  }) as typeof fetch;
  return state;
}

describe("waitForMailAccountsRoute", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("succeeds when the route answers 404 and then 200", async () => {
    const state = scriptFetch([404, 404, 200]);
    await waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1);
    assert.equal(state.calls, 3);
  });

  it("succeeds at once when the first answer is 200", async () => {
    const state = scriptFetch([200]);
    await waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1);
    assert.equal(state.calls, 1);
  });

  it("times out with an error that names the route, the identity and the last status", async () => {
    const state = scriptFetch([404]);
    await assert.rejects(waitForMailAccountsRoute(BASE_URL, IDENTITY, 30, 1), (error: Error) => {
      assert.match(error.message, new RegExp(MAIL_ACCOUNTS_ROUTE.replace(/[/]/g, "\\/")));
      assert.match(error.message, /for qa-owner/);
      assert.match(error.message, /did not answer HTTP 200 within the budget \(last: HTTP 404\)/);
      return true;
    });
    assert.ok(state.calls >= 1);
  });

  it("fails at once on 401 and does not poll", async () => {
    const state = scriptFetch([401, 200]);
    await assert.rejects(waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1), (error: Error) => {
      assert.match(error.message, /returned HTTP 401 \(not retried\)/);
      assert.match(error.message, new RegExp(MAIL_ACCOUNTS_ROUTE.replace(/[/]/g, "\\/")));
      return true;
    });
    assert.equal(state.calls, 1);
  });

  it("fails at once on 500 and does not poll", async () => {
    const state = scriptFetch([500, 200]);
    await assert.rejects(waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1), /returned HTTP 500 \(not retried\)/);
    assert.equal(state.calls, 1);
  });

  it("fails at once on a connection failure and does not poll", async () => {
    const state = scriptFetch([new Error("ECONNREFUSED"), 200]);
    await assert.rejects(waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1), /request failed \(not retried\)/);
    assert.equal(state.calls, 1);
  });

  it("sends the identity's own credential to the accounts route only", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), authorization: headers.get("authorization") });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await waitForMailAccountsRoute(BASE_URL, IDENTITY, 5_000, 1);
    assert.deepEqual(seen, [{ url: `${BASE_URL}${MAIL_ACCOUNTS_ROUTE}`, authorization: IDENTITY.authorization }]);
  });
});
