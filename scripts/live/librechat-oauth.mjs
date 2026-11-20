// Live H4 check: OAuth sign-in for the Twenty MCP server through LibreChat, driven in a real browser.
//
// Run after: twenty (TWENTY_MCP=1), litellm, and librechat with LIBRECHAT_MCP_PRODUCTS=twenty and LIBRECHAT_MCP_OAUTH=1.
//
// What it checks, in order:
//   1. Before sign-in: LibreChat reports twenty as requiresOAuth true with no connection. A tool list shows no tools.
//   2. Sign-in starts from LibreChat (reinitialize). The authorize URL the browser opens is the browser-reachable Twenty URL.
//   3. The browser signs in to Twenty, gives consent, and LibreChat's callback exchanges the code (PKCE, dynamic client).
//   4. After sign-in: the connection is connected, and the tools list shows the Twenty tools through that connection.
//
// Secrets: the owner password is read from the run state and the Twenty login values are the dev seed constants in
// src/adapters/twenty-env.ts. The LibreChat JWT lives in memory only and goes only to LibreChat's origin (a route rewrites
// the header there; Twenty never receives it). The browser keeps no storage state on disk. Every printed line is scanned by
// findSecretLeaks before it is written, and the check exits 1 on any hit. Only names, states, counts and origins are printed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { findSecretLeaks } from "../../dist/adapters/librechat-oauth.js";

const root = process.argv[2] ?? process.cwd();
const LC = process.env.LIBRECHAT_BASE_URL ?? "http://localhost:3080";
const TWENTY = process.env.TWENTY_BASE_URL ?? "http://127.0.0.1:3002";
const OWNER_EMAIL = "qa-owner@p4.test";
// The Twenty seed admin (src/adapters/twenty-env.ts, TWENTY_DEFAULT_ADMIN_EMAIL and TWENTY_DEV_SEED_PASSWORD).
const TWENTY_LOGIN_EMAIL = "jane.austen@apple.dev";
const TWENTY_LOGIN_PASSWORD = "tim@apple.dev";
const SERVER = "twenty";
const SIGN_IN_TIMEOUT_MS = 90000;
// LibreChat's uaParser answers "Illegal request" to a client that is not a recognized browser. This is not a credential.
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const EVIDENCE = path.join(root, "evidence", "h4-live-check.txt");

