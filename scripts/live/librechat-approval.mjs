// Live H3 check. Run after: nextcloud (with its MCP run state), litellm with P4_STUB_API_BASE pointing at
// scripts/live/approval-stub.mjs, and librechat with:
//   LIBRECHAT_TOOL_APPROVAL=1
//   LIBRECHAT_TOOL_APPROVAL_ASK="mcp:nextcloud:nc_contacts_list_addressbooks"
//   LIBRECHAT_TOOL_APPROVAL_DENY="mcp:nextcloud:nc_contacts_delete_addressbook"
// With LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS=1 (toolApproval.allowAlways) it also asserts the remembered approval:
//   the card offers Always allow (review_configs[].allow_always), the first approval is sent with scope "session", and a
//   second call of the same tool in the same conversation runs without a pause. With the flag unset, the same second call
//   must pause again (the control: the first approval was for that call only).
// Always allow is never offered for a tool that an ask rule matches (packages/api/src/agents/hitl/allow.ts,
// isToolAllowAlwaysEligible). So with the flag on, LIBRECHAT_TOOL_APPROVAL_ASK must be unset: the ask-listed tool then
// pauses through mode default's unmatched-tool fallback (policy.ts, isToolApprovalPauseCapable). The script refuses to run
// with the flag on and an ask rule set.
// It asserts:
//   ask-listed tool : the run pauses (requires_action) before the tool runs; /resume with an approve decision runs it
//                     once and the run completes;
//   deny-listed tool: the run never pauses, the tool never runs, and the address book it would delete still exists.
// It prints names, statuses and counts only. Credentials are read from the run-state files and never printed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? process.cwd();
const LC = process.env.LIBRECHAT_BASE_URL ?? "http://127.0.0.1:3080";
const NC_MCP = process.env.NEXTCLOUD_MCP_URL ?? "http://127.0.0.1:8765/mcp";
const STUB = process.env.APPROVAL_STUB_URL ?? "http://127.0.0.1:9099";
const OWNER_EMAIL = "qa-owner@p4.test";
const ASK = "nc_contacts_list_addressbooks";
const DENY = "nc_contacts_delete_addressbook";
const BOOK = "h3-probe";
const ALLOW_ALWAYS = process.env.LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS === "1";
const ASK_RULE_SET = (process.env.LIBRECHAT_TOOL_APPROVAL_ASK ?? "").trim() !== "";
const PARENT = "00000000-0000-0000-0000-000000000000";
// LibreChat's uaParser middleware answers "Illegal request" (and logs a violation) to any client that is not a
// recognized browser, so every LibreChat call sends a browser User-Agent. This is not a credential.
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const check = (cond, msg) => {
  if (!cond) fail(msg);
  console.log(`ok: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stub(pathname, init) {
  const r = await fetch(`${STUB}${pathname}`, init);
  return r.json().catch(() => ({}));
}

// Streamable-HTTP MCP client: initialize once, keep the session id, then call tools.
let mcpSession = null;
async function mcpPost(auth, body) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: auth,
    "mcp-protocol-version": "2025-06-18",
  };
  if (mcpSession) headers["mcp-session-id"] = mcpSession;
  return fetch(NC_MCP, { method: "POST", headers, body: JSON.stringify(body) });
}
async function mcpInit(auth) {
  if (mcpSession) return;
  const r = await mcpPost(auth, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h3-check", version: "1" } },
  });
  if (r.status !== 200) fail(`MCP initialize returned HTTP ${r.status}`);
  mcpSession = r.headers.get("mcp-session-id");
  await mcpPost(auth, { jsonrpc: "2.0", method: "notifications/initialized" });
}
async function mcpTool(auth, name, args) {
  await mcpInit(auth);
  const r = await mcpPost(auth, { jsonrpc: "2.0", id: crypto.randomInt(1, 1e6), method: "tools/call", params: { name, arguments: args } });
  const text = await r.text();
  if (r.status !== 200) fail(`MCP tools/call ${name} returned HTTP ${r.status}`);
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("") || text;
  const msg = JSON.parse(data);
  if (msg.error) fail(`MCP tools/call ${name} returned a JSON-RPC error (code ${msg.error.code})`);
  return msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
}

async function lcJson(url, init = {}) {
  const headers = { "user-agent": BROWSER_UA, ...(init.headers ?? {}) };
  const r = await fetch(`${LC}${url}`, { ...init, headers });
  const body = await r.json().catch(() => undefined);
  return { status: r.status, body };
}

/**
 * Starts the chat turn. LibreChat answers at once with JSON ({ streamId, conversationId, ... }) and runs the generation in
 * the background. The conversation id it returns is the one to poll and to resume: it can differ from the one sent.
 */
async function startChat(token, body) {
  const r = await fetch(`${LC}/api/agents/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": BROWSER_UA },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => undefined);
  if (process.env.H3_DEBUG) console.log(`debug: chat POST HTTP ${r.status}, keys ${Object.keys(json ?? {}).join(",")}`);
  if (r.status !== 200 || typeof json?.conversationId !== "string") fail(`the chat turn was not started (HTTP ${r.status})`);
  return json.conversationId;
}

async function pollStatus(token, conversationId, until, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seenPause = false;
  let last;
  while (Date.now() < deadline) {
    const s = await lcJson(`/api/agents/chat/status/${conversationId}`, { headers: { authorization: `Bearer ${token}` } });
    last = s.body;
    if (process.env.H3_DEBUG) {
      const scalars = Object.fromEntries(Object.entries(s.body ?? {}).filter(([, v]) => ["string", "boolean", "number"].includes(typeof v)));
      console.log(`debug: status HTTP ${s.status}, keys ${Object.keys(s.body ?? {}).join(",")}, scalars ${JSON.stringify(scalars).slice(0, 300)}`);
    }
    if (last?.status === "requires_action") seenPause = true;
    if (until(last)) return { status: last, seenPause, timedOut: false };
    await sleep(1000);
  }
  return { status: last, seenPause, timedOut: true };
}

// A run is over only when the status reply names a status that is not running or paused. A reply with no status yet
// (the job has not been created) is not a finished run.
const terminal = (s) => typeof s?.status === "string" && s.status !== "running" && s.status !== "requires_action";

// A run is over when the assistant has written the stub's final answer (the stub writes it only after the tool result).
// LibreChat's status endpoint reports active:false once a job ends and carries no status string, so it cannot say "done".
const FINAL = "Final answer after the tool result.";
const finals = (list) => list.filter((x) => !x.isCreatedByUser && !x.unfinished && JSON.stringify(x.content ?? x.text ?? "").includes(FINAL));
async function waitForFinal(token, conversationId, timeoutMs, wanted = 1) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await lcJson(`/api/messages/${conversationId}`, { headers: { authorization: `Bearer ${token}` } });
    const list = Array.isArray(m.body) ? m.body : [];
    const found = finals(list);
    if (found.length >= wanted) {
      return { done: true, messageId: found[found.length - 1].messageId };
    }
    await sleep(1000);
  }
  return { done: false };
}

