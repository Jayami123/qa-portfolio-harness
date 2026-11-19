// H6 browser tabs. Started detached by the Penpot adapter when P4_PENPOT_PLUGIN=1. For each profile (owner, second):
// logs in over RPC, creates that profile's own file, opens it in a tab, clicks the MCP toolbar button, and keeps the tab
// open so the MCP plugin stays connected. When the plugin's WebSocket carries a userToken, the token is written to that
// profile's state file (mode 0600). Nothing is printed except roles, file names and statuses. It runs until SIGTERM.
//
// Environment (set by the adapter, never printed): PENPOT_BASE_URL, PENPOT_PLUGIN_STATE_DIR, PENPOT_OWNER_EMAIL,
// PENPOT_OWNER_PASSWORD, PENPOT_SECOND_EMAIL, PENPOT_SECOND_PASSWORD. Optional PENPOT_BROWSER_EXECUTABLE.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = required("PENPOT_BASE_URL");
const stateDir = required("PENPOT_PLUGIN_STATE_DIR");
const profiles = [
  { role: "owner", email: required("PENPOT_OWNER_EMAIL"), password: required("PENPOT_OWNER_PASSWORD"), fileName: "h6-owner-file" },
  { role: "second", email: required("PENPOT_SECOND_EMAIL"), password: required("PENPOT_SECOND_PASSWORD"), fileName: "h6-second-file" },
];
const readyFile = path.join(stateDir, "penpot-plugin-tabs.ready");
const CONNECT_TIMEOUT_MS = 90_000;

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.log(`penpot plugin tabs: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

async function rpc(cmd, body, cookie) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = `auth-token=${cookie}`;
  const response = await fetch(`${base}/api/rpc/command/${cmd}`, { method: "POST", headers, body: JSON.stringify(body) });
  return response;
}

async function login(profile) {
  const response = await rpc("login-with-password", { email: profile.email, password: profile.password });
  if (response.status !== 200) throw new Error(`login-with-password returned HTTP ${response.status} for ${profile.role}`);
  const cookie = response.headers.getSetCookie().map((c) => /auth-token=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (!cookie) throw new Error(`no auth cookie for ${profile.role}`);
  return cookie;
}

// Penpot replies in Transit JSON. The fields this script reads are plain keys, so a small reader is enough here.
function transitField(body, key) {
  const pairs = Array.isArray(body) && body[0] === "^ " ? body.slice(1) : [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const name = typeof pairs[i] === "string" ? pairs[i].replace(/^~:/, "") : "";
    if (name === key) {
      const value = pairs[i + 1];
      // UUIDs are "~u<uuid>" in Transit; the repo's decoder strips the same prefix.
      return typeof value === "string" && value.startsWith("~u") ? value.slice(2) : value;
    }
  }
  return undefined;
}

async function workspaceFor(profile) {
  const cookie = await login(profile);
  const profileReply = await (await rpc("get-profile", {}, cookie)).json();
  const teamId = transitField(profileReply, "default-team-id");
  const projectId = transitField(profileReply, "default-project-id");
  if (typeof teamId !== "string" || typeof projectId !== "string") throw new Error(`profile ids missing for ${profile.role}`);
  const created = await rpc("create-file", { name: profile.fileName, "project-id": projectId }, cookie);
  if (created.status !== 200) throw new Error(`create-file returned HTTP ${created.status} for ${profile.role}`);
  const fileId = transitField(await created.json(), "id");
  if (typeof fileId !== "string") throw new Error(`file id missing for ${profile.role}`);
  return { cookie, teamId, fileId };
}

function writeState(role, state) {
  const file = path.join(stateDir, `penpot-plugin-${role}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function connectTab(browser, profile) {
  const { cookie, teamId, fileId } = await workspaceFor(profile);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: "auth-token", value: cookie, domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  let userToken;
  page.on("websocket", (socket) => {
    // Only the token is kept. The URL itself is never printed.
    const url = new URL(socket.url());
    if (url.pathname === "/mcp/ws" && url.searchParams.get("userToken")) userToken = url.searchParams.get("userToken");
  });
  await page.goto(`${base}/#/workspace?team-id=${teamId}&file-id=${fileId}`, { waitUntil: "domcontentloaded" });
  const mcpButton = page.locator("button", { hasText: /^MCP$/ }).first();
  await mcpButton.waitFor({ state: "visible", timeout: 60_000 });
  await mcpButton.click();
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (!userToken && Date.now() < deadline) {
    await page.waitForTimeout(500);
  }
  if (!userToken) throw new Error(`the MCP plugin did not connect with a token for ${profile.role}`);
  writeState(profile.role, { version: 1, role: profile.role, email: profile.email, fileName: profile.fileName, mcpToken: userToken });
  console.log(`tab ${profile.role}: plugin connected with a user token (file ${profile.fileName})`);
  return context;
}

fs.rmSync(readyFile, { force: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env.PENPOT_BROWSER_EXECUTABLE ? { executablePath: process.env.PENPOT_BROWSER_EXECUTABLE } : {}),
});
const contexts = [];
const shutdown = async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close().catch(() => {});
  for (const profile of profiles) fs.rmSync(path.join(stateDir, `penpot-plugin-${profile.role}.json`), { force: true });
  fs.rmSync(readyFile, { force: true });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  for (const profile of profiles) {
    contexts.push(await connectTab(browser, profile));
  }
  fs.writeFileSync(readyFile, "ready\n", { mode: 0o600 });
  console.log("penpot plugin tabs: both tabs open with the MCP plugin connected");
} catch (error) {
  console.log(`penpot plugin tabs failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown();
}
// Keep the tabs alive until the adapter stops this process.
setInterval(() => {}, 1 << 30);