const lines = [];
const secretsValues = [];
const say = (line) => {
  lines.push(line);
  console.log(line);
};
const fail = (msg) => {
  say(`FAIL: ${msg}`);
  finish(1);
};
const check = (cond, msg) => {
  if (!cond) fail(msg);
  say(`ok: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Writes the evidence file only when no secret-shaped text is in it. Exits with the given code. */
function finish(code) {
  const text = `${lines.join("\n")}\n`;
  const hits = findSecretLeaks(text, { values: secretsValues });
  if (hits.length > 0) {
    console.error(`LEAK CHECK FAILED: output matched ${hits.join(", ")} (the text is not printed)`);
    code = 1;
  }
  if (code === 0 && hits.length === 0) {
    fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    fs.writeFileSync(EVIDENCE, text, { encoding: "utf8", mode: 0o644 });
  }
  process.exit(code);
}

const ownerPassword = (() => {
  const file = path.join(root, ".harness", "librechat", "secrets.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return parsed.ownerPassword;
})();
secretsValues.push(ownerPassword, TWENTY_LOGIN_PASSWORD);

async function lcJson(url, init = {}) {
  const r = await fetch(`${LC}${url}`, { ...init, headers: { "user-agent": BROWSER_UA, ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => undefined);
  return { status: r.status, body };
}

// 1. Owner login to LibreChat. The token is kept in memory only.
const login = await lcJson("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: ownerPassword }),
});
check(login.status === 200 && typeof login.body?.token === "string", "LibreChat login as the owner");
const token = login.body.token;
const userId = login.body.user?.id;
check(typeof userId === "string", "the owner's LibreChat user id is known");
secretsValues.push(token);
const auth = { authorization: `Bearer ${token}` };

// 2. Before sign-in: requires OAuth, no connection, no tools.
const before = await lcJson(`/api/mcp/connection/status/${SERVER}`, { headers: auth });
check(before.status === 200 && before.body?.requiresOAuth === true, `${SERVER} is an OAuth server in LibreChat (requiresOAuth true)`);
check(before.body?.connectionStatus !== "connected", `${SERVER} is not connected before sign-in (state ${before.body?.authorizationState ?? "unknown"})`);
const toolsBefore = await lcJson("/api/mcp/tools", { headers: auth });
const countBefore = toolsBefore.body?.servers?.[SERVER]?.tools?.length ?? 0;
check(countBefore === 0, `${SERVER} lists no tools before sign-in`);

// 3. Start the sign-in from LibreChat. The flow id and the authorize URL come back; only the origin and path are printed.
const start = await lcJson(`/api/mcp/${SERVER}/reinitialize`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" });
check(start.status === 200 && start.body?.oauthRequired === true && typeof start.body?.flowId === "string", `${SERVER} sign-in starts (oauthRequired, flow created)`);
const flowId = start.body.flowId;
secretsValues.push(flowId);
const authorizeUrl = new URL(start.body.oauthUrl);
check(authorizeUrl.origin === TWENTY, `the authorize URL is the browser-reachable Twenty address (${authorizeUrl.origin})`);
check(authorizeUrl.searchParams.get("code_challenge_method") === "S256", "the authorize request uses PKCE S256");
check(authorizeUrl.searchParams.get("redirect_uri") === `${LC}/api/mcp/${SERVER}/oauth/callback`, "the redirect URI is LibreChat's callback on the initiate origin");
const initiate = `${LC}/api/mcp/${SERVER}/oauth/initiate?userId=${encodeURIComponent(userId)}&flowId=${encodeURIComponent(flowId)}`;

// 4. The browser: sign in to Twenty, then start from LibreChat again, give consent, and let the callback finish.
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let finalStatus;
try {
  const context = await browser.newContext({ userAgent: BROWSER_UA });
  // LibreChat's routes need the owner's Bearer token. It is added to LibreChat's origin only. The initiate request sets the
  // CSRF cookie that the callback checks; the browser keeps it in memory with the context, which is never saved.
  await context.route(`${LC}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...auth } }));
  const page = await context.newPage();

  await page.goto(`${TWENTY}/welcome`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("input", TWENTY_LOGIN_EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill("input[type=password]", TWENTY_LOGIN_PASSWORD, { timeout: 30000 });
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 60000 });
  say(`ok: signed in to Twenty in the browser (landed on ${new URL(page.url()).origin})`);

  await page.goto(initiate, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForURL((u) => u.pathname === "/authorize", { timeout: 60000 });
  await page.getByRole("button", { name: "Authorize" }).waitFor({ timeout: 60000 });
  say("ok: Twenty consent screen shown for the LibreChat client");
  await page.getByRole("button", { name: "Authorize" }).click();

  // The callback and the success page are LibreChat's. Wait for the server to report the connection, not for a URL.
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const s = await lcJson(`/api/mcp/connection/status/${SERVER}`, { headers: auth });
    if (s.body?.connectionStatus === "connected") break;
    await sleep(1500);
  }
  finalStatus = (await lcJson(`/api/mcp/connection/status/${SERVER}`, { headers: auth })).body;
  await context.close();
} finally {
  await browser.close();
}

// 5. After sign-in: connected, and the tools come through the connection.
check(finalStatus?.connectionStatus === "connected", `${SERVER} is connected after the browser sign-in (state ${finalStatus?.authorizationState ?? "unknown"})`);
const toolsAfter = await lcJson("/api/mcp/tools", { headers: auth });
const countAfter = toolsAfter.body?.servers?.[SERVER]?.tools?.length ?? 0;
check(countAfter > 0, `${SERVER} lists ${countAfter} tools through the OAuth connection`);
say(`H4 live check passed for: ${SERVER} (OAuth sign-in completed in the browser)`);
finish(0);
