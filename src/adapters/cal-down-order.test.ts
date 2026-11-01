import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiTimeoutMessage, calDownSequence } from "./cal.adapter.js";

describe("calDownSequence", () => {
  it("stops the API, then the web, then compose, in that order", async () => {
    const order: string[] = [];
    await calDownSequence({
      stopApi: async () => {
        order.push("api");
      },
      stopWeb: async () => {
        order.push("web");
      },
      composeDown: async () => {
        order.push("compose");
      },
    });
    assert.deepEqual(order, ["api", "web", "compose"]);
  });

  it("does not stop the web or compose when the API stop throws", async () => {
    const order: string[] = [];
    await assert.rejects(
      calDownSequence({
        stopApi: async () => {
          order.push("api");
          throw new Error("API still listening");
        },
        stopWeb: async () => {
          order.push("web");
        },
        composeDown: async () => {
          order.push("compose");
        },
      }),
      /API still listening/,
    );
    assert.deepEqual(order, ["api"]);
  });

  it("does not run compose down when the web stop throws", async () => {
    const order: string[] = [];
    await assert.rejects(
      calDownSequence({
        stopApi: async () => {
          order.push("api");
        },
        stopWeb: async () => {
          order.push("web");
          throw new Error("web pid kept");
        },
        composeDown: async () => {
          order.push("compose");
        },
      }),
      /web pid kept/,
    );
    assert.deepEqual(order, ["api", "web"]);
  });
});

describe("apiTimeoutMessage", () => {
  it("names the URL and carries the API log tail", () => {
    const message = apiTimeoutMessage("http://127.0.0.1:5555/health", "Error: Redis connection refused");
    assert.match(message, /Timed out waiting for http:\/\/127\.0\.0\.1:5555\/health to answer OK/);
    assert.match(message, /Last log:\nError: Redis connection refused/);
  });
});