// One turn in an existing conversation: stops early and reports a pause when the status says requires_action.
async function watchTurn(token, conversationId, wantedFinals, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await lcJson(`/api/agents/chat/status/${conversationId}`, { headers: { authorization: `Bearer ${token}` } });
    if (s.body?.status === "requires_action") return { sawPause: true, pendingAction: s.body.pendingAction };
    const m = await lcJson(`/api/messages/${conversationId}`, { headers: { authorization: `Bearer ${token}` } });
    const found = finals(Array.isArray(m.body) ? m.body : []);
    if (found.length >= wantedFinals) return { sawPause: false, done: true, messageId: found[found.length - 1].messageId };
    await sleep(1000);
  }
  return { sawPause: false, done: false };
}

// --- Setup ----------------------------------------------------------------------------------------------------------
const lcSecrets = JSON.parse(fs.readFileSync(path.join(root, ".harness", "librechat", "secrets.json"), "utf8"));
const ncRun = JSON.parse(fs.readFileSync(path.join(root, ".harness", "nextcloud-run.json"), "utf8"));
const login = await lcJson("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: lcSecrets.ownerPassword }),
});
check(login.status === 200 && typeof login.body?.token === "string", "LibreChat login as the owner");
const token = login.body.token;

await mcpTool(ncRun.mcpAuthorization, "nc_contacts_create_addressbook", { name: BOOK, display_name: "H3 probe" });
check((await mcpTool(ncRun.mcpAuthorization, "nc_contacts_list_addressbooks", {})).includes(BOOK), "seeded the probe address book through the Nextcloud MCP");

const agent = await lcJson("/api/agents", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    name: "h3-approval-probe",
    provider: "P4 LiteLLM",
    model: "p4-stub",
    instructions: "Use the tools you are offered.",
    tools: [`${ASK}_mcp_nextcloud`, `${DENY}_mcp_nextcloud`],
  }),
});
check(agent.status === 200 || agent.status === 201, `created the probe agent (HTTP ${agent.status})`);
const agentId = agent.body?.id;
check(typeof agentId === "string", "the probe agent has an id");

// --- Flow A: the ask-listed tool pauses, then runs once after approval --------------------------------------------------
await stub("/reset", { method: "POST" });
const bodyA = {
  text: "[approval-test:ask] list my address books",
  endpoint: "agents",
  agent_id: agentId,
  model: "p4-stub",
  conversationId: crypto.randomUUID(),
  parentMessageId: PARENT,
  messageId: crypto.randomUUID(),
};
const convA = await startChat(token, bodyA);
const paused = await pollStatus(token, convA, (s) => s?.status === "requires_action" || terminal(s), 120000);
check(paused.status?.status === "requires_action", `the ask-listed run pauses for approval (status ${paused.status?.status ?? "none"})`);
const pending = paused.status.pendingAction;
check(pending?.payload?.type === "tool_approval", "the pause is a tool_approval with a pending action");
check(JSON.stringify(pending).includes(ASK), `the pending approval names ${ASK}`);
const offersAlways = pending.payload?.review_configs?.[0]?.allow_always === true;
check(offersAlways === ALLOW_ALWAYS, ALLOW_ALWAYS ? "the approval card offers Always allow (allow_always)" : "the approval card does not offer Always allow (flag off)");
const before = await stub("/stats");
check(before.toolResults === 0, `no tool result reached the model while paused (toolResults ${before.toolResults})`);

// The pending payload names the call in action_requests[0].tool_call_id and lists the decisions it accepts.
const toolCallId = pending.payload?.action_requests?.[0]?.tool_call_id;
check(typeof toolCallId === "string" && toolCallId.length > 0, "the pending action carries a tool call id");
if (ALLOW_ALWAYS) check(!ASK_RULE_SET, "Always allow needs LIBRECHAT_TOOL_APPROVAL_ASK unset (an ask match is never offered Always allow)");
const allowed = pending.payload?.review_configs?.[0]?.allowed_decisions ?? [];
check(Array.isArray(allowed) && allowed.includes("approve"), `the pause accepts an approve decision (allowed: ${allowed.join(", ")})`);

const resumed = await lcJson("/api/agents/chat/resume", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    ...bodyA,
    conversationId: convA,
    actionId: pending.actionId,
    // "session" is the Always allow choice: it remembers the tool for this conversation. Without the flag, approve once.
    decisions: [{ tool_call_id: toolCallId, decision: "approve", ...(ALLOW_ALWAYS ? { scope: "session" } : {}) }],
  }),
});
check(resumed.status === 200, `POST /resume accepted the approval (HTTP ${resumed.status})`);
const finishedA = await waitForFinal(token, convA, 180000);
check(finishedA.done, "the approved run finishes with the final answer");
const afterA = await stub("/stats");
check(afterA.toolResults === 1, `the approved tool ran exactly once (toolResults ${afterA.toolResults})`);
check(afterA.toolResultNames.some((n) => n.includes(ASK)), `the tool result is for ${ASK}`);

// --- Flow C: a second call of the same tool in the same conversation ---------------------------------------------------
// With Always allow, the stored choice must let it run without a pause. Without the flag it must pause again.
await stub("/reset", { method: "POST" });
const convC = await startChat(token, {
  text: "[approval-test:ask] list my address books again",
  endpoint: "agents",
  agent_id: agentId,
  model: "p4-stub",
  conversationId: convA,
  parentMessageId: finishedA.messageId,
  messageId: crypto.randomUUID(),
});
const turnC = await watchTurn(token, convC, 2, 180000);
if (ALLOW_ALWAYS) {
  check(!turnC.sawPause, "the second call runs without a pause (the remembered approval persists)");
  check(turnC.done, "the second call finishes with the final answer");
  const afterC = await stub("/stats");
  check(afterC.toolResults === 1, `the remembered tool ran once in the second call (toolResults ${afterC.toolResults})`);
} else {
  check(turnC.sawPause, "control: without Always allow the second call pauses again");
  console.log("info: control run stops at the second pause; the conversation is left paused and is removed with the stack");
}

// --- Flow B: the deny-listed tool never pauses and never runs -----------------------------------------------------------
await stub("/reset", { method: "POST" });
const convB = await startChat(token, {
  text: `[approval-test:deny] [addressbook:${BOOK}] remove it`,
  endpoint: "agents",
  agent_id: agentId,
  model: "p4-stub",
  conversationId: crypto.randomUUID(),
  parentMessageId: PARENT,
  messageId: crypto.randomUUID(),
});
const finishedB = await pollStatus(token, convB, (s) => s?.status === "requires_action", 60000);
if (finishedB.seenPause) {
  const pa = finishedB.status?.pendingAction;
  console.log(`info: the deny flow paused; pending names ${JSON.stringify((pa?.payload?.action_requests ?? []).map((r) => r.name))}`);
}
check(!finishedB.seenPause, "the deny-listed run never pauses for approval");
check((await waitForFinal(token, convB, 180000)).done, "the deny-listed run finishes with the final answer");
const afterB = await stub("/stats");
check(afterB.toolResultNames.some((n) => n.includes(DENY)), `the model received a result for ${DENY}`);
console.log(`info: deny result starts with: ${JSON.stringify((afterB.toolResultTexts[0] ?? "").slice(0, 80))}`);
check((await mcpTool(ncRun.mcpAuthorization, "nc_contacts_list_addressbooks", {})).includes(BOOK), "the address book the deny-listed tool would delete still exists");

// --- Cleanup -------------------------------------------------------------------------------------------------------------
await mcpTool(ncRun.mcpAuthorization, "nc_contacts_delete_addressbook", { name: BOOK });
console.log(ALLOW_ALWAYS ? "PASS: H3 live check with Always allow (ask pauses; the remembered approval runs the second call with no pause; deny never runs)" : "PASS: H3 live check (ask pauses and resumes; deny never pauses and never runs; the second call pauses without Always allow)");
